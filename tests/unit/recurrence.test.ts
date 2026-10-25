import { describe, expect, it } from 'vitest';
import {
  describeRecurrence,
  parseRecurrence,
  recurrenceBadge,
  recurrenceInput,
  recurrenceRule,
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
