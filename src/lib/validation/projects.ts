import { z } from 'zod';
import { cleanText, isoDate, milestoneStatus, optionalText, priority, projectStatus, uuid } from './common';

export const createProjectInput = z.object({
  workspaceId: uuid,
  name: cleanText(200),
  description: optionalText(20_000),
  status: projectStatus.default('planning'),
  priority: priority.default('medium'),
  ownerId: uuid.nullish(),
  startDate: isoDate.nullish(),
  targetDate: isoDate.nullish(),
}).refine(
  (v) => !v.startDate || !v.targetDate || v.startDate <= v.targetDate,
  { message: 'start date must not be after target date', path: ['targetDate'] },
);

export const updateProjectInput = z.object({
  id: uuid,
  name: cleanText(200).optional(),
  description: optionalText(20_000),
  status: projectStatus.optional(),
  priority: priority.optional(),
  ownerId: uuid.nullish(),
  startDate: isoDate.nullish(),
  targetDate: isoDate.nullish(),
});

export const milestoneInput = z.object({
  projectId: uuid,
  name: cleanText(200),
  description: optionalText(5_000),
  dueDate: isoDate.nullish(),
  status: milestoneStatus.default('pending'),
});

export const calendarEventInput = z.object({
  workspaceId: uuid,
  title: cleanText(300),
  description: optionalText(5_000),
  location: optionalText(300),
  projectId: uuid.nullish(),
  isAllDay: z.boolean().default(false),
  startDate: isoDate.nullish(),
  endDate: isoDate.nullish(),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
}).refine(
  // Mirrors the calendar_events_shape CHECK constraint, so a bad payload is
  // rejected with a readable message before it reaches the database.
  (v) => (v.isAllDay ? Boolean(v.startDate) && !v.startsAt : Boolean(v.startsAt) && !v.startDate),
  { message: 'an all-day event needs startDate; a timed event needs startsAt' },
);

export const noteInput = z.object({
  workspaceId: uuid,
  projectId: uuid.nullish(),
  title: cleanText(300),
  body: z.string().max(200_000).default(''),
});

export type CreateProjectInput = z.infer<typeof createProjectInput>;
