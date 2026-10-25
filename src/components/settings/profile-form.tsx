'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNotice } from '@/components/ui/feedback';
import { updateProfile } from '@/app/(app)/settings/actions';

const TIMEZONES = [
  'Asia/Kolkata', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York',
  'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney',
];

export function ProfileForm({
  fullName, email, timezone, personalWhatsapp,
}: {
  fullName: string | null;
  email: string;
  timezone: string;
  personalWhatsapp: string | null;
}) {
  const [form, setForm] = useState({
    fullName: fullName ?? '',
    timezone,
    personalWhatsapp: personalWhatsapp ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateProfile(form);
      if (!result.ok) setError(result.error ?? 'Could not save.');
      else setSaved(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your profile</CardTitle>
        {saved ? <span className="text-[11px] text-done">Saved</span> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="s-email">Email</Label>
          <Input id="s-email" value={email} disabled />
        </div>
        <div>
          <Label htmlFor="s-name">Name</Label>
          <Input
            id="s-name"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="s-tz">Timezone</Label>
          <Select
            id="s-tz"
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          >
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="s-wa">Personal WhatsApp number</Label>
          <Input
            id="s-wa"
            value={form.personalWhatsapp}
            onChange={(e) => setForm({ ...form, personalWhatsapp: e.target.value })}
            placeholder="+919876543210"
          />
          <p className="mt-1 text-[11px] text-ink-faint">
            International format. Used only to send you your own private 9 PM summary, and to
            recognise your forwarded messages as yours.
          </p>
        </div>

        {error ? <ErrorNotice detail={error} /> : null}

        <Button variant="primary" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save profile'}
        </Button>
      </CardContent>
    </Card>
  );
}
