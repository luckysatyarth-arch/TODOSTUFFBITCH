'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  assertCanWrite, requireSession, requireWorkspace, AuthorizationError,
} from '@/server/auth';
import {
  bulkTaskUpdateInput, commentInput, createTaskInput, dependencyInput, updateTaskInput,
} from '@/lib/validation/tasks';
import {
  calendarEventInput, createProjectInput, milestoneInput, noteInput, updateProjectInput,
} from '@/lib/validation/projects';
import { uuid } from '@/lib/validation/common';
import type { Database } from '@/lib/supabase/database.types';

type TaskUpdate = Database['public']['Tables']['tasks']['Update'];
type ProjectUpdate = Database['public']['Tables']['projects']['Update'];

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function fail(error: unknown): ActionResult<never> {
  if (error instanceof AuthorizationError) return { ok: false, error: error.message };
  if (error instanceof z.ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? 'Invalid input.' };
  }
  if (error instanceof Error) {
    // Database CHECK violations from the integrity triggers carry useful,
    // non-sensitive text (e.g. "assignee is not a member of workspace").
    return { ok: false, error: error.message };
  }
  return { ok: false, error: 'Unexpected error.' };
}

/**
 * Resolves and authorizes the workspace for a mutation.
 *
 * Every write goes through this. RLS is the backstop, but checking the role
 * here produces an explicit, testable refusal instead of a confusing
 * zero-rows-affected result, and it stops a viewer's write before it reaches
 * the database.
 */
async function writeContext(workspaceId: string) {
  const session = await requireSession();
  const workspace = await requireWorkspace(session, workspaceId);
  assertCanWrite(workspace);
  const supabase = await createSupabaseServerClient();
  return { session, workspace, supabase };
}

/** Looks up a task's workspace so a mutation can be authorized against it. */
async function workspaceForTask(taskId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('tasks').select('workspace_id').eq('id', taskId).maybeSingle();
  if (!data) throw new AuthorizationError('Task not found.');
  return data.workspace_id;
}

function revalidateWorkspace() {
  revalidatePath('/', 'layout');
}

export async function createTask(raw: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const input = createTaskInput.parse(raw);
    const { session, supabase } = await writeContext(input.workspaceId);

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        workspace_id: input.workspaceId,
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        project_id: input.projectId ?? null,
        parent_task_id: input.parentTaskId ?? null,
        assignee_id: input.assigneeId ?? null,
        start_date: input.startDate ?? null,
        due_date: input.dueDate ?? null,
        estimated_minutes: input.estimatedMinutes ?? null,
        tags: input.tags,
        source_capture_id: input.sourceCaptureId ?? null,
        created_by: session.userId,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);
    revalidateWorkspace();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function updateTask(raw: unknown): Promise<ActionResult> {
  try {
    const input = updateTaskInput.parse(raw);
    const workspaceId = await workspaceForTask(input.id);
    const { supabase } = await writeContext(workspaceId);

    // Only forward keys the caller actually sent, so an omitted field is left
    // alone rather than being nulled.
    const patch: TaskUpdate = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.projectId !== undefined) patch.project_id = input.projectId;
    if (input.assigneeId !== undefined) patch.assignee_id = input.assigneeId;
    if (input.startDate !== undefined) patch.start_date = input.startDate;
    if (input.dueDate !== undefined) patch.due_date = input.dueDate;
    if (input.estimatedMinutes !== undefined) patch.estimated_minutes = input.estimatedMinutes;
    if (input.actualMinutes !== undefined) patch.actual_minutes = input.actualMinutes;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.boardPosition !== undefined) patch.board_position = input.boardPosition;

    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await supabase.from('tasks').update(patch).eq('id', input.id);
    if (error) throw new Error(error.message);

    revalidateWorkspace();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Completion is a status change like any other.
 *
 * completed_at is set by a database trigger, not here, so there is no path
 * through the application that can mark a task done without a real transition.
 */
export async function setTaskStatus(taskId: string, status: unknown): Promise<ActionResult> {
  return updateTask({ id: taskId, status });
}

export async function bulkUpdateTasks(raw: unknown): Promise<ActionResult<{ updated: number }>> {
  try {
    const input = bulkTaskUpdateInput.parse(raw);
    const supabase = await createSupabaseServerClient();

    // Every id must belong to one workspace the caller may write to. Mixed
    // workspaces are refused outright rather than partially applied.
    const { data: rows } = await supabase
      .from('tasks').select('id, workspace_id').in('id', input.ids);
    const workspaceIds = new Set((rows ?? []).map((r) => r.workspace_id));

    if (workspaceIds.size === 0) throw new AuthorizationError('No matching tasks.');
    if (workspaceIds.size > 1) {
      throw new AuthorizationError('Bulk changes must stay within one workspace.');
    }
    if ((rows ?? []).length !== input.ids.length) {
      throw new AuthorizationError('Some of those tasks are not available to you.');
    }

    const workspaceId = [...workspaceIds][0]!;
    const { supabase: client } = await writeContext(workspaceId);

    const patch: TaskUpdate = {};
    if (input.status !== undefined) patch.status = input.status;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.assigneeId !== undefined) patch.assignee_id = input.assigneeId;
    if (input.projectId !== undefined) patch.project_id = input.projectId;
    if (input.dueDate !== undefined) patch.due_date = input.dueDate;

    const { error } = await client.from('tasks').update(patch).in('id', input.ids);
    if (error) throw new Error(error.message);

    revalidateWorkspace();
    return { ok: true, data: { updated: input.ids.length } };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  try {
    const id = uuid.parse(taskId);
    const workspaceId = await workspaceForTask(id);
    const { supabase } = await writeContext(workspaceId);
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) throw new Error(error.message);
    revalidateWorkspace();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function addComment(raw: unknown): Promise<ActionResult> {
  try {
    const input = commentInput.parse(raw);
    const workspaceId = await workspaceForTask(input.taskId);
    const { session, supabase } = await writeContext(workspaceId);

    const { error } = await supabase.from('task_comments').insert({
      task_id: input.taskId, body: input.body, author_id: session.userId,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/tasks/${input.taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function addDependency(raw: unknown): Promise<ActionResult> {
  try {
    const input = dependencyInput.parse(raw);
    const workspaceId = await workspaceForTask(input.taskId);
    const { supabase } = await writeContext(workspaceId);

    const { error } = await supabase.from('task_dependencies').insert({
      task_id: input.taskId, depends_on_task_id: input.dependsOnTaskId,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/tasks/${input.taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function removeDependency(
  taskId: string, dependsOnTaskId: string,
): Promise<ActionResult> {
  try {
    const a = uuid.parse(taskId);
    const b = uuid.parse(dependsOnTaskId);
    const workspaceId = await workspaceForTask(a);
    const { supabase } = await writeContext(workspaceId);
    const { error } = await supabase.from('task_dependencies').delete()
      .eq('task_id', a).eq('depends_on_task_id', b);
    if (error) throw new Error(error.message);
    revalidatePath(`/tasks/${a}`);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function createProject(raw: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const input = createProjectInput.parse(raw);
    const { session, supabase } = await writeContext(input.workspaceId);

    const { data, error } = await supabase
      .from('projects')
      .insert({
        workspace_id: input.workspaceId,
        name: input.name,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        owner_id: input.ownerId ?? session.userId,
        start_date: input.startDate ?? null,
        target_date: input.targetDate ?? null,
        created_by: session.userId,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);
    revalidateWorkspace();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function updateProject(raw: unknown): Promise<ActionResult> {
  try {
    const input = updateProjectInput.parse(raw);
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from('projects').select('workspace_id').eq('id', input.id).maybeSingle();
    if (!data) throw new AuthorizationError('Project not found.');

    const { supabase: client } = await writeContext(data.workspace_id);

    const patch: ProjectUpdate = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.ownerId !== undefined) patch.owner_id = input.ownerId;
    if (input.startDate !== undefined) patch.start_date = input.startDate;
    if (input.targetDate !== undefined) patch.target_date = input.targetDate;
    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await client.from('projects').update(patch).eq('id', input.id);
    if (error) throw new Error(error.message);
    revalidateWorkspace();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function createMilestone(raw: unknown): Promise<ActionResult> {
  try {
    const input = milestoneInput.parse(raw);
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from('projects').select('workspace_id').eq('id', input.projectId).maybeSingle();
    if (!data) throw new AuthorizationError('Project not found.');
    const { supabase: client } = await writeContext(data.workspace_id);

    const { error } = await client.from('milestones').insert({
      workspace_id: data.workspace_id,
      project_id: input.projectId,
      name: input.name,
      description: input.description ?? null,
      due_date: input.dueDate ?? null,
      status: input.status,
    });
    if (error) throw new Error(error.message);
    revalidateWorkspace();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function setMilestoneStatus(
  milestoneId: string, status: 'pending' | 'at_risk' | 'completed' | 'missed',
): Promise<ActionResult> {
  try {
    const id = uuid.parse(milestoneId);
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from('milestones').select('workspace_id').eq('id', id).maybeSingle();
    if (!data) throw new AuthorizationError('Milestone not found.');
    const { supabase: client } = await writeContext(data.workspace_id);

    // completed_at is pinned to status by a CHECK constraint, so both move together.
    const { error } = await client.from('milestones').update({
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    }).eq('id', id);
    if (error) throw new Error(error.message);
    revalidateWorkspace();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function createCalendarEvent(raw: unknown): Promise<ActionResult> {
  try {
    const input = calendarEventInput.parse(raw);
    const { session, supabase } = await writeContext(input.workspaceId);

    const { error } = await supabase.from('calendar_events').insert({
      workspace_id: input.workspaceId,
      project_id: input.projectId ?? null,
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? null,
      is_all_day: input.isAllDay,
      start_date: input.isAllDay ? (input.startDate ?? null) : null,
      end_date: input.isAllDay ? (input.endDate ?? null) : null,
      starts_at: input.isAllDay ? null : (input.startsAt ?? null),
      ends_at: input.isAllDay ? null : (input.endsAt ?? null),
      created_by: session.userId,
    });
    if (error) throw new Error(error.message);
    revalidateWorkspace();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function createNote(raw: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const input = noteInput.parse(raw);
    const { session, supabase } = await writeContext(input.workspaceId);
    const { data, error } = await supabase.from('notes').insert({
      workspace_id: input.workspaceId,
      project_id: input.projectId ?? null,
      title: input.title,
      body: input.body,
      author_id: session.userId,
    }).select('id').single();
    if (error) throw new Error(error.message);
    revalidateWorkspace();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error);
  }
}
