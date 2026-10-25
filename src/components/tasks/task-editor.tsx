'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNotice } from '@/components/ui/feedback';
import { PRIORITY_LABELS, STATUS_LABELS, STATUS_ORDER } from '@/components/ui/labels';
import { deleteTask, updateTask } from '@/app/(app)/actions';
import type { TaskDetail } from '@/server/services/tasks';
import type { Priority, TaskStatus } from './types';

/**
 * Editable task fields.
 *
 * Status is a plain select, including Completed: the brief is explicit that a
 * task is done only when someone sets it to done, so there is no "auto-close"
 * path and no inference from dates.
 */
export function TaskEditor({
  task, canWrite, members, projects, workspaceId,
}: {
  task: TaskDetail;
  canWrite: boolean;
  members: Array<{ id: string; name: string | null }>;
  projects: Array<{ id: string; name: string }>;
  workspaceId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [form, setForm] = useState({
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId ?? '',
    projectId: task.projectId ?? '',
    startDate: task.startDate ?? '',
    dueDate: task.dueDate ?? '',
    estimatedMinutes: task.estimatedMinutes?.toString() ?? '',
    actualMinutes: task.actualMinutes?.toString() ?? '',
    tags: task.tags.join(', '),
  });

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateTask({
        id: task.id,
        title: form.title,
        description: form.description || null,
        status: form.status,
        priority: form.priority,
        assigneeId: form.assigneeId || null,
        projectId: form.projectId || null,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null,
        actualMinutes: form.actualMinutes ? Number(form.actualMinutes) : null,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      if (!result.ok) setError(result.error ?? 'Could not save.');
      else setSaved(true);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteTask(task.id);
      if (!result.ok) setError(result.error ?? 'Could not delete.');
      else router.push(`/tasks?workspace=${workspaceId}`);
    });
  }

  if (!canWrite) {
    return (
      <Card>
        <CardHeader><CardTitle>Description</CardTitle></CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-ink-soft">
            {task.description ?? 'No description.'}
          </p>
          <p className="mt-3 text-[11px] text-ink-faint">
            Your role in this workspace is {`'`}viewer{`'`}, so this task is read-only.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit task</CardTitle>
        {saved ? <span className="text-[11px] text-done">Saved</span> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="t-title">Title</Label>
          <Input
            id="t-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        <div>
          <Label htmlFor="t-desc">Description</Label>
          <Textarea
            id="t-desc"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="min-h-24"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="t-status">Status</Label>
            <Select
              id="t-status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="t-priority">Priority</Label>
            <Select
              id="t-priority"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
            >
              {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="t-assignee">Assignee</Label>
            <Select
              id="t-assignee"
              value={form.assigneeId}
              onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name ?? m.id.slice(0, 8)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="t-project">Project</Label>
            <Select
              id="t-project"
              value={form.projectId}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="t-start">Start date</Label>
            <Input
              id="t-start"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="t-due">Due date</Label>
            <Input
              id="t-due"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="t-est">Estimated effort (minutes)</Label>
            <Input
              id="t-est"
              type="number"
              min={0}
              value={form.estimatedMinutes}
              onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="t-act">Logged effort (minutes)</Label>
            <Input
              id="t-act"
              type="number"
              min={0}
              value={form.actualMinutes}
              onChange={(e) => setForm({ ...form, actualMinutes: e.target.value })}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="t-tags">Tags (comma separated)</Label>
          <Input
            id="t-tags"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
          />
        </div>

        {error ? <ErrorNotice detail={error} /> : null}

        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>

          {confirmingDelete ? (
            <>
              <span className="text-xs text-ink-faint">Delete this task?</span>
              <Button variant="danger" size="sm" onClick={remove} disabled={pending}>
                Yes, delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-urgent"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
