import { describe, expect, it } from 'vitest';
import {
  REPORT_CRON_UTC,
  REPORT_LOCAL_HOUR,
  addCalendarDays,
  calendarDateIn,
  daysUntil,
  endOfDayUtc,
  formatDateIn,
  isOverdue,
  localClock,
  monthRange,
  nextWorkingDay,
  startOfDayUtc,
  startOfWeek,
  todayIn,
  weekDates,
} from '@/lib/dates';

describe('timezone handling', () => {
  it('reports the Indian calendar date for an instant late in the UTC day', () => {
    // 19:00 UTC on 1 Jan is already 00:30 on 2 Jan in Kolkata (+05:30).
    const instant = new Date('2026-01-01T19:00:00Z');
    expect(calendarDateIn(instant, 'Asia/Kolkata')).toBe('2026-01-02');
    expect(calendarDateIn(instant, 'UTC')).toBe('2026-01-01');
  });

  it('bounds an IST day at the right UTC instants', () => {
    // An IST day starts at 18:30 UTC the day before.
    expect(startOfDayUtc('2026-03-15', 'Asia/Kolkata').toISOString())
      .toBe('2026-03-14T18:30:00.000Z');
    expect(endOfDayUtc('2026-03-15', 'Asia/Kolkata').toISOString())
      .toBe('2026-03-15T18:30:00.000Z');
  });

  it('renders a bare calendar date without shifting it into a zone', () => {
    // The classic off-by-one: a date-only value must not move when displayed.
    expect(formatDateIn('2026-03-15', 'America/Los_Angeles', 'yyyy-MM-dd'))
      .toBe('2026-03-15');
  });

  it('keeps the cron expression equal to 21:00 IST', () => {
    expect(REPORT_CRON_UTC).toBe('30 15 * * *');
    const [minute, hour] = REPORT_CRON_UTC.split(' ');
    // IST is UTC+05:30 with no daylight saving, so the arithmetic is exact.
    const utcMinutes = Number(hour) * 60 + Number(minute);
    const istMinutes = (utcMinutes + 5 * 60 + 30) % (24 * 60);
    expect(istMinutes).toBe(REPORT_LOCAL_HOUR * 60);
  });

  it('agrees that the cron instant is 21:00 local time', () => {
    const fired = new Date('2026-06-15T15:30:00Z');
    expect(localClock(fired, 'Asia/Kolkata')).toEqual({ hour: 21, minute: 0 });
  });

  it('is stable across the northern summer, since IST has no DST', () => {
    for (const month of ['01', '04', '07', '10']) {
      const fired = new Date(`2026-${month}-15T15:30:00Z`);
      expect(localClock(fired, 'Asia/Kolkata').hour).toBe(21);
    }
  });
});

describe('calendar arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles a leap year', () => {
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(monthRange(2028, 2).last).toBe('2028-02-29');
  });

  it('skips the weekend when looking ahead to the next working day', () => {
    // 2026-03-13 is a Friday.
    expect(nextWorkingDay('2026-03-13')).toBe('2026-03-16');
    expect(nextWorkingDay('2026-03-16')).toBe('2026-03-17');
  });

  it('counts days relative to today in the given zone', () => {
    const now = new Date('2026-03-15T06:00:00Z');
    expect(todayIn('Asia/Kolkata', now)).toBe('2026-03-15');
    expect(daysUntil('2026-03-18', 'Asia/Kolkata', now)).toBe(3);
    expect(daysUntil('2026-03-14', 'Asia/Kolkata', now)).toBe(-1);
  });
});

describe('overdue', () => {
  const now = new Date('2026-03-15T06:00:00Z');

  it('treats a past due date on open work as overdue', () => {
    expect(isOverdue('2026-03-14', 'todo', 'Asia/Kolkata', now)).toBe(true);
  });

  it('does not treat today as overdue', () => {
    expect(isOverdue('2026-03-15', 'todo', 'Asia/Kolkata', now)).toBe(false);
  });

  it('never calls completed or cancelled work overdue', () => {
    expect(isOverdue('2026-01-01', 'completed', 'Asia/Kolkata', now)).toBe(false);
    expect(isOverdue('2026-01-01', 'cancelled', 'Asia/Kolkata', now)).toBe(false);
  });

  it('treats undated work as not overdue', () => {
    expect(isOverdue(null, 'todo', 'Asia/Kolkata', now)).toBe(false);
  });
});

describe('startOfWeek and weekDates', () => {
  it('returns the Monday of the week, from any day in it', () => {
    // 2026-10-25 is a Sunday, so its week began on Monday the 19th. Getting
    // this wrong by a day shifts a whole week view.
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19');
    expect(startOfWeek('2026-10-19')).toBe('2026-10-19');
    expect(startOfWeek('2026-10-20')).toBe('2026-10-19');
    expect(startOfWeek('2026-10-24')).toBe('2026-10-19');
    expect(startOfWeek('2026-10-26')).toBe('2026-10-26');
  });

  it('crosses a month and a year boundary', () => {
    expect(startOfWeek('2026-11-01')).toBe('2026-10-26');
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28');
  });

  it('gives seven consecutive dates, Monday first', () => {
    const week = weekDates('2026-10-25');
    expect(week).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22',
      '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
  });

  it('spans a DST change in a zone that has one without losing a day', () => {
    // The dates are zone-free, so a week is always seven days even across a
    // transition that would shorten a day in a local-time calculation.
    expect(weekDates('2026-03-29')).toHaveLength(7);
    expect(weekDates('2026-10-25')).toHaveLength(7);
  });
});
