import { beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

/**
 * The encryption and OAuth-state helpers.
 *
 * These guard two things that are easy to get quietly wrong: a tampered
 * ciphertext must fail loudly rather than returning plausible garbage, and a
 * forged OAuth state must not be able to attach one person's provider account
 * to another person's workspace.
 */

beforeAll(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('hex');
});

describe('seal and unseal', () => {
  it('round-trips a token bundle', async () => {
    const { sealTokens, unsealTokens } = await import('@/server/connectors/crypto');
    const sealed = sealTokens({
      accessToken: 'ya29.secret-access-token',
      refreshToken: '1//refresh-token',
      expiresAt: 1_900_000_000_000,
      scope: 'drive.readonly',
    });

    // The plaintext must not be recoverable from the stored columns.
    expect(sealed.ciphertext).not.toContain('ya29');
    expect(sealed.iv).toBeTruthy();
    expect(sealed.authTag).toBeTruthy();

    const opened = unsealTokens(sealed);
    expect(opened.accessToken).toBe('ya29.secret-access-token');
    expect(opened.refreshToken).toBe('1//refresh-token');
    expect(opened.expiresAt).toBe(1_900_000_000_000);
  });

  it('uses a fresh IV each time, so identical input differs in storage', async () => {
    const { seal } = await import('@/server/connectors/crypto');
    const a = seal('same plaintext');
    const b = seal('same plaintext');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('refuses a tampered ciphertext', async () => {
    const { seal, unseal } = await import('@/server/connectors/crypto');
    const sealed = seal('token');

    const bytes = Buffer.from(sealed.ciphertext, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;

    expect(() => unseal({ ...sealed, ciphertext: bytes.toString('base64') })).toThrow();
  });

  it('refuses a tampered auth tag', async () => {
    const { seal, unseal } = await import('@/server/connectors/crypto');
    const sealed = seal('token');
    const tag = Buffer.from(sealed.authTag, 'base64');
    tag[0] = tag[0]! ^ 0xff;

    expect(() => unseal({ ...sealed, authTag: tag.toString('base64') })).toThrow();
  });

  it('refuses a ciphertext decrypted under a different key', async () => {
    const { seal } = await import('@/server/connectors/crypto');
    const sealed = seal('token');

    // Rotating the key must make existing ciphertext unreadable, which is what
    // makes a key rotation meaningful rather than cosmetic.
    const original = process.env.CREDENTIALS_ENCRYPTION_KEY;
    try {
      process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('hex');
      vi.resetModules();
      const rotated = await import('@/server/connectors/crypto');
      expect(() => rotated.unseal(sealed)).toThrow();
    } finally {
      process.env.CREDENTIALS_ENCRYPTION_KEY = original;
      vi.resetModules();
    }
  });

  it('rejects a stored credential with no access token', async () => {
    const { seal, unsealTokens } = await import('@/server/connectors/crypto');
    const sealed = seal(JSON.stringify({ refreshToken: 'only-a-refresh-token' }));
    expect(() => unsealTokens(sealed)).toThrow(/access token/i);
  });
});

describe('OAuth state', () => {
  it('round-trips and verifies', async () => {
    const { signState, verifyState } = await import('@/server/connectors/crypto');
    const token = signState({
      userId: 'user-1', workspaceId: 'ws-1', provider: 'google_drive', issuedAt: Date.now(),
    });
    const verified = verifyState(token);
    expect(verified.userId).toBe('user-1');
    expect(verified.workspaceId).toBe('ws-1');
  });

  it('refuses a forged payload', async () => {
    const { signState, verifyState } = await import('@/server/connectors/crypto');
    const token = signState({
      userId: 'victim', workspaceId: 'victim-ws', provider: 'gmail', issuedAt: Date.now(),
    });

    // Swap in an attacker's workspace, keeping the original signature. This is
    // the attack the signature exists to stop.
    const [, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        userId: 'attacker', workspaceId: 'attacker-ws', provider: 'gmail', issuedAt: Date.now(),
      }),
      'utf8',
    ).toString('base64url');

    expect(() => verifyState(`${forged}.${signature}`)).toThrow(/signature/i);
  });

  it('refuses a malformed state', async () => {
    const { verifyState } = await import('@/server/connectors/crypto');
    expect(() => verifyState('nonsense')).toThrow(/malformed/i);
    expect(() => verifyState('')).toThrow();
  });

  it('refuses an expired state', async () => {
    const { signState, verifyState } = await import('@/server/connectors/crypto');
    const token = signState({
      userId: 'u', workspaceId: 'w', provider: 'notion',
      issuedAt: Date.now() - 20 * 60 * 1000,
    });
    expect(() => verifyState(token)).toThrow(/expired/i);
  });
});
