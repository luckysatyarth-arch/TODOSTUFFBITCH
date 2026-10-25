import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { getConnector } from '@/server/connectors/registry';
import { sealTokens, unsealTokens, type StoredTokens } from '@/server/connectors/crypto';
import { needsRefresh, oauthFamily, refreshAccessToken } from '@/server/connectors/oauth';
import { indexDocuments } from './indexer';
import type { Provider } from '@/server/connectors/types';
import { ConnectorNotConfiguredError, ConnectorNotImplementedError } from '@/server/connectors/types';
import type { Json } from '@/lib/supabase/database.types';

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Connecting, refreshing and syncing an integration.
 *
 * All of it runs with the service role, because `integration_credentials` has
 * RLS enabled and no policies: a client can see that an integration exists
 * and what state it is in, but never its tokens.
 */

/** Per-user connectors store the owner; workspace-level ones store null. */
function scopeFor(provider: Provider): 'user' | 'workspace' {
  return provider === 'whatsapp' ? 'workspace' : 'user';
}

export interface ConnectResult {
  integrationId: string;
  provider: Provider;
}

/**
 * Records a completed OAuth grant.
 *
 * The integration row and the credential row are written separately because
 * they live in different trust zones -- the row is readable by the workspace,
 * the credential is not readable by anyone but the service role.
 */
export async function storeConnection(
  client: Admin,
  params: {
    provider: Provider;
    workspaceId: string;
    userId: string;
    tokens: StoredTokens;
    displayName?: string | null;
  },
): Promise<ConnectResult> {
  const connector = getConnector(params.provider);
  const scope = scopeFor(params.provider);

  const row = {
    workspace_id: params.workspaceId,
    owner_id: scope === 'user' ? params.userId : null,
    provider: params.provider,
    status: 'connected' as const,
    scope_level: scope,
    external_account_id: params.tokens.externalAccountId ?? null,
    display_name: params.displayName ?? connector.label,
    capabilities: connector.capabilities as unknown as Json,
    config: { scopes: params.tokens.scope ?? connector.scopes().join(' ') } as unknown as Json,
    token_expires_at: params.tokens.expiresAt
      ? new Date(params.tokens.expiresAt).toISOString()
      : null,
    last_error: null,
  };

  // Reconnecting replaces the previous grant rather than creating a second
  // row; the partial unique indexes on `integrations` enforce one per scope.
  const existingQuery = client
    .from('integrations')
    .select('id')
    .eq('workspace_id', params.workspaceId)
    .eq('provider', params.provider);

  const { data: existing } = scope === 'user'
    ? await existingQuery.eq('owner_id', params.userId).maybeSingle()
    : await existingQuery.is('owner_id', null).maybeSingle();

  const { data: saved, error } = existing
    ? await client.from('integrations').update(row).eq('id', existing.id).select('id').single()
    : await client.from('integrations').insert(row).select('id').single();

  if (error || !saved) {
    throw new Error(`Could not save the integration: ${error?.message ?? 'unknown error'}`);
  }

  const sealed = sealTokens(params.tokens);
  const { error: credentialError } = await client
    .from('integration_credentials')
    .upsert({
      integration_id: saved.id,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      auth_tag: sealed.authTag,
      key_version: sealed.keyVersion,
    }, { onConflict: 'integration_id' });

  if (credentialError) {
    throw new Error(`Could not store credentials: ${credentialError.message}`);
  }

  await client.from('audit_logs').insert({
    workspace_id: params.workspaceId,
    actor_id: params.userId,
    action: 'integration.connected',
    entity_type: 'integration',
    entity_id: saved.id,
    metadata: { provider: params.provider },
  });

  return { integrationId: saved.id, provider: params.provider };
}

/**
 * Returns a usable access token, refreshing it first if it is near expiry.
 *
 * A refresh failure marks the integration `error` with the provider's reason,
 * which is what the Integrations page shows, rather than failing a sync with
 * an opaque 401 later.
 */
export async function getAccessToken(
  client: Admin,
  integrationId: string,
): Promise<string | null> {
  const { data: integration } = await client
    .from('integrations').select('id, provider, workspace_id, owner_id').eq('id', integrationId).maybeSingle();
  if (!integration) return null;

  const { data: credential } = await client
    .from('integration_credentials')
    .select('ciphertext, iv, auth_tag')
    .eq('integration_id', integrationId)
    .maybeSingle();
  if (!credential) return null;

  let tokens: StoredTokens;
  try {
    tokens = unsealTokens({
      ciphertext: credential.ciphertext,
      iv: credential.iv,
      authTag: credential.auth_tag,
    });
  } catch (error) {
    // Usually a rotated CREDENTIALS_ENCRYPTION_KEY. Say so, since the fix is
    // to reconnect rather than to retry.
    await client.from('integrations').update({
      status: 'error',
      last_error:
        'Stored credentials could not be decrypted. If CREDENTIALS_ENCRYPTION_KEY was ' +
        'rotated, reconnect this integration.',
    }).eq('id', integrationId);
    void error;
    return null;
  }

  if (!needsRefresh(tokens)) return tokens.accessToken;

  try {
    const refreshed = await refreshAccessToken(integration.provider, tokens.refreshToken);
    if (!refreshed) {
      // Notion issues no refresh token and its access token does not expire,
      // so "cannot refresh" is not an error there.
      if (oauthFamily(integration.provider) === 'notion') return tokens.accessToken;

      await client.from('integrations').update({
        status: 'error',
        last_error: 'The access token expired and no refresh token is stored. Reconnect to continue.',
      }).eq('id', integrationId);
      return null;
    }

    const sealed = sealTokens(refreshed);
    await client.from('integration_credentials').update({
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      auth_tag: sealed.authTag,
      key_version: sealed.keyVersion,
    }).eq('integration_id', integrationId);

    await client.from('integrations').update({
      status: 'connected',
      last_error: null,
      token_expires_at: refreshed.expiresAt
        ? new Date(refreshed.expiresAt).toISOString()
        : null,
    }).eq('id', integrationId);

    return refreshed.accessToken;
  } catch (error) {
    await client.from('integrations').update({
      status: 'error',
      last_error: error instanceof Error ? error.message : 'Token refresh failed.',
    }).eq('id', integrationId);
    return null;
  }
}

export interface SyncResult {
  integrationId: string;
  provider: Provider;
  status: 'succeeded' | 'partial' | 'failed';
  documentsIndexed: number;
  documentsSkipped: number;
  error: string | null;
}

/**
 * Runs one integration's sync and indexes what comes back.
 *
 * Every run writes an `integration_sync_runs` row, successful or not, so the
 * Integrations page can show what happened rather than only the last success.
 */
export async function syncIntegration(
  client: Admin,
  integrationId: string,
  options: { limit?: number } = {},
): Promise<SyncResult> {
  const { data: integration } = await client
    .from('integrations')
    .select('id, provider, workspace_id, owner_id, status')
    .eq('id', integrationId)
    .maybeSingle();

  if (!integration) {
    return {
      integrationId, provider: 'whatsapp', status: 'failed',
      documentsIndexed: 0, documentsSkipped: 0, error: 'Integration not found.',
    };
  }

  const connector = getConnector(integration.provider);

  const { data: run } = await client
    .from('integration_sync_runs')
    .insert({ integration_id: integrationId, status: 'running' })
    .select('id')
    .single();

  const finish = async (result: Omit<SyncResult, 'integrationId' | 'provider'>, cursor?: string | null) => {
    if (run) {
      await client.from('integration_sync_runs').update({
        status: result.status,
        finished_at: new Date().toISOString(),
        cursor: cursor ?? null,
        documents_indexed: result.documentsIndexed,
        documents_skipped: result.documentsSkipped,
        error: result.error,
      }).eq('id', run.id);
    }

    await client.from('integrations').update(
      result.status === 'failed'
        ? { status: 'error' as const, last_error: result.error }
        : { status: 'connected' as const, last_error: null, last_success_at: new Date().toISOString() },
    ).eq('id', integrationId);

    return {
      integrationId, provider: integration.provider, ...result,
    };
  };

  try {
    // The previous run's cursor makes the next one incremental where the
    // provider supports it.
    const { data: previous } = await client
      .from('integration_sync_runs')
      .select('cursor')
      .eq('integration_id', integrationId)
      .eq('status', 'succeeded')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const accessToken = await getAccessToken(client, integrationId);

    const outcome = await connector.sync({
      integrationId,
      workspaceId: integration.workspace_id,
      ownerId: integration.owner_id,
      cursor: connector.capabilities.incrementalSync ? (previous?.cursor ?? null) : null,
      accessToken,
      limit: options.limit ?? 50,
    });

    const indexed = await indexDocuments(
      client,
      integration.workspace_id,
      integrationId,
      integration.owner_id,
      outcome.documents,
    );

    return finish({
      status: 'succeeded',
      documentsIndexed: indexed.indexed,
      documentsSkipped: indexed.skipped,
      error: null,
    }, outcome.cursor);
  } catch (error) {
    // A connector that cannot do this at all is distinguished from one that
    // tried and failed, because the remedies differ.
    const unsupported =
      error instanceof ConnectorNotConfiguredError ||
      error instanceof ConnectorNotImplementedError;

    return finish({
      status: 'failed',
      documentsIndexed: 0,
      documentsSkipped: 0,
      error: error instanceof Error ? error.message : 'Sync failed.',
    }).then(async (result) => {
      if (unsupported) {
        await client.from('integrations')
          .update({ status: 'requires_setup' })
          .eq('id', integrationId);
      }
      return result;
    });
  }
}

/** Removes a connection and its credentials, and optionally its indexed data. */
export async function disconnectIntegration(
  integrationId: string,
  userId: string,
  purgeIndexedData: boolean,
): Promise<void> {
  const client = createSupabaseAdminClient();

  const { data: integration } = await client
    .from('integrations').select('id, workspace_id, provider').eq('id', integrationId).maybeSingle();
  if (!integration) return;

  if (purgeIndexedData) {
    // Chunks and embeddings cascade from the document rows.
    await client.from('indexed_documents').delete().eq('integration_id', integrationId);
  }

  // The credential row cascades from the integration row.
  await client.from('integrations').delete().eq('id', integrationId);

  await client.from('audit_logs').insert({
    workspace_id: integration.workspace_id,
    actor_id: userId,
    action: 'integration.disconnected',
    entity_type: 'integration',
    entity_id: integrationId,
    metadata: { provider: integration.provider, purged: purgeIndexedData },
  });
}

/** Resolves the integration a user holds for a provider, if any. */
export async function findIntegration(
  workspaceId: string,
  provider: Provider,
  userId: string,
): Promise<{ id: string; status: string } | null> {
  const supabase = await createSupabaseServerClient();
  const query = supabase
    .from('integrations')
    .select('id, status')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider);

  const { data } = scopeFor(provider) === 'user'
    ? await query.eq('owner_id', userId).maybeSingle()
    : await query.is('owner_id', null).maybeSingle();

  return data ?? null;
}
