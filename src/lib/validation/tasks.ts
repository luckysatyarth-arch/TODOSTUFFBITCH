import { z } from 'zod';
import { cleanText, isoDate, optionalText, priority, taskStatus, uuid } from './common';

export const createTaskInput = z.object({
  workspaceId: uuid,
  title: cleanText(500),
  description: optionalText(20_000),
  status: taskStatus.default('todo'),
  priority: priority.default('medium'),
  projectId: uuid.nullish(),
  parentTaskId: uuid.nullish(),
  assigneeId: uuid.nullish(),
  startDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  estimatedMinutes: z.coerce.number().int().min(0).max(100_000).nullish(),
  tags: z.array(cleanText(40)).max(20).default([]),
  sourceCaptureId: uuid.nullish(),
}).refine(
  (v) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate,
  { message: 'start date must not be after due date', path: ['dueDate'] },
);

export const updateTaskInput = z.object({
  id: uuid,
  title: cleanText(500).optional(),
  description: optionalText(20_000),
  status: taskStatus.optional(),
  priority: priority.optional(),
  projectId: uuid.nullish(),
  assigneeId: uuid.nullish(),
  startDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  estimatedMinutes: z.coerce.number().int().min(0).max(100_000).nullish(),
  actualMinutes: z.coerce.number().int().min(0).max(100_000).nullish(),
  tags: z.array(cleanText(40)).max(20).optional(),
  boardPosition: z.number().optional(),
});

export const bulkTaskUpdateInput = z.object({
  ids: z.array(uuid).min(1).max(200),
  status: taskStatus.optional(),
  priority: priority.optional(),
  assigneeId: uuid.nullish(),
  projectId: uuid.nullish(),
  dueDate: isoDate.nullish(),
}).refine(
  (v) =>
    v.status !== undefined || v.priority !== undefined ||
    v.assigneeId !== undefined || v.projectId !== undefined || v.dueDate !== undefined,
  { message: 'nothing to change' },
);

export const taskFilters = z.object({
  workspaceId: uuid,
  status: z.array(taskStatus).optional(),
  priority: z.array(priority).optional(),
  assigneeId: z.union([uuid, z.literal('unassigned'), z.literal('me')]).optional(),
  projectId: z.union([uuid, z.literal('none')]).optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  search: z.string().max(200).optional(),
  tags: z.array(z.string().max(40)).optional(),
  // 'overdue' and 'unscheduled' are derived rather than stored, so they are
  // expressed as named views instead of raw filters.
  view: z.enum(['all', 'mine', 'overdue', 'blocked', 'completed', 'unscheduled']).default('all'),
  groupBy: z.enum(['none', 'status', 'priority', 'assignee', 'project', 'due']).default('none'),
  sortBy: z.enum(['due_date', 'priority', 'created_at', 'updated_at', 'title']).default('due_date'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});

export const commentInput = z.object({
  taskId: uuid,
  body: cleanText(10_000),
});

export const dependencyInput = z.object({
  taskId: uuid,
  dependsOnTaskId: uuid,
}).refine((v) => v.taskId !== v.dependsOnTaskId, {
  message: 'a task cannot depend on itself',
});

export type CreateTaskInput = z.infer<typeof createTaskInput>;
export type UpdateTaskInput = z.infer<typeof updateTaskInput>;
export type TaskFilters = z.infer<typeof taskFilters>;
