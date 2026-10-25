import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import type { Database } from '@/lib/supabase/database.types';

export type WorkspaceRole = Database['public']['Enums']['workspace_role'];
export type WorkspaceKind = Database['public']['Enums']['workspace_kind'];

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: WorkspaceKind;
  role: WorkspaceRole;
  timezone: string;
  ownerId: string;
}

export interface SessionContext {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  timezone: string;
  personalWhatsapp: string | null;
  workspaces: WorkspaceSummary[];
}

/**
 * Loads the signed-in user and the workspaces they belong to.
 *
 * `cache` dedupes this across a single render pass, so a layout and the page
 * inside it share one round trip instead of two.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createSupabaseServerClient();

  // getUser revalidates the token server-side; getSession would trust the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, avatar_url, timezone, personal_whatsapp_e164, email')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('workspace_members')
      .select('role, workspaces(id, name, kind, timezone, owner_id)')
      .order('created_at', { ascending: true }),
  ]);

  const workspaces: WorkspaceSummary[] = (memberships ?? [])
    .flatMap((m) => {
      const w = m.workspaces;
      if (!w) return [];
      return [{
        id: w.id,
        name: w.name,
        kind: w.kind,
        role: m.role,
        timezone: w.timezone ?? DEFAULT_TIMEZONE,
        ownerId: w.owner_id,
      }];
    })
    // Personal first, then team workspaces alphabetically: the switcher should
    // always open on the user's own space.
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'personal' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return {
    userId: user.id,
    email: profile?.email ?? user.email ?? '',
    fullName: profile?.full_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    timezone: profile?.timezone ?? DEFAULT_TIMEZONE,
    personalWhatsapp: profile?.personal_whatsapp_e164 ?? null,
    workspaces,
  };
});

/** Session or redirect to login. For pages inside the authenticated shell. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect('/login');
  return session;
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Resolves the active workspace and asserts membership.
 *
 * RLS would already reject a query against a workspace the user does not
 * belong to, but checking here turns a silently-empty result set into an
 * explicit authorization error, which is both clearer to the user and
 * testable. Never trust the id from the URL without this.
 */
export async function requireWorkspace(
  session: SessionContext,
  workspaceId: string | undefined | null,
): Promise<WorkspaceSummary> {
  if (session.workspaces.length === 0) {
    throw new AuthorizationError('You do not belong to any workspace yet.');
  }

  if (!workspaceId) {
    const first = session.workspaces[0];
    if (!first) throw new AuthorizationError('No workspace available.');
    return first;
  }

  const match = session.workspaces.find((w) => w.id === workspaceId);
  if (!match) {
    throw new AuthorizationError('You do not have access to this workspace.');
  }
  return match;
}

export function canWrite(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'member';
}

export function canManage(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin';
}

/** Throws unless the role may write. Used by every mutating server action. */
export function assertCanWrite(workspace: WorkspaceSummary): void {
  if (!canWrite(workspace.role)) {
    throw new AuthorizationError(
      `Your role in this workspace (${workspace.role}) is read-only.`,
    );
  }
}

export function assertCanManage(workspace: WorkspaceSummary): void {
  if (!canManage(workspace.role)) {
    throw new AuthorizationError(
      `Only an owner or admin can do this (your role: ${workspace.role}).`,
    );
  }
}
