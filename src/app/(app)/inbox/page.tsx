import { Inbox as InboxIcon } from 'lucide-react';
import { resolvePageContext } from '@/server/page-context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { listWorkspaceMembers, listWorkspaceProjects } from '@/server/services/tasks';
import { canWrite } from '@/server/auth';
import { capabilities } from '@/lib/env';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, SetupNotice } from '@/components/ui/feedback';
import { Stat } from '@/components/ui/labels';
import { VoiceRecorder } from '@/components/capture/voice-recorder';
import { CapturePanel, type CaptureView } from '@/components/capture/capture-panel';
import type { ProposalView } from '@/components/capture/proposal-card';
import type { Priority } from '@/components/tasks/types';

export const metadata = { title: 'Inbox / AI Capture' };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, workspace } = await resolvePageContext(searchParams);
  const supabase = await createSupabaseServerClient();
  const caps = capabilities();

  // Captures are owner-scoped by RLS; the explicit owner filter keeps the
  // intent visible at the call site rather than relying on the policy alone.
  const [{ data: captures }, { data: proposals }, members, projects] = await Promise.all([
    supabase
      .from('captures')
      .select('id, kind, status, title, raw_text, storage_path, duration_seconds, error_message, created_at, source_metadata')
      .eq('workspace_id', workspace.id)
      .eq('owner_id', session.userId)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('proposed_tasks')
      // Written as one literal rather than a concatenation so the generated
      // client can infer the row type from it.
      .select('id, capture_id, status, title, description, suggested_assignee_id, suggested_project_id, suggested_due_date, suggested_priority, confidence, uncertain_fields, extraction_notes, source_excerpt, duplicate_of_task_id, duplicate_similarity, created_task_id')
      .eq('workspace_id', workspace.id)
      .order('confidence', { ascending: false, nullsFirst: false }),
    listWorkspaceMembers(workspace.id),
    listWorkspaceProjects(workspace.id),
  ]);

  const memberById = new Map(members.map((m) => [m.id, m.name]));
  const projectById = new Map(projects.map((p) => [p.id, p.name]));

  const byCapture = new Map<string, ProposalView[]>();
  for (const p of proposals ?? []) {
    const view: ProposalView = {
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
      suggestedAssigneeId: p.suggested_assignee_id,
      suggestedAssigneeName: p.suggested_assignee_id
        ? (memberById.get(p.suggested_assignee_id) ?? null)
        : null,
      suggestedProjectId: p.suggested_project_id,
      suggestedProjectName: p.suggested_project_id
        ? (projectById.get(p.suggested_project_id) ?? null)
        : null,
      suggestedDueDate: p.suggested_due_date,
      suggestedPriority: p.suggested_priority as Priority | null,
      confidence: p.confidence === null ? null : Number(p.confidence),
      uncertainFields: p.uncertain_fields ?? [],
      extractionNotes: p.extraction_notes,
      sourceExcerpt: p.source_excerpt,
      duplicateOfTaskId: p.duplicate_of_task_id,
      duplicateSimilarity:
        p.duplicate_similarity === null ? null : Number(p.duplicate_similarity),
      createdTaskId: p.created_task_id,
    };
    const bucket = byCapture.get(p.capture_id);
    if (bucket) bucket.push(view);
    else byCapture.set(p.capture_id, [view]);
  }

  const views: CaptureView[] = (captures ?? []).map((c) => {
    const meta = (c.source_metadata ?? {}) as {
      summary?: string; instruction_attempt?: boolean;
    };
    return {
      id: c.id,
      kind: c.kind,
      status: c.status,
      title: c.title,
      rawText: c.raw_text,
      storagePath: c.storage_path,
      durationSeconds: c.duration_seconds === null ? null : Number(c.duration_seconds),
      errorMessage: c.error_message,
      createdAt: c.created_at,
      summary: meta.summary ?? null,
      instructionAttempt: meta.instruction_attempt === true,
      proposals: byCapture.get(c.id) ?? [],
    };
  });

  const pendingTotal = (proposals ?? []).filter((p) => p.status === 'pending').length;
  const approvedTotal = (proposals ?? []).filter((p) => p.status === 'approved').length;
  const writable = canWrite(workspace.role);

  return (
    <>
      <PageHeader
        title="Inbox / AI Capture"
        description={
          'Record, upload or paste a source. Proposed tasks wait here until you approve them — ' +
          'nothing is created on your behalf.'
        }
      />

      {!caps.ai ? (
        <SetupNotice
          className="mb-4"
          title="AI extraction is not configured"
          detail={
            'Captures are stored, but no tasks can be proposed from them until an AI provider ' +
            'key is set (ANTHROPIC_API_KEY or OPENAI_API_KEY). You can still add tasks directly.'
          }
        />
      ) : null}

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Captures" value={views.length} />
        <Stat label="Awaiting review" value={pendingTotal} tone={pendingTotal > 0 ? 'urgent' : 'default'} />
        <Stat label="Approved" value={approvedTotal} tone="done" />
        <Stat
          label="Transcription"
          value={caps.transcription ? 'On' : 'Off'}
          hint={caps.transcription ? undefined : 'paste transcripts manually'}
        />
      </section>

      <Card className="mb-4">
        <CardContent className="pt-4">
          <VoiceRecorder
            workspaceId={workspace.id}
            userId={session.userId}
            transcriptionAvailable={caps.transcription}
          />
        </CardContent>
      </Card>

      {views.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="No captures yet"
              hint={
                'Record a voice note above, or use the Capture button in the header to paste a ' +
                'message, email or meeting transcript.'
              }
              icon={<InboxIcon className="size-5" />}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {views.map((c) => (
            <CapturePanel
              key={c.id}
              capture={c}
              workspaceId={workspace.id}
              timezone={workspace.timezone}
              members={members.map((m) => ({ id: m.id, name: m.name }))}
              projects={projects.map((p) => ({ id: p.id, name: p.name }))}
              canWrite={writable}
            />
          ))}
        </div>
      )}
    </>
  );
}
