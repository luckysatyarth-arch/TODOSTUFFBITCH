import { z } from 'zod';
import { isoDate } from './common';

/**
 * Recurrence rules.
 *
 * This mirrors `app.is_valid_recurrence` in migration 0010. The database is
 * the authority -- it has a CHECK constraint, so an invalid rule cannot be
 * stored whatever the caller does -- and this exists so a bad rule is refused
 * with a readable message before it gets that far.
 *
 * `.strict()` matters: a misspelled `weekday` would otherwise be dropped
 * silently and leave a weekly rule meaning "every week on the start day"
 * instead of the days the user picked.
 */

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export const recurrenceFrequency = z.enum(RECURRENCE_FREQUENCIES);

/** ISO weekday numbers, 1 = Monday .. 7 = Sunday, as `extract(isodow)` uses. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const recurrenceRule = z
  .object({
    freq: recurrenceFrequency,
    /** Every N periods. Capped to match the database constraint. */
    interval: z.coerce.number().int().min(1).max(366).optional(),
    /**
     * Which days the task falls on. On a weekly rule these are the days
     * themselves; on a monthly rule they are the candidates `setpos` picks
     * from.
     */
    weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7).optional(),
    /**
     * Monthly only, with weekdays: which of the month's matching days to take.
     * Positive counts from the start, negative from the end, so -1 with
     * Mon–Fri is "the last working day of the month".
     */
    setpos: z.coerce.number().int().min(-5).max(5).refine((n) => n !== 0, {
      message: 'setpos must not be zero',
    }).optional(),
    /** The series' first due date. Set by the server, not the client. */
    anchor: isoDate.optional(),
    /** How many occurrences have been created. Maintained by the database. */
    occurrence: z.coerce.number().int().min(0).optional(),
    /** Last date the series may produce. */
    until: isoDate.optional(),
    /** How many FURTHER occurrences to create after the current one. */
    remaining: z.coerce.number().int().min(0).optional(),
  })
  .strict()
  // setpos needs days to choose from, and a month to choose within. "The third
  // Tuesday" of a week or a day is not a thing.
  .refine((r) => r.setpos === undefined || r.freq === 'monthly', {
    message: 'a position only applies to a monthly rule',
    path: ['setpos'],
  })
  .refine((r) => r.setpos === undefined || (r.weekdays?.length ?? 0) > 0, {
    message: 'a position needs the weekdays it selects from',
    path: ['setpos'],
  })
  // Monthly weekdays without a position would be ambiguous: "monthly on
  // Mondays" could mean any of four or five dates.
  .refine(
    (r) =>
      r.weekdays === undefined ||
      r.freq === 'weekly' ||
      (r.freq === 'monthly' && r.setpos !== undefined),
    {
      message: 'weekdays apply to a weekly rule, or a monthly rule with a position',
      path: ['weekdays'],
    },
  )
  .refine((r) => !r.weekdays || new Set(r.weekdays).size === r.weekdays.length, {
    message: 'weekdays must not repeat',
    path: ['weekdays'],
  })
  .refine((r) => !r.until || !r.anchor || r.until >= r.anchor, {
    message: 'the end date must not be before the series starts',
    path: ['until'],
  });

export type RecurrenceRule = z.infer<typeof recurrenceRule>;

/**
 * What the user may send. The fields the database maintains are stripped
 * rather than rejected, so a form that round-trips an existing rule cannot
 * rewrite the series' anchor and shift every future date.
 */
export const recurrenceInput = recurrenceRule
  .transform(({ anchor: _anchor, occurrence: _occurrence, ...rest }) => rest)
  .nullish();

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ORDINALS: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd', 21: 'st', 22: 'nd', 23: 'rd', 31: 'st' };
const ordinal = (n: number) => `${n}${ORDINALS[n] ?? 'th'}`;

const POSITIONS = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];

/** "Last", "Second-to-last", "Third" — how a person says a setpos. */
function positionWord(setpos: number): string {
  if (setpos > 0) return POSITIONS[setpos - 1] ?? `${ordinal(setpos)}`;
  if (setpos === -1) return 'Last';
  return `${POSITIONS[Math.abs(setpos) - 1] ?? ordinal(Math.abs(setpos))}-to-last`;
}

function listWeekdays(days: number[], short = false): string {
  const names = short ? WEEKDAY_SHORT : WEEKDAY_NAMES;
  const sorted = [...days].sort((a, b) => a - b);

  if (sorted.length === 7) return 'every day';
  if (sorted.length === 5 && sorted.every((d) => d <= 5)) return 'weekdays';
  if (sorted.length === 2 && sorted[0] === 6 && sorted[1] === 7) return 'weekends';


  // The schema pins each day to 1..7, but the index signature does not know
  // that, so fall back to the number rather than printing "undefined".
  const labels = sorted.map((d) => names[d - 1] ?? String(d));
  const last = labels.at(-1);
  if (labels.length === 1 || last === undefined) return labels.join(', ');
  return `${labels.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * Describes a rule the way a person would say it, for the task form and the
 * recurring badge. A rule the user cannot read is a rule they cannot check.
 */
export function describeRecurrence(rule: RecurrenceRule | null | undefined): string | null {
  if (!rule) return null;

  const every = rule.interval ?? 1;
  let text: string;

  if (rule.setpos !== undefined && rule.weekdays?.length) {
    // "Last working day of every month" is the whole point of this rule, so it
    // gets said that way rather than as a weekday list.
    const which =
      rule.weekdays.length === 5 && rule.weekdays.every((d) => d <= 5)
        ? 'working day'
        : listWeekdays(rule.weekdays);
    const period = every === 1 ? 'every month' : `every ${ordinal(every)} month`;
    text = `${positionWord(rule.setpos)} ${which} of ${period}`;
  } else if (rule.freq === 'weekly' && rule.weekdays?.length) {
    const days = listWeekdays(rule.weekdays);
    text = every === 1
      ? `Weekly on ${days}`
      : `Every ${ordinal(every)} week on ${days}`;
  } else {
    const unit = rule.freq === 'daily' ? 'day'
      : rule.freq === 'weekly' ? 'week'
      : rule.freq === 'monthly' ? 'month'
      : 'year';
    text = every === 1 ? `Every ${unit}` : `Every ${every} ${unit}s`;

    // The anchor is what keeps a monthly series on its own date, so it is
    // worth naming: "every month on the 31st" is a different promise from
    // "every month".
    if (rule.anchor && (rule.freq === 'monthly' || rule.freq === 'yearly')) {
      const day = Number(rule.anchor.slice(8, 10));
      if (Number.isFinite(day)) text += ` on the ${ordinal(day)}`;
    }
  }

  if (rule.until) text += `, until ${rule.until}`;
  else if (typeof rule.remaining === 'number') {
    text += rule.remaining === 0
      ? ', ending with this one'
      : `, ${rule.remaining} more time${rule.remaining === 1 ? '' : 's'}`;
  }

  return text;
}

/** Short form for a dense list or a badge. */
export function recurrenceBadge(rule: RecurrenceRule | null | undefined): string | null {
  if (!rule) return null;
  const every = rule.interval ?? 1;

  if (rule.setpos !== undefined && rule.weekdays?.length) {
    const which =
      rule.weekdays.length === 5 && rule.weekdays.every((d) => d <= 5)
        ? 'working day'
        : listWeekdays(rule.weekdays, true);
    const pos = rule.setpos === -1 ? 'Last' : positionWord(rule.setpos);
    return every === 1 ? `${pos} ${which}` : `${pos} ${which} /${every}mo`;
  }
  if (rule.freq === 'weekly' && rule.weekdays?.length) {
    const days = listWeekdays(rule.weekdays, true);
    return every === 1 ? days : `${days} /${every}w`;
  }
  const unit = { daily: 'd', weekly: 'w', monthly: 'mo', yearly: 'y' }[rule.freq];
  return every === 1 ? `Every ${unit}` : `Every ${every}${unit}`;
}

/**
 * Parses a rule off a database row. The column is jsonb, so what comes back is
 * unknown until it is checked; an unreadable rule is reported as absent rather
 * than crashing a task list over one bad row.
 */
export function parseRecurrence(value: unknown): RecurrenceRule | null {
  if (value == null) return null;
  const parsed = recurrenceRule.safeParse(value);
  return parsed.success ? parsed.data : null;
}
