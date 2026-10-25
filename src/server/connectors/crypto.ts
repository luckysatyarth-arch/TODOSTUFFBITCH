import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';

/**
 * AES-256-GCM for OAuth tokens at rest.
 *
 * Tokens are long-lived credentials to a user's mail and files, so a database
 * dump must not yield usable ones. GCM is authenticated, so a tampered
 * ciphertext fails to decrypt rather than returning garbage that might be
 * sent to a provider.
 *
 * The ciphertext, the IV and the auth tag are stored in separate columns of
 * `integration_credentials`, a table with RLS enabled and no policies: only
 * the service role can read it, and this module only ever runs server-side.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the size GCM is specified for.

export class EncryptionUnavailableError extends Error {
  constructor() {
    super(
      'CREDENTIALS_ENCRYPTION_KEY is not set, so integration credentials cannot be ' +
        'stored. Generate one with `openssl rand -hex 32`.',
    );
    this.name = 'EncryptionUnavailableError';
  }
}

function key(): Buffer {
  const env = serverEnv();
  if (!env.CREDENTIALS_ENCRYPTION_KEY) throw new EncryptionUnavailableError();
  // Validated as 64 hex characters by the env schema, so this is 32 bytes.
  return Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY, 'hex');
}

export function encryptionAvailable(): boolean {
  return Boolean(serverEnv().CREDENTIALS_ENCRYPTION_KEY);
}

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

/** Encrypts a token bundle. A fresh IV per call; never reuse one with GCM. */
export function seal(plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: 1,
  };
}

/** Decrypts a token bundle. Throws if the ciphertext or tag was tampered with. */
export function unseal(sealed: Omit<SealedSecret, 'keyVersion'>): string {
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
  scope?: string;
  externalAccountId?: string;
}

export function sealTokens(tokens: StoredTokens): SealedSecret {
  return seal(JSON.stringify(tokens));
}

export function unsealTokens(sealed: Omit<SealedSecret, 'keyVersion'>): StoredTokens {
  const parsed = JSON.parse(unseal(sealed)) as StoredTokens;
  if (typeof parsed.accessToken !== 'string' || parsed.accessToken.length === 0) {
    throw new Error('Stored credential did not contain an access token.');
  }
  return parsed;
}

/**
 * Signed OAuth state.
 *
 * The state parameter round-trips through the provider, so it cannot be
 * trusted on the way back. It is HMAC-signed with the same secret and given a
 * short expiry, which is what prevents an attacker from crafting a callback
 * that attaches *their* provider account to *someone else's* workspace.
 */
export interface OAuthState {
  userId: string;
  workspaceId: string;
  provider: string;
  /** Epoch milliseconds. */
  issuedAt: number;
}

const STATE_TTL_MS = 15 * 60 * 1000;

export function signState(state: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  const signature = createHmac('sha256', key()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyState(token: string): OAuthState {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) throw new Error('Malformed OAuth state.');

  const expected = createHmac('sha256', key()).update(payload).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('OAuth state signature did not verify.');
  }

  const parsed = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as OAuthState;

  // A short window limits the value of a captured authorization URL.
  if (Date.now() - parsed.issuedAt > STATE_TTL_MS) {
    throw new Error('This authorization link has expired. Start again from Integrations.');
  }

  return parsed;
}
