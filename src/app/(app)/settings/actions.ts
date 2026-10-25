'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  assertCanManage, requireSession, requireWorkspace, AuthorizationError,
} from '@/server/auth';
import { cleanText, uuid, workspaceRole } from '@/lib/validation/common';
import type { ActionResult } from '../actions';

const profileInput = z.object({
  fullName: z.string().trim().max(120).optional(),
  timezone: z.string().min(1).max(64),
  // E.164, matching the database CHECK constraint so the two cannot disagree.
  personalWhatsapp: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +919876543210')
    .or(z.literal(''))
    .optional(),
});

const workspaceInput = z.object({
  workspaceId: uuid,
  name: cleanText(120),
  timezone: z.string().min(1).max(64),
  teamWhatsappDestination: z.string().trim().max(200).optional(),
});

function fail(error: unknown): ActionResult<never> {
  if (error instanceof AuthorizationError) return { ok: false, error: error.message };
  if (error instanceof z.ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? 'Invalid input.' };
  }
  if (error instanceof Error) return { ok: false, error: error.message };
  return { ok: false, error: 'Unexpected error.' };
}

export async function updateProfile(raw: unknown): Promise<ActionResult> {
  try {
    const input = profileInput.parse(raw);
    const session = await requireSession();
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: input.fullName ?? null,
        timezone: input.timezone,
        personal_whatsapp_e164: input.personalWhatsapp ? input.personalWhatsapp : null,
      })
      .eq('id', session.userId);

    if (error) throw new Error(error.message);
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function updateWorkspace(raw: unknown): Promise<ActionResult> {
  try {
    const input = workspaceInput.parse(raw);
    const session = await requireSession();
    const workspace = await requireWorkspace(session, input.workspaceId);
    assertCanManage(workspace);

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from('workspaces')
      .update({
        name: input.name,
        timezone: input.timezone,
        team_whatsapp_destination: input.teamWhatsappDestination || null,
      })
      .eq('id', input.workspaceId);

    if (error) throw new Error(error.message);

    await supabase.from('audit_logs').insert({
      workspace_id: input.workspaceId,
      actor_id: session.userId,
      action: 'workspace.updated',
      entity_type: 'workspace',
      entity_id: input.workspaceId,
    });

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function createTeamWorkspace(name: string): Promise<ActionResult<{ id: string }>> {
  try {
    const clean = cleanText(120).parse(name);
    const session = await requireSession();
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from('workspaces')
      .insert({ name: clean, kind: 'team', owner_id: session.userId })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    // The creator becomes owner; without this they could not see what they
    // just made, because visibility is membership-based.
    const { error: memberError } = await supabase
      .from('workspace_members')
      .insert({ workspace_id: data.id, user_id: session.userId, role: 'owner' });
    if (memberError) throw new Error(memberError.message);

    revalidatePath('/', 'layout');
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Invites someone by email.
 *
 * Only a digest of the token is stored; the raw token is returned once, to be
 * sent out of band. A stored raw token would be a credential sitting in the
 * database.
 */
export async function inviteMember(
  workspaceId: string, email: string, role: string,
): Promise<ActionResult<{ token: string }>> {
  try {
    const wsId = uuid.parse(workspaceId);
    const address = z.string().email().parse(email.trim().toLowerCase());
    const memberRole = workspaceRole.parse(role);

    const session = await requireSession();
    const workspace = await requireWorkspace(session, wsId);
    assertCanManage(workspace);

    if (workspace.kind === 'personal') {
      throw new AuthorizationError('A personal workspace cannot have other members.');
    }

    const token = crypto.randomUUID().replace(/-/g, '');
    const digest = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    ).toString('hex');

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from('workspace_invitations').insert({
      workspace_id: wsId,
      email: address,
      role: memberRole,
      token_hash: digest,
      invited_by: session.userId,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    if (error) throw new Error(error.message);

    await supabase.from('audit_logs').insert({
      workspace_id: wsId,
      actor_id: session.userId,
      action: 'member.invited',
      entity_type: 'workspace_invitation',
      metadata: { email: address, role: memberRole },
    });

    revalidatePath('/settings');
    return { ok: true, data: { token } };
  } catch (error) {
    return fail(error);
  }
}

export async function changeMemberRole(
  workspaceId: string, userId: string, role: string,
): Promise<ActionResult> {
  try {
    const wsId = uuid.parse(workspaceId);
    const target = uuid.parse(userId);
    const newRole = workspaceRole.parse(role);

    const session = await requireSession();
    const workspace = await requireWorkspace(session, wsId);
    assertCanManage(workspace);

    // Removing the last owner would leave the workspace unmanageable.
    if (target === workspace.ownerId && newRole !== 'owner') {
      throw new AuthorizationError('The workspace owner cannot be demoted.');
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from('workspace_members')
      .update({ role: newRole })
      .eq('workspace_id', wsId)
      .eq('user_id', target);
    if (error) throw new Error(error.message);

    await supabase.from('audit_logs').insert({
      workspace_id: wsId,
      actor_id: session.userId,
      action: 'member.role_changed',
      entity_type: 'workspace_member',
      entity_id: target,
      metadata: { role: newRole },
    });

    revalidatePath('/settings');
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function removeMember(
  workspaceId: string, userId: string,
): Promise<ActionResult> {
  try {
    const wsId = uuid.parse(workspaceId);
    const target = uuid.parse(userId);

    const session = await requireSession();
    const workspace = await requireWorkspace(session, wsId);

    // Anyone may remove themselves; removing someone else needs admin.
    if (target !== session.userId) assertCanManage(workspace);
    if (target === workspace.ownerId) {
      throw new AuthorizationError('The workspace owner cannot be removed.');
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from('workspace_members').delete()
      .eq('workspace_id', wsId).eq('user_id', target);
    if (error) throw new Error(error.message);

    await supabase.from('audit_logs').insert({
      workspace_id: wsId,
      actor_id: session.userId,
      action: 'member.removed',
      entity_type: 'workspace_member',
      entity_id: target,
    });

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Exports everything the caller can see in this workspace, as JSON. */
export async function exportWorkspaceData(
  workspaceId: string,
): Promise<ActionResult<{ json: string }>> {
  try {
    const wsId = uuid.parse(workspaceId);
    const session = await requireSession();
    const workspace = await requireWorkspace(session, wsId);

    const supabase = await createSupabaseServerClient();
    // Every read here is RLS-filtered, so the export contains exactly what
    // this user is entitled to and nothing more.
    const [tasks, projects, milestones, events, notes, comments, captures] = await Promise.all([
      supabase.from('tasks').select('*').eq('workspace_id', wsId),
      supabase.from('projects').select('*').eq('workspace_id', wsId),
      supabase.from('milestones').select('*').eq('workspace_id', wsId),
      supabase.from('calendar_events').select('*').eq('workspace_id', wsId),
      supabase.from('notes').select('*').eq('workspace_id', wsId),
      supabase.from('task_comments').select('*'),
      supabase.from('captures').select('*').eq('workspace_id', wsId),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      workspace: { id: wsId, name: workspace.name, kind: workspace.kind },
      exportedBy: session.email,
      note: 'Contains only records visible to the exporting user under row level security.',
      tasks: tasks.data ?? [],
      projects: projects.data ?? [],
      milestones: milestones.data ?? [],
      calendarEvents: events.data ?? [],
      notes: notes.data ?? [],
      taskComments: comments.data ?? [],
      captures: captures.data ?? [],
    };

    await supabase.from('audit_logs').insert({
      workspace_id: wsId,
      actor_id: session.userId,
      action: 'workspace.exported',
      entity_type: 'workspace',
      entity_id: wsId,
    });

    return { ok: true, data: { json: JSON.stringify(payload, null, 2) } };
  } catch (error) {
    return fail(error);
  }
}
