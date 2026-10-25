'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ErrorNotice } from '@/components/ui/feedback';
import { changeMemberRole, inviteMember, removeMember } from '@/app/(app)/settings/actions';

const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

const ROLE_HELP: Record<string, string> = {
  owner: 'Full control, including deleting the workspace. Cannot be demoted or removed.',
  admin: 'Manage settings, members and integrations. Can write everything.',
  member: 'Create and edit tasks, projects and captures.',
  viewer: 'Read-only. Cannot create or change anything, or approve proposals.',
};

export function MembersPanel({
  workspaceId, ownerId, currentUserId, canManage, members,
}: {
  workspaceId: string;
  ownerId: string;
  currentUserId: string;
  canManage: boolean;
  members: Array<{ id: string; name: string | null; email: string | null; role: string }>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('member');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function invite() {
    setError(null);
    setToken(null);
    startTransition(async () => {
      const result = await inviteMember(workspaceId, email, role);
      if (!result.ok) {
        setError(result.error ?? 'Could not create the invitation.');
        return;
      }
      setToken(result.data?.token ?? null);
      setEmail('');
    });
  }

  function setMemberRole(userId: string, next: string) {
    setError(null);
    startTransition(async () => {
      const result = await changeMemberRole(workspaceId, userId, next);
      if (!result.ok) setError(result.error ?? 'Could not change the role.');
    });
  }

  function remove(userId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeMember(workspaceId, userId);
      if (!result.ok) setError(result.error ?? 'Could not remove that member.');
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <Badge>{members.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 border-b border-hairline pb-1.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">
                  {m.name ?? m.email ?? m.id.slice(0, 8)}
                  {m.id === currentUserId ? ' (you)' : ''}
                </span>
                <span className="block truncate text-[11px] text-ink-faint">{m.email}</span>
              </span>

              {canManage && m.id !== ownerId ? (
                <Select
                  aria-label={`Role for ${m.name ?? m.email}`}
                  className="h-7 w-28"
                  value={m.role}
                  disabled={pending}
                  onChange={(e) => setMemberRole(m.id, e.target.value)}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              ) : (
                <Badge tone={m.id === ownerId ? 'accent' : 'neutral'}>{m.role}</Badge>
              )}

              {(canManage && m.id !== ownerId) || m.id === currentUserId ? (
                m.id === ownerId ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-urgent"
                    disabled={pending}
                    onClick={() => remove(m.id)}
                  >
                    {m.id === currentUserId ? 'Leave' : 'Remove'}
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>

        {canManage ? (
          <div className="border-t border-hairline pt-3">
            <Label htmlFor="m-email">Invite someone</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="m-email"
                type="email"
                className="min-w-48 flex-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
              />
              <Select
                aria-label="Invite role"
                className="w-28"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {ROLES.filter((r) => r !== 'owner').map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
              <Button onClick={invite} disabled={pending || !email.trim()}>
                Invite
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">{ROLE_HELP[role]}</p>

            {token ? (
              <div className="mt-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2">
                <p className="text-[11px] font-medium text-accent">
                  Invitation created. Send this link to the invitee — it is shown once and only a
                  hash of it is stored.
                </p>
                <code className="mt-1 block break-all text-[11px] text-accent">
                  /invite?token={token}
                </code>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <ErrorNotice detail={error} /> : null}
      </CardContent>
    </Card>
  );
}
