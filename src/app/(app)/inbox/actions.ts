'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  assertCanWrite, requireSession, requireWorkspace, AuthorizationError,
} from '@/server/auth';
import { runExtractionForCapture } from '@/server/services/capture';
import { transcribeStoredAudio } from '@/server/services/transcription';
import { cleanText, isoDate, priority, uuid } from '@/lib/validation/common';
import type { ActionResult } from '../actions';

const textCaptureInput = z.object({
  workspaceId: uuid,
  text: cleanText(50_000),
  kind: z.enum(['text', 'meeting_transcript', 'whatsapp', 'email']).default('text'),
  title: z.string().trim().max(300).optional(),
});

const audioCaptureInput = z.object({
  workspaceId: uuid,
  storagePath: z.string().min(1).max(500),
  mimeType: z.string().max(100).optional(),
  durationSeconds: z.number().min(0).max(14_400).optional(),
  title: z.string().trim().max(300).optional(),
});

const approvalInput = z.object({
  proposalId: uuid,
  title: cleanText(500).optional(),
  description: z.string().max(20_000).nullish(),
  projectId: uuid.nullish(),
  assigneeId: uuid.nullish(),
  dueDate: isoDate.nullish(),
  priority: priority.nullish(),
});

function fail(error: unknown): ActionResult<never> {
  if (error instanceof AuthorizationError) return { ok: false, error: error.message };
  if (error instanceof z.ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? 'Invalid input.' };
  }
  if (error instanceof Error) return { ok: false, error: error.message };
  return { ok: false, error: 'Unexpected error.' };
}

/** Captures are owner-scoped, so a write needs both membership and ownership. */
async function captureContext(workspaceId: string) {
  const session = await requireSession();
  const workspace = await requireWorkspace(session, workspaceId);
  assertCanWrite(workspace);
  const supabase = await createSupabaseServerClient();
  return { session, workspace, supabase };
}

/**
 * Captures typed or pasted text and extracts proposals from it.
 *
 * Extraction runs inline here because it is a direct response to a user
 * action and they are waiting on the result. Audio takes the asynchronous
 * path instead, since transcription is slow.
 */
export async function captureText(raw: unknown): Promise<ActionResult<{
  captureId: string; proposalCount: number; instructionAttempt: boolean;
}>> {
  try {
    const input = textCaptureInput.parse(raw);
    const { session, supabase } = await captureContext(input.workspaceId);

    const { data: capture, error } = await supabase
      .from('captures')
      .insert({
        workspace_id: input.workspaceId,
        owner_id: session.userId,
        kind: input.kind,
        status: 'extracting',
        title: input.title ?? null,
        raw_text: input.text,
        source_provider: 'manual',
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);

    const outcome = await runExtractionForCapture({ captureId: capture.id, client: supabase });
    revalidatePath('/inbox');
    revalidatePath('/home');

    return {
      ok: true,
      data: {
        captureId: capture.id,
        proposalCount: outcome.proposalCount,
        instructionAttempt: outcome.instructionAttempt,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Registers an already-uploaded audio file and starts transcription.
 *
 * The browser uploads straight to private storage under its own user id, so
 * audio never passes through a server action body.
 */
export async function captureAudio(raw: unknown): Promise<ActionResult<{ captureId: string }>> {
  try {
    const input = audioCaptureInput.parse(raw);
    const { session, supabase } = await captureContext(input.workspaceId);

    // The storage policy already restricts writes to the caller's own prefix;
    // this rejects a mismatched path before a row is created.
    if (!input.storagePath.startsWith(`${session.userId}/`)) {
      throw new AuthorizationError('That upload path does not belong to you.');
    }

    const { data: capture, error } = await supabase
      .from('captures')
      .insert({
        workspace_id: input.workspaceId,
        owner_id: session.userId,
        kind: 'voice',
        status: 'pending',
        title: input.title ?? null,
        storage_path: input.storagePath,
        mime_type: input.mimeType ?? null,
        duration_seconds: input.durationSeconds ?? null,
        source_provider: 'upload',
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);

    revalidatePath('/inbox');
    return { ok: true, data: { captureId: capture.id } };
  } catch (error) {
    return fail(error);
  }
}

/** Transcribes a stored recording, then extracts proposals from the result. */
export async function transcribeCapture(captureId: string): Promise<ActionResult<{
  proposalCount: number;
}>> {
  try {
    const id = uuid.parse(captureId);
    const session = await requireSession();
    const supabase = await createSupabaseServerClient();

    const { data: capture } = await supabase
      .from('captures').select('id, owner_id, workspace_id, storage_path').eq('id', id).maybeSingle();
    if (!capture) throw new AuthorizationError('Capture not found.');
    if (capture.owner_id !== session.userId) {
      throw new AuthorizationError('That capture is not yours.');
    }
    if (!capture.storage_path) throw new Error('This capture has no audio file.');

    await transcribeStoredAudio({ captureId: id, storagePath: capture.storage_path });
    const outcome = await runExtractionForCapture({ captureId: id, client: supabase });

    revalidatePath('/inbox');
    return { ok: true, data: { proposalCount: outcome.proposalCount } };
  } catch (error) {
    return fail(error);
  }
}

/** Replaces a transcript with a corrected one, then re-extracts from it. */
export async function updateTranscript(
  captureId: string, text: string,
): Promise<ActionResult<{ proposalCount: number }>> {
  try {
    const id = uuid.parse(captureId);
    const body = cleanText(100_000).parse(text);
    const session = await requireSession();
    const supabase = await createSupabaseServerClient();

    const { data: capture } = await supabase
      .from('captures').select('id, owner_id').eq('id', id).maybeSingle();
    if (!capture) throw new AuthorizationError('Capture not found.');
    if (capture.owner_id !== session.userId) {
      throw new AuthorizationError('That capture is not yours.');
    }

    const { error } = await supabase.from('captures')
      .update({ raw_text: body }).eq('id', id);
    if (error) throw new Error(error.message);

    const outcome = await runExtractionForCapture({ captureId: id, client: supabase });
    revalidatePath('/inbox');
    return { ok: true, data: { proposalCount: outcome.proposalCount } };
  } catch (error) {
    return fail(error);
  }
}

export async function reextractCapture(captureId: string): Promise<ActionResult<{
  proposalCount: number;
}>> {
  try {
    const id = uuid.parse(captureId);
    const supabase = await createSupabaseServerClient();
    const outcome = await runExtractionForCapture({ captureId: id, client: supabase });
    revalidatePath('/inbox');
    return { ok: true, data: { proposalCount: outcome.proposalCount } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Approves a proposal, creating exactly one task.
 *
 * The work happens inside the approve_proposed_task database function so that
 * creating the task, marking the proposal approved and writing the audit
 * record are one atomic step. The function takes a row lock and returns the
 * existing task id if the proposal was already approved, which is what makes
 * a double-click or a retried request idempotent rather than duplicating work.
 */
export async function approveProposal(raw: unknown): Promise<ActionResult<{ taskId: string }>> {
  try {
    const input = approvalInput.parse(raw);
    const supabase = await createSupabaseServerClient();

    const { data: proposal } = await supabase
      .from('proposed_tasks').select('workspace_id').eq('id', input.proposalId).maybeSingle();
    if (!proposal) throw new AuthorizationError('Proposal not found.');

    const session = await requireSession();
    const workspace = await requireWorkspace(session, proposal.workspace_id);
    assertCanWrite(workspace);

    const { data: taskId, error } = await supabase.rpc('approve_proposed_task', {
      p_proposal_id: input.proposalId,
      p_title: input.title ?? undefined,
      p_description: input.description ?? undefined,
      p_project_id: input.projectId ?? undefined,
      p_assignee_id: input.assigneeId ?? undefined,
      p_due_date: input.dueDate ?? undefined,
      p_priority: input.priority ?? undefined,
      p_status: 'todo',
    });

    if (error) throw new Error(error.message);
    if (!taskId) throw new Error('Approval did not return a task.');

    revalidatePath('/inbox');
    revalidatePath('/tasks');
    revalidatePath('/home');
    return { ok: true, data: { taskId } };
  } catch (error) {
    return fail(error);
  }
}

/** Rejects or defers a proposal. Neither creates a task. */
export async function decideProposal(
  proposalId: string, decision: 'rejected' | 'deferred',
): Promise<ActionResult> {
  try {
    const id = uuid.parse(proposalId);
    const supabase = await createSupabaseServerClient();

    const { data: proposal } = await supabase
      .from('proposed_tasks').select('workspace_id, status').eq('id', id).maybeSingle();
    if (!proposal) throw new AuthorizationError('Proposal not found.');
    if (proposal.status === 'approved') {
      throw new Error('That proposal has already been approved.');
    }

    const session = await requireSession();
    const workspace = await requireWorkspace(session, proposal.workspace_id);
    assertCanWrite(workspace);

    const { error } = await supabase.from('proposed_tasks').update({
      status: decision,
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw new Error(error.message);

    await supabase.from('audit_logs').insert({
      workspace_id: proposal.workspace_id,
      actor_id: session.userId,
      action: `proposal.${decision}`,
      entity_type: 'proposed_task',
      entity_id: id,
    });

    revalidatePath('/inbox');
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Short-lived signed URL so the owner can replay their own recording. */
export async function getCaptureAudioUrl(captureId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const id = uuid.parse(captureId);
    const session = await requireSession();
    const supabase = await createSupabaseServerClient();

    const { data: capture } = await supabase
      .from('captures').select('storage_path, owner_id').eq('id', id).maybeSingle();
    if (!capture?.storage_path) throw new Error('No audio for this capture.');
    if (capture.owner_id !== session.userId) {
      throw new AuthorizationError('That recording is not yours.');
    }

    const { data, error } = await supabase.storage
      .from('captures').createSignedUrl(capture.storage_path, 300);
    if (error || !data) throw new Error(error?.message ?? 'Could not sign the file URL.');

    return { ok: true, data: { url: data.signedUrl } };
  } catch (error) {
    return fail(error);
  }
}
