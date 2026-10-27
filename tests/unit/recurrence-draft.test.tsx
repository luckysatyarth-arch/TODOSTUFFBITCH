import { describe, expect, it } from 'vitest';
import {
  draftToRecurrence, emptyRecurrenceDraft, recurrenceToDraft,
} from '@/components/tasks/recurrence-field';

/**
 * The form draft, which is where a rule the database would reject is most
 * likely to be assembled: the UI holds strings and part-finished states, and
 * has to decide what is a rule and what is not yet one.
 */

describe('draftToRecurrence', () => {
  it('emits nothing when recurrence is off', () => {
    expect(draftToRecurrence(emptyRecurrenceDraft())).toBeNull();
  });

  it('builds the working-day rule', () => {
    const draft = {
      ...emptyRecurrenceDraft(),
      enabled: true, freq: 'monthly' as const,
      monthlyMode: 'by-position' as const, setpos: '-1',
      weekdays: [5, 1, 3, 2, 4],
    };
    // Sorted, because the stored rule should not depend on click order.
    expect(draftToRecurrence(draft)).toEqual({
      freq: 'monthly', weekdays: [1, 2, 3, 4, 5], setpos: -1,
    });
  });

  it('omits the position when no weekdays are chosen yet', () => {
    // A position with nothing to select from is refused by the database, so a
    // half-finished form must not send one.
    const draft = {
      ...emptyRecurrenceDraft(),
      enabled: true, freq: 'monthly' as const,
      monthlyMode: 'by-position' as const, setpos: '-1', weekdays: [],
    };
    expect(draftToRecurrence(draft)).toEqual({ freq: 'monthly' });
  });

  it('omits the position in day-of-month mode even if one is set', () => {
    const draft = {
      ...emptyRecurrenceDraft(),
      enabled: true, freq: 'monthly' as const,
      monthlyMode: 'day-of-month' as const, setpos: '-1', weekdays: [1, 2, 3, 4, 5],
    };
    expect(draftToRecurrence(draft)).toEqual({ freq: 'monthly' });
  });

  it('does not emit a position on a weekly rule', () => {
    const draft = {
      ...emptyRecurrenceDraft(),
      enabled: true, freq: 'weekly' as const,
      monthlyMode: 'by-position' as const, setpos: '-1', weekdays: [2, 4],
    };
    expect(draftToRecurrence(draft)).toEqual({ freq: 'weekly', weekdays: [2, 4] });
  });

  it('omits an interval of one rather than storing a default', () => {
    const draft = { ...emptyRecurrenceDraft(), enabled: true, freq: 'daily' as const };
    expect(draftToRecurrence(draft)).toEqual({ freq: 'daily' });
  });

  it('carries an end date or a count, not both', () => {
    const base = { ...emptyRecurrenceDraft(), enabled: true, freq: 'daily' as const };
    expect(draftToRecurrence({ ...base, ends: 'on', until: '2027-01-01', remaining: '5' }))
      .toEqual({ freq: 'daily', until: '2027-01-01' });
    expect(draftToRecurrence({ ...base, ends: 'after', until: '2027-01-01', remaining: '5' }))
      .toEqual({ freq: 'daily', remaining: 5 });
  });
});

describe('recurrenceToDraft', () => {
  it('round-trips the working-day rule back into the form', () => {
    const rule = {
      freq: 'monthly' as const, weekdays: [1, 2, 3, 4, 5], setpos: -1,
      anchor: '2026-10-30', occurrence: 2,
    };
    const draft = recurrenceToDraft(rule);

    expect(draft.enabled).toBe(true);
    expect(draft.monthlyMode).toBe('by-position');
    expect(draft.setpos).toBe('-1');
    expect(draft.weekdays).toEqual([1, 2, 3, 4, 5]);

    // Back out again, the anchor and occurrence are dropped: the database owns
    // them, and a form that could rewrite the anchor would shift the series.
    expect(draftToRecurrence(draft)).toEqual({
      freq: 'monthly', weekdays: [1, 2, 3, 4, 5], setpos: -1,
    });
  });

  it('reads a plain monthly rule as day-of-month', () => {
    const draft = recurrenceToDraft({ freq: 'monthly', anchor: '2026-01-31' });
    expect(draft.monthlyMode).toBe('day-of-month');
    expect(draftToRecurrence(draft)).toEqual({ freq: 'monthly' });
  });

  it('treats no rule as recurrence off', () => {
    expect(recurrenceToDraft(null).enabled).toBe(false);
    expect(recurrenceToDraft(undefined).enabled).toBe(false);
  });
});
