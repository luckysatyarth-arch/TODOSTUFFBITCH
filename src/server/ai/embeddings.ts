import OpenAI from 'openai';
import { serverEnv } from '@/lib/env';

/**
 * Embeddings for semantic retrieval.
 *
 * The dimension is fixed at 1536 by the document_embeddings column, so a model
 * with a different output size needs a migration rather than a config change.
 * This is checked at runtime so a mismatch fails loudly instead of storing
 * silently wrong vectors.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export class EmbeddingUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'EmbeddingUnavailableError';
  }
}

function client(): OpenAI | null {
  const env = serverEnv();
  if (env.EMBEDDING_PROVIDER === 'none' || !env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

export function embeddingsAvailable(): boolean {
  return client() !== null;
}

/** Returns null when embeddings are not configured, so callers degrade to FTS. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const openai = client();
  if (!openai) return null;

  const env = serverEnv();
  const response = await openai.embeddings.create({
    model: env.EMBEDDING_MODEL,
    input: text.slice(0, 8_000),
  });

  const vector = response.data[0]?.embedding;
  if (!vector) return null;

  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingUnavailableError(
      `EMBEDDING_MODEL '${env.EMBEDDING_MODEL}' returns ${vector.length} dimensions, but the ` +
        `database column expects ${EMBEDDING_DIMENSIONS}. Change the model or migrate the column.`,
    );
  }
  return vector;
}

export async function embedBatch(texts: string[]): Promise<number[][] | null> {
  const openai = client();
  if (!openai) return null;
  if (texts.length === 0) return [];

  const env = serverEnv();
  const response = await openai.embeddings.create({
    model: env.EMBEDDING_MODEL,
    input: texts.map((t) => t.slice(0, 8_000)),
  });

  return response.data.map((d) => d.embedding);
}

/**
 * Splits text into overlapping chunks on paragraph boundaries where possible.
 * The overlap keeps a sentence that straddles a boundary retrievable.
 */
export function chunkText(text: string, maxChars = 1_500, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);

    if (end < clean.length) {
      // Prefer a paragraph break, then a sentence end, then a hard cut.
      const paragraph = clean.lastIndexOf('\n\n', end);
      const sentence = clean.lastIndexOf('. ', end);
      if (paragraph > start + maxChars * 0.5) end = paragraph;
      else if (sentence > start + maxChars * 0.5) end = sentence + 1;
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}
