'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNotice } from '@/components/ui/feedback';
import { createTeamWorkspace, updateWorkspace } from '@/app/(app)/settings/actions';
import { getWhatsAppGroupNote } from './group-note';

const TIMEZONES = [
  'Asia/Kolkata', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York',
  'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney',
];

export function WorkspaceForm({
  workspaceId, name, kind, timezone, canManage,
}: {
  workspaceId: string;
  name: string;
  kind: 'personal' | 'team';
  timezone: string;
  canManage: boolean;
}) {
  const [form, setForm] = useState({ name, timezone, teamWhatsappDestination: '' });
  const [newTeam, setNewTeam] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateWorkspace({ workspaceId, ...form });
      if (!result.ok) setError(result.error ?? 'Could not save.');
      else setSaved(true);
    });
  }

  function createTeam() {
    setError(null);
    startTransition(async () => {
      const result = await createTeamWorkspace(newTeam);
      if (!result.ok) setError(result.error ?? 'Could not create the workspace.');
      else setNewTeam('');
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        {saved ? <span className="text-[11px] text-done">Saved</span> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {canManage ? (
          <>
            <div>
              <Label htmlFor="w-name">Name</Label>
              <Input
                id="w-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="w-tz">Reporting timezone</Label>
              <Select
                id="w-tz"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              >
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </Select>
              <p className="mt-1 text-[11px] text-ink-faint">
                Decides which calendar day a report covers and when 21:00 falls.
              </p>
            </div>

            {kind === 'team' ? (
              <div>
                <Label htmlFor="w-group">Team WhatsApp group destination</Label>
                <Input
                  id="w-group"
                  value={form.teamWhatsappDestination}
                  onChange={(e) => setForm({ ...form, teamWhatsappDestination: e.target.value })}
                  placeholder="Group id from the provider"
                />
                <p className="mt-1 text-[11px] text-ink-faint">{getWhatsAppGroupNote()}</p>
              </div>
            ) : null}

            <Button variant="primary" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save workspace'}
            </Button>
          </>
        ) : (
          <p className="text-xs text-ink-faint">
            Changing workspace settings needs an owner or admin role.
          </p>
        )}

        <div className="border-t border-hairline pt-3">
          <Label htmlFor="w-new">Create a team workspace</Label>
          <div className="flex gap-2">
            <Input
              id="w-new"
              value={newTeam}
              onChange={(e) => setNewTeam(e.target.value)}
              placeholder="Acme Team"
            />
            <Button onClick={createTeam} disabled={pending || !newTeam.trim()}>
              Create
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">
            You become its owner. Your personal workspace stays private and separate.
          </p>
        </div>

        {error ? <ErrorNotice detail={error} /> : null}
      </CardContent>
    </Card>
  );
}
