/**
 * Duplicate detection for proposed tasks.
 *
 * Deliberately lexical rather than model-based: it has to be deterministic and
 * explainable, because its output is shown to a reviewer as "this looks like
 * an existing task". A similarity score a human cannot reason about would be
 * worse than none.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'by',
  'with', 'from', 'is', 'are', 'be', 'this', 'that', 'it', 'we', 'i', 'please',
  'need', 'needs', 'should', 'must', 'will', 'can', 'up', 'out',
]);

export function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Jaccard overlap of significant words. 0 when either side has none. */
export function similarity(a: string, b: string): number {
  const ta = tokenise(a);
  const tb = tokenise(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared += 1;

  return shared / (ta.size + tb.size - shared);
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  status: string;
}

export interface DuplicateMatch {
  taskId: string;
  title: string;
  similarity: number;
}

/**
 * Closest existing open task above `threshold`.
 *
 * Completed and cancelled tasks are excluded: re-proposing work that was
 * finished last month is usually a genuinely new request, not a duplicate.
 */
export function findDuplicate(
  title: string,
  candidates: DuplicateCandidate[],
  threshold = 0.55,
): DuplicateMatch | null {
  let best: DuplicateMatch | null = null;

  for (const candidate of candidates) {
    if (candidate.status === 'completed' || candidate.status === 'cancelled') continue;
    const score = similarity(title, candidate.title);
    if (score >= threshold && (best === null || score > best.similarity)) {
      best = { taskId: candidate.id, title: candidate.title, similarity: score };
    }
  }

  return best;
}
