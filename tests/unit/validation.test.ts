import { describe, expect, it } from 'vitest';
import { createTaskInput, bulkTaskUpdateInput, taskFilters } from '@/lib/validation/tasks';
import { calendarEventInput, createProjectInput } from '@/lib/validation/projects';
import { cleanText } from '@/lib/validation/common';

const WS = '11111111-1111-1111-1111-111111111111';

describe('createTaskInput', () => {
  it('accepts a minimal task and applies visible defaults', () => {
    const parsed = createTaskInput.parse({ workspaceId: WS, title: '  Do the thing  ' });
    expect(parsed.title).toBe('Do the thing');
    expect(parsed.status).toBe('todo');
    expect(parsed.priority).toBe('medium');
    expect(parsed.tags).toEqual([]);
  });

  it('collapses internal whitespace', () => {
    expect(createTaskInput.parse({ workspaceId: WS, title: 'a\n\n  b' }).title).toBe('a b');
  });

  it('rejects an empty or whitespace-only title', () => {
    expect(createTaskInput.safeParse({ workspaceId: WS, title: '   ' }).success).toBe(false);
  });

  it('rejects a start date after the due date', () => {
    const result = createTaskInput.safeParse({
      workspaceId: WS, title: 'x', startDate: '2026-03-20', dueDate: '2026-03-10',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(createTaskInput.safeParse({
      workspaceId: WS, title: 'x', dueDate: '20th March',
    }).success).toBe(false);
  });

  it('rejects a non-uuid workspace', () => {
    expect(createTaskInput.safeParse({ workspaceId: 'nope', title: 'x' }).success).toBe(false);
  });
});

describe('bulkTaskUpdateInput', () => {
  it('requires at least one change', () => {
    expect(bulkTaskUpdateInput.safeParse({ ids: [WS] }).success).toBe(false);
  });

  it('accepts a status change', () => {
    expect(bulkTaskUpdateInput.safeParse({ ids: [WS], status: 'completed' }).success).toBe(true);
  });

  it('accepts clearing the assignee explicitly', () => {
    // null is a real instruction ("unassign"), distinct from omitting the key.
    expect(bulkTaskUpdateInput.safeParse({ ids: [WS], assigneeId: null }).success).toBe(true);
  });

  it('rejects an empty id list and an oversized one', () => {
    expect(bulkTaskUpdateInput.safeParse({ ids: [], status: 'todo' }).success).toBe(false);
    const tooMany = Array.from({ length: 201 }, () => WS);
    expect(bulkTaskUpdateInput.safeParse({ ids: tooMany, status: 'todo' }).success).toBe(false);
  });
});

describe('taskFilters', () => {
  it('defaults to the all view sorted by due date', () => {
    const parsed = taskFilters.parse({ workspaceId: WS });
    expect(parsed.view).toBe('all');
    expect(parsed.sortBy).toBe('due_date');
    expect(parsed.sortDir).toBe('asc');
  });

  it('accepts the named views', () => {
    for (const view of ['mine', 'overdue', 'blocked', 'completed', 'unscheduled']) {
      expect(taskFilters.safeParse({ workspaceId: WS, view }).success).toBe(true);
    }
  });

  it('rejects an unknown view', () => {
    expect(taskFilters.safeParse({ workspaceId: WS, view: 'everything' }).success).toBe(false);
  });
});

describe('calendarEventInput', () => {
  it('accepts an all-day event with a date', () => {
    expect(calendarEventInput.safeParse({
      workspaceId: WS, title: 'Offsite', isAllDay: true, startDate: '2026-03-15',
    }).success).toBe(true);
  });

  it('accepts a timed event with an instant', () => {
    expect(calendarEventInput.safeParse({
      workspaceId: WS, title: 'Board call', isAllDay: false,
      startsAt: '2026-03-15T10:00:00.000Z',
    }).success).toBe(true);
  });

  it('rejects an all-day event given an instant', () => {
    // Mirrors the database CHECK, so a bad payload fails readably first.
    expect(calendarEventInput.safeParse({
      workspaceId: WS, title: 'Bad', isAllDay: true,
      startsAt: '2026-03-15T10:00:00.000Z',
    }).success).toBe(false);
  });

  it('rejects a timed event given only a date', () => {
    expect(calendarEventInput.safeParse({
      workspaceId: WS, title: 'Bad', isAllDay: false, startDate: '2026-03-15',
    }).success).toBe(false);
  });
});

describe('createProjectInput', () => {
  it('rejects a target date before the start date', () => {
    expect(createProjectInput.safeParse({
      workspaceId: WS, name: 'x', startDate: '2026-04-01', targetDate: '2026-03-01',
    }).success).toBe(false);
  });
});

describe('cleanText', () => {
  it('enforces the maximum length after trimming', () => {
    const schema = cleanText(5);
    expect(schema.safeParse('  abc  ').success).toBe(true);
    expect(schema.safeParse('abcdef').success).toBe(false);
  });
});
