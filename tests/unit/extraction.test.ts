import { describe, expect, it } from 'vitest';
import { matchName, sanitiseDueDate } from '@/server/ai/extraction';
import { findDuplicate, similarity, tokenise } from '@/server/ai/duplicates';
import { chunkText } from '@/server/ai/embeddings';

describe('sanitiseDueDate', () => {
  const today = '2026-03-15';

  it('accepts a plausible nearby date', () => {
    expect(sanitiseDueDate('2026-03-20', today))
      .toEqual({ dueDate: '2026-03-20', rejected: false });
  });

  it('passes null through without flagging it', () => {
    expect(sanitiseDueDate(null, today)).toEqual({ dueDate: null, rejected: false });
  });

  it('rejects a malformed value', () => {
    expect(sanitiseDueDate('next Friday', today)).toEqual({ dueDate: null, rejected: true });
    expect(sanitiseDueDate('2026-13-45', today).rejected).toBe(true);
  });

  it('rejects a date implausibly far in the future', () => {
    // A mis-parsed year is the common failure, and it must not silently become
    // a real deadline.
    expect(sanitiseDueDate('2030-03-20', today)).toEqual({ dueDate: null, rejected: true });
  });

  it('rejects a date well in the past', () => {
    expect(sanitiseDueDate('2025-01-01', today)).toEqual({ dueDate: null, rejected: true });
  });

  it('allows a recent past date, which may be a genuine missed deadline', () => {
    expect(sanitiseDueDate('2026-03-10', today).rejected).toBe(false);
  });
});

describe('matchName', () => {
  const people = [
    { id: 'a', name: 'Priya Sharma' },
    { id: 'b', name: 'Bob Beta' },
    { id: 'c', name: 'Priya Nair' },
  ];

  it('matches a full name regardless of case and padding', () => {
    expect(matchName('  priya sharma ', people)).toBe('a');
  });

  it('matches an unambiguous first name', () => {
    expect(matchName('Bob', people)).toBe('b');
  });

  it('refuses an ambiguous first name rather than guessing', () => {
    // Two people called Priya: picking one would assign work to the wrong person.
    expect(matchName('Priya', people)).toBeNull();
  });

  it('returns null for an unknown person', () => {
    expect(matchName('Nobody', people)).toBeNull();
    expect(matchName(null, people)).toBeNull();
    expect(matchName('   ', people)).toBeNull();
  });
});

describe('duplicate detection', () => {
  it('drops stopwords and short tokens', () => {
    expect([...tokenise('Finish the investor presentation')].sort())
      .toEqual(['finish', 'investor', 'presentation']);
  });

  it('scores identical text as 1', () => {
    expect(similarity('Draft homepage copy', 'draft homepage copy')).toBe(1);
  });

  it('scores unrelated text at 0', () => {
    expect(similarity('Draft homepage copy', 'Book a flight')).toBe(0);
  });

  it('is 0 when either side has no significant words', () => {
    expect(similarity('the a of', 'Draft homepage copy')).toBe(0);
  });

  it('finds a near-duplicate open task', () => {
    const match = findDuplicate('Finish investor presentation', [
      { id: 't1', title: 'Finish the investor presentation', status: 'in_progress' },
      { id: 't2', title: 'Pick a web host', status: 'todo' },
    ]);
    expect(match?.taskId).toBe('t1');
    expect(match!.similarity).toBeGreaterThan(0.55);
  });

  it('ignores completed and cancelled tasks', () => {
    // Re-proposing work finished long ago is usually a new request.
    expect(findDuplicate('Collect competitor pricing', [
      { id: 't3', title: 'Collect competitor pricing', status: 'completed' },
      { id: 't4', title: 'Collect competitor pricing', status: 'cancelled' },
    ])).toBeNull();
  });

  it('returns null below the threshold', () => {
    expect(findDuplicate('Write the market research section', [
      { id: 't5', title: 'Research web hosts', status: 'todo' },
    ])).toBeNull();
  });
});

describe('chunkText', () => {
  it('returns one chunk for short text', () => {
    expect(chunkText('short note')).toEqual(['short note']);
  });

  it('returns nothing for empty text', () => {
    expect(chunkText('   ')).toEqual([]);
  });

  it('splits long text into overlapping chunks', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} of the document.`).join(' ');
    const chunks = chunkText(text, 300, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(300);
    // Reassembled chunks must cover the original content.
    expect(chunks.join(' ')).toContain('Sentence number 59');
  });

  it('always terminates, even with no break characters', () => {
    const chunks = chunkText('x'.repeat(5000), 500, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
  });
});
