import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { addDays, differenceInCalendarDays, parseISO } from 'date-fns';

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Timestamps are stored in UTC and converted for display. Calendar dates
 * (a task's due_date, a report's report_date) are stored as DATE and are
 * always interpreted in the workspace timezone, never in the server's.
 *
 * Asia/Kolkata is UTC+05:30 year-round with no daylight saving, which is why
 * a fixed UTC cron expression can reliably mean 21:00 IST. See
 * REPORT_CRON_UTC below.
 */

/** ISO calendar date (YYYY-MM-DD) for an instant, as seen in `timeZone`. */
export function calendarDateIn(instant: Date, timeZone = DEFAULT_TIMEZONE): string {
  return formatInTimeZone(instant, timeZone, 'yyyy-MM-dd');
}

/** Today's calendar date in `timeZone`. */
export function todayIn(timeZone = DEFAULT_TIMEZONE, now = new Date()): string {
  return calendarDateIn(now, timeZone);
}

/**
 * The UTC instant at which a calendar date begins in `timeZone`.
 * Used to bound "completed today" queries against timestamptz columns.
 */
export function startOfDayUtc(date: string, timeZone = DEFAULT_TIMEZONE): Date {
  return fromZonedTime(`${date}T00:00:00`, timeZone);
}

/** The UTC instant at which a calendar date ends (exclusive) in `timeZone`. */
export function endOfDayUtc(date: string, timeZone = DEFAULT_TIMEZONE): Date {
  return fromZonedTime(`${addCalendarDays(date, 1)}T00:00:00`, timeZone);
}

export function addCalendarDays(date: string, days: number): string {
  return formatInTimeZone(addDays(parseISO(`${date}T00:00:00Z`), days), 'UTC', 'yyyy-MM-dd');
}

/**
 * The next working day after `date`, skipping Saturday and Sunday. Report
 * sections that talk about "tomorrow's priorities" use this so a Friday
 * evening report points at Monday.
 */
export function nextWorkingDay(date: string): string {
  let next = addCalendarDays(date, 1);
  // 0 = Sunday, 6 = Saturday in UTC terms; the date string is zone-free here.
  for (let guard = 0; guard < 7; guard += 1) {
    const dow = parseISO(`${next}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) return next;
    next = addCalendarDays(next, 1);
  }
  return next;
}

export function formatDateIn(
  value: string | Date,
  timeZone = DEFAULT_TIMEZONE,
  pattern = 'd MMM yyyy',
): string {
  const instant = typeof value === 'string'
    ? (value.length === 10 ? parseISO(`${value}T00:00:00Z`) : parseISO(value))
    : value;
  // A bare calendar date carries no time, so render it as-is rather than
  // shifting it into a zone and risking an off-by-one day.
  if (typeof value === 'string' && value.length === 10) {
    return formatInTimeZone(instant, 'UTC', pattern);
  }
  return formatInTimeZone(instant, timeZone, pattern);
}

export function formatTimeIn(value: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  const instant = typeof value === 'string' ? parseISO(value) : value;
  return formatInTimeZone(instant, timeZone, 'HH:mm');
}

/** Negative when `date` is in the past relative to today in `timeZone`. */
export function daysUntil(date: string, timeZone = DEFAULT_TIMEZONE, now = new Date()): number {
  return differenceInCalendarDays(
    parseISO(`${date}T00:00:00Z`),
    parseISO(`${todayIn(timeZone, now)}T00:00:00Z`),
  );
}

export function isOverdue(
  dueDate: string | null,
  status: string,
  timeZone = DEFAULT_TIMEZONE,
  now = new Date(),
): boolean {
  if (!dueDate) return false;
  // Completion and cancellation end the obligation, so neither can be overdue.
  if (status === 'completed' || status === 'cancelled') return false;
  return dueDate < todayIn(timeZone, now);
}

/** Wall-clock hour and minute in `timeZone`, for verifying the schedule. */
export function localClock(instant: Date, timeZone = DEFAULT_TIMEZONE) {
  return {
    hour: Number(formatInTimeZone(instant, timeZone, 'H')),
    minute: Number(formatInTimeZone(instant, timeZone, 'm')),
  };
}

export function toZoned(instant: Date, timeZone = DEFAULT_TIMEZONE): Date {
  return toZonedTime(instant, timeZone);
}

/** Month boundaries for the calendar grid, as calendar dates in `timeZone`. */
export function monthRange(year: number, month: number) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { first, last };
}

/**
 * 21:00 Asia/Kolkata expressed in UTC for Vercel Cron, which schedules in UTC
 * only: 21:00 - 05:30 = 15:30 UTC. Safe as a fixed expression because IST
 * observes no daylight saving. Asserted in tests/unit/dates.test.ts and
 * re-checked at runtime by the cron route.
 */
export const REPORT_LOCAL_HOUR = 21;
export const REPORT_CRON_UTC = '30 15 * * *';
