import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getSessionContext } from '@/server/auth';
import { verifyState } from '@/server/connectors/crypto';
import { exchangeCode, oauthFamily } from '@/server/connectors/oauth';
import { storeConnection, syncIntegration } from '@/server/services/integrations';
import type { Provider } from '@/server/connectors/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Completes an OAuth grant.
 *
 * Three checks before anything is stored: the signed state must verify (so the
 * request is one we started), it must not have expired, and the signed-in user
 * must be the same person the state was issued to. The last one matters
 * because an authorization code delivered to a logged-in victim's browser
 * would otherwise attach the attacker's account to the victim's workspace.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ family: string }> },
) {
  const { family } = await context.params;
  const params = request.nextUrl.searchParams;

  const error = params.get('error');
  const errorDescription = params.get('error_description');
  if (error) {
    // The user declined, or the provider refused. Not an application fault.
    return redirect(request, null, `${family}: ${errorDescription ?? error}`);
  }

  const code = params.get('code');
  const rawState = params.get('state');
  if (!code || !rawState) {
    return redirect(request, null, 'The provider returned an incomplete response.');
  }

  let state;
  try {
    state = verifyState(rawState);
  } catch (err) {
    return redirect(
      request, null,
      err instanceof Error ? err.message : 'The authorization state did not verify.',
    );
  }

  if (oauthFamily(state.provider as Provider) !== family) {
    return redirect(request, state.workspaceId, 'That authorization was for a different provider.');
  }

  const session = await getSessionContext();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.nextUrl.origin));
  }
  if (session.userId !== state.userId) {
    // Signed in as someone else than the grant was started by.
    return redirect(
      request, state.workspaceId,
      'That authorization was started by a different account. Start again from Integrations.',
    );
  }
  if (!session.workspaces.some((w) => w.id === state.workspaceId)) {
    return redirect(request, null, 'You no longer have access to that workspace.');
  }

  const provider = state.provider as Provider;

  try {
    const tokens = await exchangeCode(provider, code);
    const client = createSupabaseAdminClient();

    const { integrationId } = await storeConnection(client, {
      provider,
      workspaceId: state.workspaceId,
      userId: session.userId,
      tokens,
    });

    // A first sync immediately, so the user sees whether it actually works
    // rather than a green badge and an empty index. A failure here is
    // recorded on the integration and reported, not thrown away.
    const sync = await syncIntegration(client, integrationId, { limit: 25 }).catch(() => null);

    const url = new URL('/integrations', request.nextUrl.origin);
    url.searchParams.set('workspace', state.workspaceId);
    if (sync && sync.status === 'failed') {
      url.searchParams.set(
        'notice',
        `Connected, but the first sync failed: ${sync.error ?? 'unknown error'}`,
      );
    } else {
      url.searchParams.set(
        'notice',
        `Connected. ${sync?.documentsIndexed ?? 0} document(s) indexed.`,
      );
    }
    return NextResponse.redirect(url);
  } catch (err) {
    return redirect(
      request, state.workspaceId,
      err instanceof Error ? err.message : 'The token exchange failed.',
    );
  }
}

function redirect(request: NextRequest, workspaceId: string | null, message: string) {
  const url = new URL('/integrations', request.nextUrl.origin);
  if (workspaceId) url.searchParams.set('workspace', workspaceId);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}
