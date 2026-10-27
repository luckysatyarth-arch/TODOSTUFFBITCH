import { describe, expect, it } from 'vitest';
import {
  describeRecurrence,
  parseRecurrence,
  recurrenceBadge,
  recurrenceInput,
  recurrenceRule,
  resolveRecurrence,
} from '@/lib/validation/recurrence';

/**
 * The recurrence rule as the application sees it.
 *
 * The database has the final say — migration 0010 carries a CHECK constraint
 * and the SQL checks in supabase/local exercise the date arithmetic. These
 * tests cover what only the application can get wrong: accepting a rule the
 * column would reject, letting a form rewrite the fields the database
 * maintains, and describing a rule to the user in words that do not match
 * what it will actually do.
 */

describe('recurrenceRule', () => {
  it('accepts the minimal rule', () => {
    expect(recurrenceRule.parse({ freq: 'daily' })).toEqual({ freq: 'daily' });
  });

  it('rejects an unknown frequency', () => {
    expect(recurrenceRule.safeParse({ freq: 'fortnightly' }).success).toBe(false);
  });

  it('rejects an interval below one or above the database cap', () => {
    expect(recurrenceRule.safeParse({ freq: 'daily', interval: 0 }).success).toBe(false);
    expect(recurrenceRule.safeParse({ freq: 'daily', interval: 367 }).success).toBe(false);
    expect(recurrenceRule.safeParse({ freq: 'daily', interval: 366 }).success).toBe(true);
  });

  it('rejects an unknown key instead of dropping it', () => {
    // A dropped `weekday` would leave a weekly rule meaning "every week on
    // whatever day this started", not the days the user chose.
    const result = recurrenceRule.safeParse({ freq: 'weekly', weekday: [1, 3] });
    expect(result.success).toBe(false);
  });

  it('only allows weekdays on a weekly rule', () => {
    expect(recurrenceRule.safeParse({ freq: 'weekly', weekdays: [1, 3] }).success).toBe(true);
    expect(recurrenceRule.safeParse({ freq: 'monthly', weekdays: [1] }).success).toBe(false);
  });

  it('rejects an out-of-range or repeated weekday', () => {
    expect(recurrenceRule.safeParse({ freq: 'weekly', weekdays: [0] }).success).toBe(false);
    expect(recurrenceRule.safeParse({ freq: 'weekly', weekdays: [8] }).success).toBe(false);
    expect(recurrenceRule.safeParse({ freq: 'weekly', weekdays: [] }).success).toBe(false);
    expect(recurrenceRule.safeParse({ freq: 'weekly', weekdays: [2, 2] }).success).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(recurrenceRule.safeParse({ freq: 'daily', until: 'next tuesday' }).success).toBe(false);
    expect(recurrenceRule.safeParse({ freq: 'daily', until: '2026-10-25' }).success).toBe(true);
  });

  it('rejects an end date before the series starts', () => {
    const result = recurrenceRule.safeParse({
      freq: 'daily', anchor: '2026-10-25', until: '2026-10-01',
    });
    expect(result.success).toBe(false);
  });
});

describe('recurrenceInput', () => {
  it('strips the fields the database maintains', () => {
    // A form that loaded an existing rule and posted it back must not be able
    // to move the anchor, which would shift every future occurrence.
    const parsed = recurrenceInput.parse({
      freq: 'monthly', interval: 1, anchor: '2020-01-01', occurrence: 99,
    });
    expect(parsed).toEqual({ freq: 'monthly', interval: 1 });
  });

  it('keeps the fields the user owns', () => {
    expect(recurrenceInput.parse({ freq: 'weekly', weekdays: [1, 5], until: '2027-01-01' }))
      .toEqual({ freq: 'weekly', weekdays: [1, 5], until: '2027-01-01' });
  });

  it('treats null and undefined as no recurrence', () => {
    expect(recurrenceInput.parse(null)).toBeNull();
    expect(recurrenceInput.parse(undefined)).toBeUndefined();
  });
});

describe('describeRecurrence', () => {
  it('describes simple intervals', () => {
    expect(describeRecurrence({ freq: 'daily' })).toBe('Every day');
    expect(describeRecurrence({ freq: 'daily', interval: 3 })).toBe('Every 3 days');
    expect(describeRecurrence({ freq: 'weekly' })).toBe('Every week');
    expect(describeRecurrence({ freq: 'yearly', interval: 2 })).toBe('Every 2 years');
  });

  it('names the day of the month, because that is the actual promise', () => {
    // "Every month" and "every month on the 31st" behave differently in
    // February, so the description has to say which one this is.
    expect(describeRecurrence({ freq: 'monthly', anchor: '2026-01-31' }))
      .toBe('Every month on the 31st');
    expect(describeRecurrence({ freq: 'monthly', anchor: '2026-01-01' }))
      .toBe('Every month on the 1st');
    expect(describeRecurrence({ freq: 'monthly', anchor: '2026-01-02' }))
      .toBe('Every month on the 2nd');
    expect(describeRecurrence({ freq: 'monthly', anchor: '2026-01-23' }))
      .toBe('Every month on the 23rd');
    expect(describeRecurrence({ freq: 'monthly', anchor: '2026-01-11' }))
      .toBe('Every month on the 11th');
  });

  it('collapses common weekday sets into the words people use', () => {
    expect(describeRecurrence({ freq: 'weekly', weekdays: [1, 2, 3, 4, 5] }))
      .toBe('Weekly on weekdays');
    expect(describeRecurrence({ freq: 'weekly', weekdays: [6, 7] }))
      .toBe('Weekly on weekends');
    expect(describeRecurrence({ freq: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7] }))
      .toBe('Weekly on every day');
    expect(describeRecurrence({ freq: 'weekly', weekdays: [2] }))
      .toBe('Weekly on Tuesday');
    expect(describeRecurrence({ freq: 'weekly', weekdays: [1, 3, 5] }))
      .toBe('Weekly on Monday, Wednesday and Friday');
  });

  it('describes a longer weekly interval', () => {
    expect(describeRecurrence({ freq: 'weekly', interval: 2, weekdays: [2] }))
      .toBe('Every 2nd week on Tuesday');
  });

  it('states how a series ends', () => {
    expect(describeRecurrence({ freq: 'daily', until: '2026-12-31' }))
      .toBe('Every day, until 2026-12-31');
    expect(describeRecurrence({ freq: 'daily', remaining: 3 }))
      .toBe('Every day, 3 more times');
    expect(describeRecurrence({ freq: 'daily', remaining: 1 }))
      .toBe('Every day, 1 more time');
    expect(describeRecurrence({ freq: 'daily', remaining: 0 }))
      .toBe('Every day, ending with this one');
  });

  it('returns null for no rule', () => {
    expect(describeRecurrence(null)).toBeNull();
    expect(describeRecurrence(undefined)).toBeNull();
  });
});

describe('recurrenceBadge', () => {
  it('stays short', () => {
    expect(recurrenceBadge({ freq: 'daily' })).toBe('Every d');
    expect(recurrenceBadge({ freq: 'monthly', interval: 3 })).toBe('Every 3mo');
    expect(recurrenceBadge({ freq: 'weekly', weekdays: [1, 2, 3, 4, 5] })).toBe('weekdays');
    expect(recurrenceBadge({ freq: 'weekly', weekdays: [2, 4] })).toBe('Tue and Thu');
    expect(recurrenceBadge(null)).toBeNull();
  });
});

describe('parseRecurrence', () => {
  it('reads a rule off a jsonb column', () => {
    expect(parseRecurrence({ freq: 'monthly', anchor: '2026-01-31', occurrence: 2 }))
      .toEqual({ freq: 'monthly', anchor: '2026-01-31', occurrence: 2 });
  });

  it('reports an unreadable rule as absent rather than throwing', () => {
    // One malformed row must not take down a whole task list.
    expect(parseRecurrence({ freq: 'whenever' })).toBeNull();
    expect(parseRecurrence('daily')).toBeNull();
    expect(parseRecurrence(null)).toBeNull();
  });
});

describe('setpos', () => {
  it('accepts a monthly position with weekdays', () => {
    const rule = { freq: 'monthly' as const, weekdays: [1, 2, 3, 4, 5], setpos: -1 };
    expect(recurrenceRule.safeParse(rule).success).toBe(true);
  });

  it('rejects a position with nothing to select from', () => {
    // setpos picks one of the month's matching weekdays; with no weekdays
    // there is nothing to pick, and the database rejects it too.
    expect(recurrenceRule.safeParse({ freq: 'monthly', setpos: -1 }).success).toBe(false);
  });

  it('rejects a position on a non-monthly rule', () => {
    expect(recurrenceRule.safeParse({ freq: 'weekly', weekdays: [5], setpos: -1 }).success)
      .toBe(false);
    expect(recurrenceRule.safeParse({ freq: 'daily', setpos: 1 }).success).toBe(false);
  });

  it('rejects zero and out-of-reach positions', () => {
    const base = { freq: 'monthly' as const, weekdays: [1] };
    expect(recurrenceRule.safeParse({ ...base, setpos: 0 }).success).toBe(false);
    expect(recurrenceRule.safeParse({ ...base, setpos: 6 }).success).toBe(false);
    expect(recurrenceRule.safeParse({ ...base, setpos: -6 }).success).toBe(false);
    expect(recurrenceRule.safeParse({ ...base, setpos: 5 }).success).toBe(true);
    expect(recurrenceRule.safeParse({ ...base, setpos: -5 }).success).toBe(true);
  });

  it('still rejects monthly weekdays without a position', () => {
    // Ambiguous: "monthly on Mondays" could be any of four or five dates.
    expect(recurrenceRule.safeParse({ freq: 'monthly', weekdays: [1] }).success).toBe(false);
  });

  it('describes the working-day case the way a person would say it', () => {
    expect(describeRecurrence({ freq: 'monthly', weekdays: [1, 2, 3, 4, 5], setpos: -1 }))
      .toBe('Last working day of every month');
    expect(describeRecurrence({ freq: 'monthly', weekdays: [1, 2, 3, 4, 5], setpos: 1 }))
      .toBe('First working day of every month');
  });

  it('describes a named weekday position', () => {
    expect(describeRecurrence({ freq: 'monthly', weekdays: [5], setpos: -1 }))
      .toBe('Last Friday of every month');
    expect(describeRecurrence({ freq: 'monthly', weekdays: [2], setpos: 3 }))
      .toBe('Third Tuesday of every month');
    expect(describeRecurrence({ freq: 'monthly', weekdays: [5], setpos: -2 }))
      .toBe('Second-to-last Friday of every month');
  });

  it('describes a longer interval', () => {
    expect(describeRecurrence({ freq: 'monthly', weekdays: [1], setpos: 1, interval: 3 }))
      .toBe('First Monday of every 3rd month');
  });

  it('keeps the badge short', () => {
    expect(recurrenceBadge({ freq: 'monthly', weekdays: [1, 2, 3, 4, 5], setpos: -1 }))
      .toBe('Last working day');
    expect(recurrenceBadge({ freq: 'monthly', weekdays: [5], setpos: -1 }))
      .toBe('Last Fri');
    expect(recurrenceBadge({ freq: 'monthly', weekdays: [1], setpos: 1, interval: 3 }))
      .toBe('First Mon /3mo');
  });

  it('strips the database-maintained fields but keeps the position', () => {
    expect(recurrenceInput.parse({
      freq: 'monthly', weekdays: [1, 2, 3, 4, 5], setpos: -1,
      anchor: '2020-01-01', occurrence: 9,
    })).toEqual({ freq: 'monthly', weekdays: [1, 2, 3, 4, 5], setpos: -1 });
  });

  it('round-trips through parseRecurrence', () => {
    const stored = { freq: 'monthly', weekdays: [1, 2, 3, 4, 5], setpos: -1, anchor: '2026-10-30' };
    expect(parseRecurrence(stored)).toEqual(stored);
  });
});

describe('resolveRecurrence', () => {
  /**
   * Which anchor a save stores.
   *
   * The task form round-trips the whole rule on every save, so an edit to the
   * title arrives looking identical to an edit to the schedule. Re-anchoring
   * on each save walks a monthly series off its day of month: a rule anchored
   * on the 31st, currently sitting on Feb 28, would be re-anchored to the 28th
   * and stay there for good — the exact drift the anchor exists to prevent.
   */

  const monthly31st = { freq: 'monthly' as const, anchor: '2026-01-31', occurrence: 1 };

  it('keeps the stored anchor when the rule did not change', () => {
    // What the form posts back: the same rule, with anchor and occurrence
    // already stripped by the input schema.
    const submitted = { freq: 'monthly' as const };

    // The task currently sits on Feb 28, the clamped occurrence.
    expect(resolveRecurrence(submitted, monthly31st, '2026-02-28')).toEqual({
      freq: 'monthly', anchor: '2026-01-31', occurrence: 1,
    });
  });

  it('re-anchors only when the rule actually changed', () => {
    const changed = { freq: 'monthly' as const, interval: 3 };

    expect(resolveRecurrence(changed, monthly31st, '2026-02-28')).toEqual({
      freq: 'monthly', interval: 3, anchor: '2026-02-28',
    });
  });

  it('anchors a brand new rule on its due date', () => {
    expect(resolveRecurrence({ freq: 'monthly' }, null, '2026-01-31')).toEqual({
      freq: 'monthly', anchor: '2026-01-31',
    });
  });

  it('treats a reordered weekday list as unchanged', () => {
    // Clicking the same days in a different order is not a schedule change,
    // and must not move the series.
    const stored = { freq: 'weekly' as const, weekdays: [1, 3, 5], anchor: '2026-10-26' };
    const submitted = { freq: 'weekly' as const, weekdays: [1, 3, 5] };

    expect(resolveRecurrence(submitted, stored, '2026-11-02')).toEqual({
      freq: 'weekly', weekdays: [1, 3, 5], anchor: '2026-10-26',
    });
  });

  it('re-anchors when the weekdays genuinely change', () => {
    const stored = { freq: 'weekly' as const, weekdays: [1, 3, 5], anchor: '2026-10-26' };
    const submitted = { freq: 'weekly' as const, weekdays: [2, 4] };

    expect(resolveRecurrence(submitted, stored, '2026-11-02')).toEqual({
      freq: 'weekly', weekdays: [2, 4], anchor: '2026-11-02',
    });
  });

  it('preserves a setpos series across an unrelated edit', () => {
    const stored = {
      freq: 'monthly' as const, weekdays: [1, 2, 3, 4, 5], setpos: -1,
      anchor: '2026-10-30', occurrence: 3,
    };
    const submitted = { freq: 'monthly' as const, weekdays: [1, 2, 3, 4, 5], setpos: -1 };

    expect(resolveRecurrence(submitted, stored, '2027-01-29')).toEqual(stored);
  });

  it('turning recurrence off clears the rule', () => {
    expect(resolveRecurrence(null, monthly31st, '2026-02-28')).toBeNull();
    expect(resolveRecurrence(undefined, monthly31st, '2026-02-28')).toBeNull();
  });

  it('leaves the anchor off when there is no due date to anchor on', () => {
    // The spawn trigger falls back to the completion date, so an absent anchor
    // is correct rather than a gap.
    expect(resolveRecurrence({ freq: 'daily' }, null, null)).toEqual({ freq: 'daily' });
  });

  it('ignores an unreadable stored rule rather than trusting it', () => {
    expect(resolveRecurrence({ freq: 'monthly' }, { freq: 'nonsense' }, '2026-02-28'))
      .toEqual({ freq: 'monthly', anchor: '2026-02-28' });
  });
});
