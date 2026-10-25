import { z } from 'zod';

/**
 * Matches what PostgreSQL's `uuid` type accepts, which is any valid hex
 * layout. Zod's `uuid()` additionally enforces the RFC 9562 version and
 * variant bits and so rejects ids the database stores happily -- imported
 * data, seeded fixtures, ids minted by other tools. Validating more strictly
 * than the column would refuse legitimate requests, so this is deliberately
 * the looser `guid` check.
 */
export const uuid = z.guid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const taskStatus = z.enum([
  'inbox', 'todo', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled',
]);
export const priority = z.enum(['urgent', 'high', 'medium', 'low']);
export const projectStatus = z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']);
export const milestoneStatus = z.enum(['pending', 'at_risk', 'completed', 'missed']);
export const workspaceRole = z.enum(['owner', 'admin', 'member', 'viewer']);
export const documentSource = z.enum([
  'internal_task', 'internal_project', 'internal_comment', 'internal_note',
  'google_drive', 'email', 'teams', 'notion', 'whatsapp',
]);

/** Open work. Used consistently so "remaining" means the same thing everywhere. */
export const OPEN_STATUSES = ['inbox', 'todo', 'in_progress', 'blocked', 'in_review'] as const;
export const CLOSED_STATUSES = ['completed', 'cancelled'] as const;

export const PRIORITY_ORDER: Record<z.infer<typeof priority>, number> = {
  urgent: 0, high: 1, medium: 2, low: 3,
};

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Trims, collapses whitespace and rejects an empty result. */
export function cleanText(max: number) {
  return z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .refine((s) => s.length > 0, 'must not be empty')
    .refine((s) => s.length <= max, `must be at most ${max} characters`);
}

export const optionalText = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= max, `must be at most ${max} characters`)
    .optional()
    .nullable();
