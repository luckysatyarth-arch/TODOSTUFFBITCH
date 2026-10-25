import { describe, expect, it } from 'vitest';
import {
  AuthorizationError, assertCanManage, assertCanWrite, canManage, canWrite,
  requireWorkspace, type SessionContext, type WorkspaceSummary,
} from '@/server/auth';

function workspace(over: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Acme Team',
    kind: 'team',
    role: 'member',
    timezone: 'Asia/Kolkata',
    ownerId: '11111111-1111-1111-1111-111111111111',
    ...over,
  };
}

function session(workspaces: WorkspaceSummary[]): SessionContext {
  return {
    userId: '22222222-2222-2222-2222-222222222222',
    email: 'bob@example.test',
    fullName: 'Bob Beta',
    avatarUrl: null,
    timezone: 'Asia/Kolkata',
    personalWhatsapp: null,
    workspaces,
  };
}

describe('role predicates', () => {
  it('lets owners, admins and members write', () => {
    expect(canWrite('owner')).toBe(true);
    expect(canWrite('admin')).toBe(true);
    expect(canWrite('member')).toBe(true);
  });

  it('does not let a viewer write', () => {
    expect(canWrite('viewer')).toBe(false);
  });

  it('restricts management to owners and admins', () => {
    expect(canManage('owner')).toBe(true);
    expect(canManage('admin')).toBe(true);
    expect(canManage('member')).toBe(false);
    expect(canManage('viewer')).toBe(false);
  });
});

describe('assertions', () => {
  it('refuses a viewer write with a message naming the role', () => {
    expect(() => assertCanWrite(workspace({ role: 'viewer' }))).toThrow(AuthorizationError);
    expect(() => assertCanWrite(workspace({ role: 'viewer' }))).toThrow(/viewer/);
  });

  it('refuses a member management action', () => {
    expect(() => assertCanManage(workspace({ role: 'member' }))).toThrow(AuthorizationError);
  });

  it('permits a writer and a manager', () => {
    expect(() => assertCanWrite(workspace({ role: 'member' }))).not.toThrow();
    expect(() => assertCanManage(workspace({ role: 'admin' }))).not.toThrow();
  });
});

describe('requireWorkspace', () => {
  const personal = workspace({ id: 'p-1', kind: 'personal', name: 'Personal', role: 'owner' });
  const team = workspace({ id: 't-1' });

  it('refuses a workspace the user does not belong to', async () => {
    // The id arrives from the URL, so this is the parameter-tampering guard.
    await expect(requireWorkspace(session([personal, team]), 'someone-elses-id'))
      .rejects.toThrow(AuthorizationError);
  });

  it('does not silently fall back to another workspace on a bad id', async () => {
    await expect(requireWorkspace(session([personal, team]), 'bad'))
      .rejects.toThrow(/do not have access/);
  });

  it('returns the requested workspace when the user is a member', async () => {
    const resolved = await requireWorkspace(session([personal, team]), 't-1');
    expect(resolved.id).toBe('t-1');
  });

  it('defaults to the first workspace when none is requested', async () => {
    const resolved = await requireWorkspace(session([personal, team]), undefined);
    expect(resolved.id).toBe('p-1');
  });

  it('refuses when the user belongs to nothing', async () => {
    await expect(requireWorkspace(session([]), undefined)).rejects.toThrow(AuthorizationError);
  });
});
