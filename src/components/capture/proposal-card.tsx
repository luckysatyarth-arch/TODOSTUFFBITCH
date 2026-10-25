'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, Clock, CopyCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { ErrorNotice } from '@/components/ui/feedback';
import { PRIORITY_LABELS } from '@/components/ui/labels';
import { approveProposal, decideProposal } from '@/app/(app)/inbox/actions';
import type { Priority } from '@/components/tasks/types';

export interface ProposalView {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'deferred';
  suggestedAssigneeId: string | null;
  suggestedAssigneeName: string | null;
  suggestedProjectId: string | null;
  suggestedProjectName: string | null;
  suggestedDueDate: string | null;
  suggestedPriority: Priority | null;
  confidence: number | null;
  uncertainFields: string[];
  extractionNotes: string | null;
  sourceExcerpt: string | null;
  duplicateOfTaskId: string | null;
  duplicateSimilarity: number | null;
  createdTaskId: string | null;
}

/**
 * One AI proposal awaiting a decision.
 *
 * Every field is editable before approval, uncertain fields are marked rather
 * than presented as fact, and the verbatim source excerpt is shown so the
 * reviewer can check the proposal against what was actually said. Approve
 * creates the task; reject and defer create nothing.
 */
export function ProposalCard({
  proposal, workspaceId, members, projects, canWrite,
}: {
  proposal: ProposalView;
  workspaceId: string;
  members: Array<{ id: string; name: string | null }>;
  projects: Array<{ id: string; name: string }>;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    title: proposal.title,
    description: proposal.description ?? '',
    assigneeId: proposal.suggestedAssigneeId ?? '',
    projectId: proposal.suggestedProjectId ?? '',
    dueDate: proposal.suggestedDueDate ?? '',
    priority: proposal.suggestedPriority ?? '',
  });

  const uncertain = new Set(proposal.uncertainFields);

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveProposal({
        proposalId: proposal.id,
        title: form.title,
        description: form.description || null,
        assigneeId: form.assigneeId || null,
        projectId: form.projectId || null,
        dueDate: form.dueDate || null,
        priority: form.priority || null,
      });
      if (!result.ok) setError(result.error ?? 'Could not approve.');
    });
  }

  function decide(decision: 'rejected' | 'deferred') {
    setError(null);
    startTransition(async () => {
      const result = await decideProposal(proposal.id, decision);
      if (!result.ok) setError(result.error ?? 'Could not update.');
    });
  }

  if (proposal.status !== 'pending') {
    return (
      <li className="rounded-[var(--radius-card)] border border-hairline bg-sunken/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge tone={proposal.status === 'approved' ? 'done' : 'neutral'}>
            {proposal.status}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{proposal.title}</span>
          {proposal.createdTaskId ? (
            <Link
              href={`/tasks/${proposal.createdTaskId}?workspace=${workspaceId}`}
              className="shrink-0 text-xs text-accent hover:underline"
            >
              View task
            </Link>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-[var(--radius-card)] border border-hairline bg-paper p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {proposal.confidence !== null ? (
          <Badge tone={proposal.confidence >= 0.7 ? 'accent' : 'outline'}>
            {Math.round(proposal.confidence * 100)}% confidence
          </Badge>
        ) : null}
        {uncertain.size > 0 ? (
          <Badge tone="high">
            <AlertTriangle className="size-3" />
            {uncertain.size} unconfirmed
          </Badge>
        ) : null}
        {proposal.duplicateOfTaskId ? (
          <Link href={`/tasks/${proposal.duplicateOfTaskId}?workspace=${workspaceId}`}>
            <Badge tone="urgent">
              <CopyCheck className="size-3" />
              Looks like an existing task
              {proposal.duplicateSimilarity !== null
                ? ` (${Math.round(proposal.duplicateSimilarity * 100)}%)`
                : ''}
            </Badge>
          </Link>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-2">
          <div>
            <Label htmlFor={`p-title-${proposal.id}`}>Title</Label>
            <Input
              id={`p-title-${proposal.id}`}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`p-desc-${proposal.id}`}>Description</Label>
            <Textarea
              id={`p-desc-${proposal.id}`}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="min-h-16"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`p-assignee-${proposal.id}`}>
                Assignee {uncertain.has('assignee') ? '(unconfirmed)' : ''}
              </Label>
              <Select
                id={`p-assignee-${proposal.id}`}
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
              <Label htmlFor={`p-project-${proposal.id}`}>
                Project {uncertain.has('project') ? '(unconfirmed)' : ''}
              </Label>
              <Select
                id={`p-project-${proposal.id}`}
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
              <Label htmlFor={`p-due-${proposal.id}`}>
                Due date {uncertain.has('due_date') ? '(unconfirmed)' : ''}
              </Label>
              <Input
                id={`p-due-${proposal.id}`}
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor={`p-prio-${proposal.id}`}>Priority</Label>
              <Select
                id={`p-prio-${proposal.id}`}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as Priority | '' })}
              >
                <option value="">Medium (default)</option>
                {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-ink">{proposal.title}</p>
          {proposal.description ? (
            <p className="mt-0.5 text-xs text-ink-soft">{proposal.description}</p>
          ) : null}

          <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
            <Pair
              label="Assignee"
              value={proposal.suggestedAssigneeName ?? 'not set'}
              uncertain={uncertain.has('assignee')}
            />
            <Pair
              label="Due"
              value={proposal.suggestedDueDate ?? 'not set'}
              uncertain={uncertain.has('due_date')}
            />
            <Pair
              label="Priority"
              value={
                proposal.suggestedPriority
                  ? PRIORITY_LABELS[proposal.suggestedPriority]
                  : 'not set (will default to Medium)'
              }
              uncertain={uncertain.has('priority')}
            />
            <Pair
              label="Project"
              value={proposal.suggestedProjectName ?? 'none'}
              uncertain={uncertain.has('project')}
            />
          </dl>
        </>
      )}

      {proposal.extractionNotes ? (
        <p className="mt-2 rounded border border-high/30 bg-high-soft px-2 py-1.5 text-[11px] text-high">
          {proposal.extractionNotes}
        </p>
      ) : null}

      {proposal.sourceExcerpt ? (
        <blockquote className="mt-2 border-l-2 border-hairline-strong pl-2 text-[11px] italic text-ink-faint">
          “{proposal.sourceExcerpt}”
        </blockquote>
      ) : null}

      {error ? <ErrorNotice className="mt-2" detail={error} /> : null}

      {canWrite ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button variant="primary" size="sm" onClick={approve} disabled={pending}>
            <Check />
            {pending ? 'Working…' : 'Approve'}
          </Button>
          <Button size="sm" onClick={() => setEditing((v) => !v)} disabled={pending}>
            {editing ? 'Done editing' : 'Edit'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => decide('deferred')} disabled={pending}>
            <Clock />
            Defer
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-urgent"
            onClick={() => decide('rejected')}
            disabled={pending}
          >
            <X />
            Reject
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-ink-faint">
          Your role is read-only, so you cannot approve proposals.
        </p>
      )}
    </li>
  );
}

function Pair({
  label, value, uncertain,
}: { label: string; value: string; uncertain: boolean }) {
  return (
    <div className="flex gap-1">
      <dt className="text-ink-faint">{label}:</dt>
      <dd className={uncertain ? 'font-medium text-high' : 'text-ink-soft'}>
        {value}
        {uncertain ? ' (unconfirmed)' : ''}
      </dd>
    </div>
  );
}
