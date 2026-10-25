import { z } from 'zod';

/**
 * Output contracts for every model call. These are the only shapes the
 * application accepts back; anything else is rejected rather than coerced.
 */

/** Which fields the model guessed. Rendered as "unconfirmed" in the review UI. */
export const uncertainField = z.enum([
  'title', 'description', 'assignee', 'due_date', 'priority', 'project', 'effort',
]);

export const extractedTask = z.object({
  title: z
    .string()
    .min(1)
    .max(300)
    .describe('Imperative, specific action. Never invent work that was not stated.'),
  description: z
    .string()
    .max(4000)
    .nullable()
    .describe('Extra context found in the source. Null when none was given.'),
  assignee_name: z
    .string()
    .max(120)
    .nullable()
    .describe('Person named as the owner, verbatim as written. Null if nobody was named.'),
  due_date_text: z
    .string()
    .max(120)
    .nullable()
    .describe('The deadline exactly as expressed, e.g. "by Friday", "next Tuesday".'),
  due_date_iso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .describe('due_date_text resolved against the supplied current date, or null if unclear.'),
  priority: z
    .enum(['urgent', 'high', 'medium', 'low'])
    .nullable()
    .describe('Only when the source signals urgency. Null otherwise -- do not default it.'),
  project_hint: z
    .string()
    .max(200)
    .nullable()
    .describe('Project or workstream named in the source. Null if none.'),
  estimated_minutes: z.number().int().min(0).max(100_000).nullable(),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('How clearly this was stated as an action to take.'),
  uncertain_fields: z
    .array(uncertainField)
    .describe('Every field above that was inferred rather than stated.'),
  source_excerpt: z
    .string()
    .max(1000)
    .describe('Verbatim quote from the source that this task came from.'),
  notes: z
    .string()
    .max(1000)
    .nullable()
    .describe('What a human reviewer needs to decide, if anything is ambiguous.'),
});

export const extractionResult = z.object({
  tasks: z.array(extractedTask).max(40),
  decisions: z
    .array(z.string().max(500))
    .max(20)
    .describe('Decisions recorded in the source. Not tasks.'),
  blockers: z.array(z.string().max(500)).max(20),
  open_questions: z.array(z.string().max(500)).max(20),
  summary: z.string().max(2000),
  /**
   * Set when the source text tried to issue instructions to the extractor
   * rather than merely describing work. Surfaced to the user, because it is
   * worth knowing that a captured message attempted it.
   */
  contained_instruction_attempt: z.boolean(),
});

export type ExtractionResult = z.infer<typeof extractionResult>;
export type ExtractedTask = z.infer<typeof extractedTask>;

/** Grounded answer for AI search. Every claim must cite retrieved records. */
export const groundedAnswer = z.object({
  answer: z
    .string()
    .max(4000)
    .describe('Answer built only from the supplied records. No outside knowledge.'),
  citations: z
    .array(
      z.object({
        ref: z.string().max(40).describe('The [n] reference id from the supplied records.'),
        supports: z.string().max(400).describe('The specific claim this record supports.')
      }),
    )
    .max(30),
  /** Statements the model reasoned to rather than read. Shown separately. */
  inferences: z.array(z.string().max(500)).max(10),
  /** True when the retrieved records genuinely do not answer the question. */
  insufficient_evidence: z.boolean(),
  missing: z
    .string()
    .max(500)
    .nullable()
    .describe('What would be needed to answer properly, when evidence is insufficient.'),
});

export type GroundedAnswer = z.infer<typeof groundedAnswer>;

/** Narrative wrapper for a daily report. The counts never come from here. */
export const reportNarrative = z.object({
  headline: z.string().max(300),
  attention: z
    .array(z.string().max(300))
    .max(6)
    .describe('What needs a decision or is at risk, drawn only from the supplied records.'),
  tomorrow: z.array(z.string().max(300)).max(6),
});

export type ReportNarrative = z.infer<typeof reportNarrative>;
