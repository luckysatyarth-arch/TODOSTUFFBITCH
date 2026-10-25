import { NextResponse, type NextRequest } from 'next/server';
import { getSessionContext, requireWorkspace, canManage } from '@/server/auth';
import { getConnector } from '@/server/connectors/registry';
import { signState } from '@/server/connectors/crypto';
import { encryptionAvailable } from '@/server/connectors/crypto';
import { oauthFamily, redirectUri } from '@/server/connectors/oauth';
import type { Provider } from '@/server/connectors/types';

export const dynamic = 'force-dynamic';

const PROVIDERS: Provider[] = [
  'google_drive', 'gmail', 'microsoft_graph_email', 'microsoft_teams', 'notion',
];

/**
 * Starts an OAuth grant.
 *
 * The user's identity and target workspace are carried in an HMAC-signed,
 * short-lived state parameter rather than in a cookie or the URL, so the
 * callback can trust who it is acting for. Without that signature, a crafted
 * callback could attach an attacker's provider account to someone else's
 * workspace.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ family: string }> },
) {
  const { family } = await context.params;
  const providerParam = request.nextUrl.searchParams.get('provider');
  const workspaceId = request.nextUrl.searchParams.get('workspace');

  const session = await getSessionContext();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.nextUrl.origin));
  }

  const provider = PROVIDERS.find((p) => p === providerParam);
  if (!provider || oauthFamily(provider) !== family) {
    return fail(request, workspaceId, 'That provider is not recognised.');
  }

  let workspace;
  try {
    workspace = await requireWorkspace(session, workspaceId ?? undefined);
  } catch {
    return fail(request, workspaceId, 'You do not have access to that workspace.');
  }

  // A per-user connector only affects the connecting user, so membership is
  // enough. A workspace-level one changes what the whole team can reach.
  if (provider === 'whatsapp' && !canManage(workspace.role)) {
    return fail(request, workspace.id, 'Only an owner or admin can connect this.');
  }

  if (!encryptionAvailable()) {
    return fail(
      request, workspace.id,
      'CREDENTIALS_ENCRYPTION_KEY is not set, so credentials cannot be stored safely.',
    );
  }

  const connector = getConnector(provider);
  if (!connector.isConfigured()) {
    return fail(
      request, workspace.id,
      `${connector.label} has no OAuth client configured in this deployment.`,
    );
  }

  const state = signState({
    userId: session.userId,
    workspaceId: workspace.id,
    provider,
    issuedAt: Date.now(),
  });

  const url = connector.authorizationUrl(state, redirectUri(provider));
  if (!url) {
    return fail(request, workspace.id, `${connector.label} does not use OAuth.`);
  }

  return NextResponse.redirect(url);
}

function fail(request: NextRequest, workspaceId: string | null, message: string) {
  const url = new URL('/integrations', request.nextUrl.origin);
  if (workspaceId) url.searchParams.set('workspace', workspaceId);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}
