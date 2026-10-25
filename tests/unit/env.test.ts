import { describe, expect, it } from 'vitest';
import { withoutBlanks } from '@/lib/env';

/**
 * Regression coverage for a bug that broke every server route.
 *
 * `.env.example` carries each optional key as an empty string, and copying it
 * to `.env.local` is exactly what the README instructs. An empty string is
 * present, so Zod's `.optional()` does not apply and a `min()` check fails --
 * which turned "I left the optional AI key blank" into a 500 on every route
 * that read the server environment.
 */
describe('withoutBlanks', () => {
  it('drops an empty string, so .optional() applies', () => {
    const result = withoutBlanks({ ANTHROPIC_API_KEY: '' });
    expect('ANTHROPIC_API_KEY' in result).toBe(false);
  });

  it('drops a whitespace-only value', () => {
    expect('X' in withoutBlanks({ X: '   ' })).toBe(false);
    expect('Y' in withoutBlanks({ Y: '\n\t' })).toBe(false);
  });

  it('keeps a real value untouched, including its surrounding spaces', () => {
    const result = withoutBlanks({ A: 'sk-real-key', B: ' padded ' });
    expect(result.A).toBe('sk-real-key');
    // Trimming is left to the individual schemas; this only decides presence.
    expect(result.B).toBe(' padded ');
  });

  it('drops an undefined value', () => {
    expect('MISSING' in withoutBlanks({ MISSING: undefined })).toBe(false);
  });

  it('keeps a literal "0" and "false", which are meaningful values', () => {
    const result = withoutBlanks({ ZERO: '0', FALSE: 'false' });
    expect(result.ZERO).toBe('0');
    expect(result.FALSE).toBe('false');
  });
});
