'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorNotice } from '@/components/ui/feedback';
import { createNote } from '@/app/(app)/actions';

export function NoteComposer({
  workspaceId, projects,
}: {
  workspaceId: string;
  projects: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', projectId: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createNote({
        workspaceId,
        title: form.title,
        body: form.body,
        projectId: form.projectId || null,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not save the note.');
        return;
      }
      setForm({ title: '', body: '', projectId: '' });
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <Button variant="primary" className="mb-4" onClick={() => setOpen(true)}>
        <Plus />
        New note
      </Button>
    );
  }

  return (
    <Card className="mb-4">
      <CardContent className="space-y-3 pt-4">
        <div>
          <Label htmlFor="n-title">Title</Label>
          <Input
            id="n-title"
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="n-project">Project (optional)</Label>
          <Select
            id="n-project"
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
          >
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="n-body">Body</Label>
          <Textarea
            id="n-body"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            className="min-h-32"
          />
        </div>

        {error ? <ErrorNotice detail={error} /> : null}

        <div className="flex gap-2">
          <Button variant="primary" onClick={submit} disabled={pending || !form.title.trim()}>
            {pending ? 'Saving…' : 'Save note'}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}
