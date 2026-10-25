import { describe, expect, it } from 'vitest';

/**
 * The provider-family routing and refresh window.
 *
 * Google issues one OAuth client for Drive and Gmail and Microsoft one for
 * mail and Teams, so the callback URL is per family while the provider rides
 * in the signed state. If a provider were routed to the wrong family its
 * redirect URI would not match what is registered with the identity service
 * and the connection would fail at the last step, after the user has already
 * consented.
 */

describe('oauthFamily', () => {
  it('routes the providers that share an OAuth client to one family', async () => {
    const { oauthFamily } = await import('@/server/connectors/oauth');

    expect(oauthFamily('google_drive')).toBe('google');
    expect(oauthFamily('gmail')).toBe('google');
    expect(oauthFamily('microsoft_graph_email')).toBe('microsoft');
    expect(oauthFamily('microsoft_teams')).toBe('microsoft');
    expect(oauthFamily('notion')).toBe('notion');
  });

  it('reports no family for providers that do not use OAuth', async () => {
    const { oauthFamily } = await import('@/server/connectors/oauth');

    // WhatsApp is configured with long-lived credentials rather than an
    // authorization-code flow, so it must not be offered a Connect redirect.
    expect(oauthFamily('whatsapp')).toBe('none');
  });
});

describe('redirectUri', () => {
  it('builds a per-family callback that is stable across the family', async () => {
    const { redirectUri } = await import('@/server/connectors/oauth');

    expect(redirectUri('gmail')).toBe(
      'http://localhost:3000/api/integrations/google/callback',
    );
    // Both Google providers must present the identical redirect URI, because
    // only one is registered with Google.
    expect(redirectUri('google_drive')).toBe(redirectUri('gmail'));
    expect(redirectUri('microsoft_teams')).toBe(redirectUri('microsoft_graph_email'));
  });
});

describe('needsRefresh', () => {
  it('refreshes before expiry, not after', async () => {
    const { needsRefresh } = await import('@/server/connectors/oauth');

    // Inside the skew window: renew now, so an in-flight sync does not fail
    // mid-request on a token that expires between the check and the call.
    expect(needsRefresh({ accessToken: 'a', expiresAt: Date.now() + 30_000 })).toBe(true);
    expect(needsRefresh({ accessToken: 'a', expiresAt: Date.now() - 1 })).toBe(true);
    expect(needsRefresh({ accessToken: 'a', expiresAt: Date.now() + 3_600_000 })).toBe(false);
  });

  it('honours an explicit skew', async () => {
    const { needsRefresh } = await import('@/server/connectors/oauth');
    const expiresAt = Date.now() + 600_000;

    expect(needsRefresh({ accessToken: 'a', expiresAt }, 120_000)).toBe(false);
    expect(needsRefresh({ accessToken: 'a', expiresAt }, 900_000)).toBe(true);
  });

  it('does not refresh a token that never expires', async () => {
    const { needsRefresh } = await import('@/server/connectors/oauth');

    // Notion returns no expiry; treating that as "expired" would send every
    // sync into a refresh the provider does not support.
    expect(needsRefresh({ accessToken: 'secret_notion-token' })).toBe(false);
  });
});
