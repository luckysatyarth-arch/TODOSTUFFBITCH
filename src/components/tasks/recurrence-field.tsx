'use client';

import { Input, Label, Select } from '@/components/ui/input';
import {
  describeRecurrence,
  RECURRENCE_FREQUENCIES,
  type RecurrenceRule,
} from '@/lib/validation/recurrence';

/**
 * The recurrence control.
 *
 * It shows the rule back in words as it is edited, because a repeat rule is
 * the one field whose effect the user cannot see from the form: the next
 * occurrence does not exist yet. "Every month on the 31st" is a different
 * promise from "every month", and this is where that difference is visible.
 */

const WEEKDAYS = [
  { value: 1, label: 'M' }, { value: 2, label: 'T' }, { value: 3, label: 'W' },
  { value: 4, label: 'T' }, { value: 5, label: 'F' }, { value: 6, label: 'S' },
  { value: 7, label: 'S' },
] as const;

const FREQUENCY_LABELS: Record<(typeof RECURRENCE_FREQUENCIES)[number], string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly',
};

export type RecurrenceDraft = {
  enabled: boolean;
  freq: RecurrenceRule['freq'];
  interval: string;
  weekdays: number[];
  ends: 'never' | 'on' | 'after';
  until: string;
  remaining: string;
};

export function emptyRecurrenceDraft(): RecurrenceDraft {
  return {
    enabled: false, freq: 'weekly', interval: '1', weekdays: [],
    ends: 'never', until: '', remaining: '',
  };
}

/** Turns a stored rule into form state. */
export function recurrenceToDraft(rule: RecurrenceRule | null | undefined): RecurrenceDraft {
  if (!rule) return emptyRecurrenceDraft();
  return {
    enabled: true,
    freq: rule.freq,
    interval: String(rule.interval ?? 1),
    weekdays: rule.weekdays ?? [],
    ends: rule.until ? 'on' : typeof rule.remaining === 'number' ? 'after' : 'never',
    until: rule.until ?? '',
    remaining: rule.remaining != null ? String(rule.remaining) : '',
  };
}

/**
 * Turns form state into a rule to send, or null for "does not repeat".
 *
 * `anchor` and `occurrence` are deliberately absent: the server sets the
 * anchor from the due date and the database maintains the position in the
 * series, so a form cannot shift an existing series by saving it again.
 */
export function draftToRecurrence(draft: RecurrenceDraft): RecurrenceRule | null {
  if (!draft.enabled) return null;

  const interval = Number(draft.interval);
  const rule: RecurrenceRule = {
    freq: draft.freq,
    ...(Number.isFinite(interval) && interval > 1 ? { interval } : {}),
    ...(draft.freq === 'weekly' && draft.weekdays.length
      ? { weekdays: [...draft.weekdays].sort((a, b) => a - b) }
      : {}),
    ...(draft.ends === 'on' && draft.until ? { until: draft.until } : {}),
    ...(draft.ends === 'after' && draft.remaining !== ''
      ? { remaining: Number(draft.remaining) }
      : {}),
  };
  return rule;
}

export function RecurrenceField({
  draft, onChange, dueDate,
}: {
  draft: RecurrenceDraft;
  onChange: (next: RecurrenceDraft) => void;
  dueDate: string | null;
}) {
  const set = (patch: Partial<RecurrenceDraft>) => onChange({ ...draft, ...patch });

  // Describe the rule with the due date as its anchor, which is what the
  // server will use, so the preview matches what actually gets stored.
  const preview = describeRecurrence(
    draft.enabled
      ? { ...draftToRecurrence(draft)!, ...(dueDate ? { anchor: dueDate } : {}) }
      : null,
  );

  function toggleWeekday(value: number) {
    set({
      weekdays: draft.weekdays.includes(value)
        ? draft.weekdays.filter((d) => d !== value)
        : [...draft.weekdays, value],
    });
  }

  return (
    <div className="rounded-lg border border-line bg-surface-sunken/40 p-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
          className="size-4 accent-[var(--color-accent)]"
        />
        <span className="font-medium">Repeats</span>
      </label>

      {draft.enabled ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <div>
              <Label htmlFor="r-freq">Frequency</Label>
              <Select
                id="r-freq"
                value={draft.freq}
                onChange={(e) =>
                  set({
                    freq: e.target.value as RecurrenceRule['freq'],
                    // Weekdays only mean anything on a weekly rule, and the
                    // database rejects them elsewhere.
                    weekdays: e.target.value === 'weekly' ? draft.weekdays : [],
                  })
                }
              >
                {RECURRENCE_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="r-interval">Every</Label>
              <Input
                id="r-interval"
                type="number"
                min={1}
                max={366}
                value={draft.interval}
                onChange={(e) => set({ interval: e.target.value })}
              />
            </div>
          </div>

          {draft.freq === 'weekly' ? (
            <div>
              <span className="mb-1 block text-xs font-medium text-ink-soft">On</span>
              <div className="flex gap-1">
                {WEEKDAYS.map((day, index) => {
                  const active = draft.weekdays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      aria-pressed={active}
                      aria-label={
                        ['Monday', 'Tuesday', 'Wednesday', 'Thursday',
                          'Friday', 'Saturday', 'Sunday'][index]
                      }
                      onClick={() => toggleWeekday(day.value)}
                      className={`size-8 rounded-md border text-xs transition ${
                        active
                          ? 'border-transparent bg-[var(--color-accent)] text-white'
                          : 'border-line text-ink-soft hover:border-ink-faint'
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
              {draft.weekdays.length === 0 ? (
                <p className="mt-1 text-[11px] text-ink-faint">
                  No days selected, so it repeats on the same weekday as the due date.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <div>
              <Label htmlFor="r-ends">Ends</Label>
              <Select
                id="r-ends"
                value={draft.ends}
                onChange={(e) => set({ ends: e.target.value as RecurrenceDraft['ends'] })}
              >
                <option value="never">Never</option>
                <option value="on">On a date</option>
                <option value="after">After a number of times</option>
              </Select>
            </div>

            {draft.ends === 'on' ? (
              <div>
                <Label htmlFor="r-until">Last date</Label>
                <Input
                  id="r-until"
                  type="date"
                  value={draft.until}
                  onChange={(e) => set({ until: e.target.value })}
                />
              </div>
            ) : null}

            {draft.ends === 'after' ? (
              <div>
                <Label htmlFor="r-remaining">Further occurrences</Label>
                <Input
                  id="r-remaining"
                  type="number"
                  min={0}
                  value={draft.remaining}
                  onChange={(e) => set({ remaining: e.target.value })}
                />
              </div>
            ) : null}
          </div>

          {preview ? (
            <p className="text-xs text-ink-soft">
              <span className="text-ink-faint">Preview: </span>{preview}
            </p>
          ) : null}

          {!dueDate ? (
            <p className="text-[11px] text-high">
              Set a due date so the series has a date to repeat from. Without one,
              the next occurrence is counted from the day this is completed.
            </p>
          ) : null}

          <p className="text-[11px] text-ink-faint">
            The next occurrence is created when you mark this one Completed — not
            when the due date passes.
          </p>
        </div>
      ) : null}
    </div>
  );
}
