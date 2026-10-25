'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import {
  assertCanManage, canManage, requireSession, requireWorkspace, AuthorizationError,
} from '@/server/auth';
import { disconnectIntegration, syncIntegration } from '@/server/services/integrations';
import { indexWorkspaceRecords } from '@/server/services/indexer';
import { uuid } from '@/lib/validation/common';
import { serverEnv } from '@/lib/env';
import type { ActionResult } from '../actions';

function fail(error: unknown): ActionResult<never> {
  if (error instanceof AuthorizationError) return { ok: false, error: error.message };
  if (error instanceof Error) return { ok: false, error: error.message };
  return { ok: false, error: 'Unexpected error.' };
}

/**
 * Authorizes an action against a specific integration.
 *
 * A per-user connector is the connecting user's own business; a
 * workspace-level one affects everyone, so that needs an admin.
 */
async function integrationContext(integrationId: string) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Read through the user's client first, so RLS decides visibility before
  // the service role is used for the work itself.
  const { data: integration } = await supabase
    .from('integrations')
    .select('id, workspace_id, provider, owner_id, scope_level')
    .eq('id', integrationId)
    .maybeSingle();

  if (!integration) throw new AuthorizationError('Integration not found.');

  const workspace = await requireWorkspace(session, integration.workspace_id);

  if (integration.scope_level === 'workspace') {
    assertCanManage(workspace);
  } else if (integration.owner_id !== session.userId) {
    throw new AuthorizationError('That integration belongs to another member.');
  }

  return { session, workspace, integration };
}

export async function syncNow(integrationId: string): Promise<ActionResult<{
  indexed: number; skipped: number; status: string; error: string | null;
}>> {
  try {
    const id = uuid.parse(integrationId);
    await integrationContext(id);

    if (!serverEnv().SUPABASE_SERVICE_ROLE_KEY) {
      return {
        ok: false,
        error: 'SUPABASE_SERVICE_ROLE_KEY is required to sync an integration.',
      };
    }

    const result = await syncIntegration(createSupabaseAdminClient(), id, { limit: 50 });
    revalidatePath('/integrations');

    return {
      ok: true,
      data: {
        indexed: result.documentsIndexed,
        skipped: result.documentsSkipped,
        status: result.status,
        error: result.error,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function disconnect(
  integrationId: string,
  purgeIndexedData: boolean,
): Promise<ActionResult> {
  try {
    const id = uuid.parse(integrationId);
    const { session } = await integrationContext(id);

    if (!serverEnv().SUPABASE_SERVICE_ROLE_KEY) {
      return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is required to disconnect.' };
    }

    await disconnectIntegration(id, session.userId, purgeIndexedData);
    revalidatePath('/integrations');
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Rebuilds the workspace's own search index.
 *
 * The write paths keep keyword search fresh, but chunking and embeddings are
 * left to a batch pass. This is that pass, on demand, for someone who has
 * just configured an embeddings key and does not want to wait for the
 * scheduled run.
 */
export async function reindexWorkspace(workspaceId: string): Promise<ActionResult<{
  indexed: number; skipped: number; embedded: number;
}>> {
  try {
    const id = uuid.parse(workspaceId);
    const session = await requireSession();
    const workspace = await requireWorkspace(session, id);

    // A reindex touches every member's view of search, so it is an admin action.
    if (!canManage(workspace.role)) {
      throw new AuthorizationError('Only an owner or admin can rebuild the search index.');
    }

    if (!serverEnv().SUPABASE_SERVICE_ROLE_KEY) {
      return {
        ok: false,
        error: 'SUPABASE_SERVICE_ROLE_KEY is required to rebuild the index.',
      };
    }

    const result = await indexWorkspaceRecords(createSupabaseAdminClient(), id);

    await createSupabaseAdminClient().from('audit_logs').insert({
      workspace_id: id,
      actor_id: session.userId,
      action: 'search.reindexed',
      entity_type: 'workspace',
      entity_id: id,
      metadata: result as unknown as never,
    });

    revalidatePath('/integrations');
    revalidatePath('/search');
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}
