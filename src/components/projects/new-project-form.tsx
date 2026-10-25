'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorNotice } from '@/components/ui/feedback';
import { createProject } from '@/app/(app)/actions';

export function NewProjectForm({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: '', description: '', priority: 'medium', startDate: '', targetDate: '',
  });

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createProject({
        workspaceId,
        name: form.name,
        description: form.description || null,
        priority: form.priority,
        startDate: form.startDate || null,
        targetDate: form.targetDate || null,
        status: 'active',
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not create the project.');
        return;
      }
      setForm({ name: '', description: '', priority: 'medium', startDate: '', targetDate: '' });
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <Button variant="primary" className="mb-4" onClick={() => setOpen(true)}>
        <Plus />
        New project
      </Button>
    );
  }

  return (
    <Card className="mb-4">
      <CardContent className="space-y-3 pt-4">
        <div>
          <Label htmlFor="p-name">Project name</Label>
          <Input
            id="p-name"
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Investor presentation"
          />
        </div>
        <div>
          <Label htmlFor="p-descr">Description</Label>
          <Textarea
            id="p-descr"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="min-h-16"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="p-prio">Priority</Label>
            <Select
              id="p-prio"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="p-start">Start date</Label>
            <Input
              id="p-start"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="p-target">Target date</Label>
            <Input
              id="p-target"
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
            />
          </div>
        </div>

        {error ? <ErrorNotice detail={error} /> : null}

        <div className="flex gap-2">
          <Button variant="primary" onClick={submit} disabled={pending || !form.name.trim()}>
            {pending ? 'Creating…' : 'Create project'}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}
