import { serverEnv, publicEnv } from '@/lib/env';
import type { Provider } from './types';
import type { StoredTokens } from './crypto';

/**
 * Token exchange and refresh, per provider family.
 *
 * Kept separate from the connector adapters because the OAuth dance is a
 * property of the provider's identity service, not of what the connector
 * reads once it holds a token.
 */

export function redirectUri(provider: Provider): string {
  const family = oauthFamily(provider);
  return `${publicEnv.NEXT_PUBLIC_APP_URL}/api/integrations/${family}/callback`;
}

/**
 * Google issues one client for Drive and Gmail, and Microsoft one for mail and
 * Teams, so the callback route is shared per family and the provider is
 * carried in the signed state.
 */
export function oauthFamily(provider: Provider): 'google' | 'microsoft' | 'notion' | 'none' {
  switch (provider) {
    case 'google_drive':
    case 'gmail':
      return 'google';
    case 'microsoft_graph_email':
    case 'microsoft_teams':
      return 'microsoft';
    case 'notion':
      return 'notion';
    default:
      return 'none';
  }
}

export interface TokenResponse extends StoredTokens {
  raw: Record<string, unknown>;
}

export class TokenExchangeError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'TokenExchangeError';
  }
}

async function postForm(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    const detail =
      (payload?.error_description as string | undefined) ??
      (payload?.error as string | undefined) ??
      `HTTP ${response.status}`;
    throw new TokenExchangeError(detail);
  }
  return payload;
}

function toTokens(payload: Record<string, unknown>): TokenResponse {
  const accessToken = payload.access_token;
  if (typeof accessToken !== 'string') {
    throw new TokenExchangeError('Provider response contained no access token.');
  }

  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : undefined;

  return {
    accessToken,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
    // Stored as an absolute instant so refresh decisions do not depend on when
    // the row was read.
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    scope: typeof payload.scope === 'string' ? payload.scope : undefined,
    raw: payload,
  };
}

export async function exchangeCode(provider: Provider, code: string): Promise<TokenResponse> {
  const env = serverEnv();
  const family = oauthFamily(provider);
  const uri = redirectUri(provider);

  if (family === 'google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new TokenExchangeError('Google OAuth client is not configured.');
    }
    return toTokens(await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: uri,
      grant_type: 'authorization_code',
    }));
  }

  if (family === 'microsoft') {
    if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
      throw new TokenExchangeError('Microsoft OAuth client is not configured.');
    }
    return toTokens(await postForm(
      `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      {
        code,
        client_id: env.MICROSOFT_CLIENT_ID,
        client_secret: env.MICROSOFT_CLIENT_SECRET,
        redirect_uri: uri,
        grant_type: 'authorization_code',
      },
    ));
  }

  if (family === 'notion') {
    if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET) {
      throw new TokenExchangeError('Notion OAuth client is not configured.');
    }
    // Notion requires HTTP Basic auth on the token endpoint and a JSON body.
    const basic = Buffer
      .from(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`)
      .toString('base64');

    const response = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: uri,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      throw new TokenExchangeError(
        (payload?.error as string | undefined) ?? `HTTP ${response.status}`,
      );
    }

    const tokens = toTokens(payload);
    // Notion's token never expires and there is no refresh token.
    return {
      ...tokens,
      externalAccountId:
        typeof payload.workspace_id === 'string' ? payload.workspace_id : undefined,
    };
  }

  throw new TokenExchangeError(`'${provider}' does not use OAuth.`);
}

/**
 * Refreshes an access token.
 *
 * Returns null when the provider issues no refresh token (Notion) or none was
 * granted, so callers can distinguish "cannot refresh" from "refresh failed".
 */
export async function refreshAccessToken(
  provider: Provider,
  refreshToken: string | undefined,
): Promise<TokenResponse | null> {
  if (!refreshToken) return null;

  const env = serverEnv();
  const family = oauthFamily(provider);

  if (family === 'google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    const payload = await postForm('https://oauth2.googleapis.com/token', {
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    // A refresh response omits refresh_token; the existing one stays valid.
    return { ...toTokens(payload), refreshToken };
  }

  if (family === 'microsoft') {
    if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) return null;
    const payload = await postForm(
      `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      {
        client_id: env.MICROSOFT_CLIENT_ID,
        client_secret: env.MICROSOFT_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      },
    );
    const tokens = toTokens(payload);
    return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
  }

  return null;
}

/** True when the token is absent, expired, or close enough to expiry to renew. */
export function needsRefresh(tokens: StoredTokens, skewMs = 120_000): boolean {
  if (!tokens.expiresAt) return false;
  return tokens.expiresAt - skewMs <= Date.now();
}
