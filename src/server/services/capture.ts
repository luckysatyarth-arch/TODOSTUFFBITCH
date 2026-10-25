import { createSupabaseServerClient, type SupabaseAdminClient } from '@/lib/supabase/server';
import { extractTasks, matchName, sanitiseDueDate } from '@/server/ai/extraction';
import { findDuplicate } from '@/server/ai/duplicates';
import { todayIn } from '@/lib/dates';
import type { Database } from '@/lib/supabase/database.types';

type CaptureKind = Database['public']['Enums']['capture_kind'];
type SupabaseLike = SupabaseAdminClient | Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface RunExtractionOptions {
  captureId: string;
  /**
   * Pass the admin client when running from a webhook or background job,
   * where there is no user session to act under. Omit it for an interactive
   * request so the work happens under the caller's RLS.
   */
  client?: SupabaseLike;
}

export interface ExtractionOutcome {
  proposalCount: number;
  duplicateCount: number;
  instructionAttempt: boolean;
  summary: string;
}

/**
 * Runs the extraction pipeline for one capture and stores the proposals.
 *
 * Nothing in here creates a task. Every candidate lands in proposed_tasks
 * with status 'pending' and waits for a person, which is what the brief
 * requires: approval is mandatory, and the AI never assigns or schedules
 * anything on its own.
 *
 * Safe to run twice: existing pending proposals for the capture are cleared
 * first, so a retried job re-proposes rather than duplicating.
 */
export async function runExtractionForCapture(
  options: RunExtractionOptions,
): Promise<ExtractionOutcome> {
  const supabase = options.client ?? (await createSupabaseServerClient());

  const { data: capture, error: captureError } = await supabase
    .from('captures')
    .select('id, workspace_id, owner_id, kind, raw_text, title')
    .eq('id', options.captureId)
    .maybeSingle();

  if (captureError) throw new Error(`Could not load capture: ${captureError.message}`);
  if (!capture) throw new Error('Capture not found.');

  const text = capture.raw_text?.trim();
  if (!text) {
    await supabase
      .from('captures')
      .update({ status: 'failed', error_message: 'No text to extract from.' })
      .eq('id', capture.id);
    return {
      proposalCount: 0, duplicateCount: 0, instructionAttempt: false,
      summary: 'Nothing to extract: the capture has no text.',
    };
  }

  await supabase.from('captures').update({ status: 'extracting' }).eq('id', capture.id);

  try {
    const [{ data: workspace }, { data: members }, { data: projects }, { data: openTasks }] =
      await Promise.all([
        supabase.from('workspaces').select('timezone').eq('id', capture.workspace_id).maybeSingle(),
        supabase.from('workspace_members')
          .select('user_id, profiles(full_name)').eq('workspace_id', capture.workspace_id),
        supabase.from('projects').select('id, name')
          .eq('workspace_id', capture.workspace_id).is('archived_at', null),
        // Candidate set for duplicate detection: open tasks only.
        supabase.from('tasks').select('id, title, status')
          .eq('workspace_id', capture.workspace_id)
          .not('status', 'in', '("completed","cancelled")')
          .limit(1000),
      ]);

    const timezone = workspace?.timezone ?? 'Asia/Kolkata';
    const today = todayIn(timezone);

    const people = (members ?? []).map((m) => ({
      id: m.user_id,
      name: (m.profiles as { full_name: string | null } | null)?.full_name ?? null,
    }));

    const { result } = await extractTasks(text, {
      today,
      timezone,
      memberNames: people.map((p) => p.name).filter((n): n is string => Boolean(n)),
      projectNames: (projects ?? []).map((p) => p.name),
      sourceLabel: labelForKind(capture.kind),
    });

    // Clear prior pending proposals so a re-run replaces rather than stacks.
    // Approved ones are left alone: they have already produced real tasks.
    await supabase
      .from('proposed_tasks')
      .delete()
      .eq('capture_id', capture.id)
      .eq('status', 'pending');

    let duplicateCount = 0;

    const rows = result.tasks.map((task) => {
      const { dueDate, rejected } = sanitiseDueDate(task.due_date_iso, today);

      // A date the model produced but we could not trust is still shown to the
      // reviewer as uncertain, with the original wording preserved.
      const uncertain = new Set<string>(task.uncertain_fields);
      if (rejected) uncertain.add('due_date');
      if (task.assignee_name && !matchName(task.assignee_name, people)) uncertain.add('assignee');

      const projectMatch = task.project_hint
        ? (projects ?? []).find(
            (p) => p.name.toLowerCase() === task.project_hint!.trim().toLowerCase(),
          )
        : undefined;
      if (task.project_hint && !projectMatch) uncertain.add('project');

      const duplicate = findDuplicate(task.title, openTasks ?? []);
      if (duplicate) duplicateCount += 1;

      const noteParts: string[] = [];
      if (task.notes) noteParts.push(task.notes);
      if (rejected && task.due_date_text) {
        noteParts.push(
          `Could not resolve "${task.due_date_text}" to a date; left for you to set.`,
        );
      }
      if (task.assignee_name && !matchName(task.assignee_name, people)) {
        noteParts.push(`Mentioned "${task.assignee_name}", who is not a member of this workspace.`);
      }
      if (task.project_hint && !projectMatch) {
        noteParts.push(`Mentioned project "${task.project_hint}", which does not exist yet.`);
      }

      return {
        capture_id: capture.id,
        workspace_id: capture.workspace_id,
        status: 'pending' as const,
        title: task.title,
        description: task.description,
        suggested_assignee_id: matchName(task.assignee_name, people),
        suggested_project_id: projectMatch?.id ?? null,
        suggested_due_date: dueDate,
        // Null priority stays null: the application applies 'medium' visibly
        // at approval rather than the model inventing urgency.
        suggested_priority: task.priority,
        estimated_minutes: task.estimated_minutes,
        confidence: task.confidence,
        uncertain_fields: [...uncertain],
        extraction_notes: noteParts.length ? noteParts.join(' ') : null,
        source_excerpt: task.source_excerpt,
        duplicate_of_task_id: duplicate?.taskId ?? null,
        duplicate_similarity: duplicate?.similarity ?? null,
      };
    });

    if (rows.length > 0) {
      const { error } = await supabase.from('proposed_tasks').insert(rows);
      if (error) throw new Error(`Could not store proposals: ${error.message}`);
    }

    const summary = buildSummary(result.summary, result.decisions, result.blockers, result.open_questions);

    await supabase
      .from('captures')
      .update({
        status: 'ready',
        error_message: null,
        processed_at: new Date().toISOString(),
        source_metadata: {
          summary,
          decisions: result.decisions,
          blockers: result.blockers,
          open_questions: result.open_questions,
          instruction_attempt: result.contained_instruction_attempt,
        },
      })
      .eq('id', capture.id);

    return {
      proposalCount: rows.length,
      duplicateCount,
      instructionAttempt: result.contained_instruction_attempt,
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Extraction failed.';
    await supabase
      .from('captures')
      .update({ status: 'failed', error_message: message })
      .eq('id', capture.id);
    throw error;
  }
}

function labelForKind(kind: CaptureKind): string {
  switch (kind) {
    case 'voice': return 'voice note transcript';
    case 'whatsapp': return 'forwarded WhatsApp message';
    case 'meeting_transcript': return 'meeting transcript';
    case 'email': return 'email message';
    default: return 'typed note';
  }
}

function buildSummary(
  summary: string, decisions: string[], blockers: string[], questions: string[],
): string {
  const parts = [summary.trim()].filter(Boolean);
  if (decisions.length) parts.push(`Decisions: ${decisions.join('; ')}`);
  if (blockers.length) parts.push(`Blockers: ${blockers.join('; ')}`);
  if (questions.length) parts.push(`Open questions: ${questions.join('; ')}`);
  return parts.join('\n');
}
