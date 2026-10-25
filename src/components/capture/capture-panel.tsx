'use client';

import { useState, useTransition } from 'react';
import { FileAudio, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ErrorNotice } from '@/components/ui/feedback';
import { formatDateIn } from '@/lib/dates';
import {
  getCaptureAudioUrl, reextractCapture, transcribeCapture, updateTranscript,
} from '@/app/(app)/inbox/actions';
import { ProposalCard, type ProposalView } from './proposal-card';

export interface CaptureView {
  id: string;
  kind: string;
  status: string;
  title: string | null;
  rawText: string | null;
  storagePath: string | null;
  durationSeconds: number | null;
  errorMessage: string | null;
  createdAt: string;
  summary: string | null;
  instructionAttempt: boolean;
  proposals: ProposalView[];
}

/** One capture with its transcript, its proposals, and the actions on it. */
export function CapturePanel({
  capture, workspaceId, timezone, members, projects, canWrite,
}: {
  capture: CaptureView;
  workspaceId: string;
  timezone: string;
  members: Array<{ id: string; name: string | null }>;
  projects: Array<{ id: string; name: string }>;
  canWrite: boolean;
}) {
  const [transcript, setTranscript] = useState(capture.rawText ?? '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pendingCount = capture.proposals.filter((p) => p.status === 'pending').length;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? 'That did not work.');
    });
  }

  async function loadAudio() {
    setError(null);
    const result = await getCaptureAudioUrl(capture.id);
    if (!result.ok || !result.data) {
      setError(result.error ?? 'Could not load the recording.');
      return;
    }
    setAudioUrl(result.data.url);
  }

  return (
    <article className="rounded-[var(--radius-card)] border border-hairline bg-paper">
      <header className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
        <Badge
          tone={
            capture.status === 'ready' ? 'done'
              : capture.status === 'failed' ? 'urgent'
                : 'accent'
          }
        >
          {capture.status}
        </Badge>
        <span className="text-xs font-medium text-ink">
          {capture.title ?? capture.kind.replace(/_/g, ' ')}
        </span>
        <span className="text-[11px] text-ink-faint">
          {formatDateIn(capture.createdAt, timezone, 'd MMM yyyy, HH:mm')}
          {capture.durationSeconds
            ? ` · ${Math.round(capture.durationSeconds)}s`
            : ''}
        </span>

        {pendingCount > 0 ? (
          <Badge tone="accent" className="ml-auto">{pendingCount} awaiting review</Badge>
        ) : null}
      </header>

      <div className="space-y-3 px-3 py-3">
        {capture.instructionAttempt ? (
          <p className="rounded-md border border-urgent/30 bg-urgent-soft px-3 py-2 text-xs text-urgent">
            This source contained text that tried to issue instructions to the extractor.
            It was treated as data and ignored, but worth knowing about.
          </p>
        ) : null}

        {capture.errorMessage ? <ErrorNotice detail={capture.errorMessage} /> : null}

        {capture.storagePath ? (
          <div className="flex flex-wrap items-center gap-2">
            {audioUrl ? (
              <audio controls src={audioUrl} className="h-8 w-full max-w-sm">
                <track kind="captions" />
              </audio>
            ) : (
              <Button size="sm" onClick={loadAudio}>
                <FileAudio />
                Play original recording
              </Button>
            )}
            {capture.status === 'pending' || capture.status === 'failed' ? (
              <Button
                size="sm"
                variant="primary"
                disabled={pending}
                onClick={() => run(() => transcribeCapture(capture.id))}
              >
                Transcribe now
              </Button>
            ) : null}
          </div>
        ) : null}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Transcript / source text
            </p>
            {canWrite ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
                {editing ? 'Cancel' : 'Edit'}
              </Button>
            ) : null}
          </div>

          {editing ? (
            <div className="space-y-2">
              <Textarea
                aria-label="Transcript"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                className="min-h-32"
              />
              <p className="text-[11px] text-ink-faint">
                Saving re-runs extraction. Pending proposals are replaced; any you already
                approved stay as they are.
              </p>
              <Button
                variant="primary"
                size="sm"
                disabled={pending || !transcript.trim()}
                onClick={() =>
                  run(async () => {
                    const result = await updateTranscript(capture.id, transcript);
                    if (result.ok) setEditing(false);
                    return result;
                  })
                }
              >
                {pending ? 'Working…' : 'Save and re-extract'}
              </Button>
            </div>
          ) : (
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-hairline bg-canvas px-2 py-1.5 text-xs text-ink-soft">
              {capture.rawText ?? 'No text yet.'}
            </p>
          )}
        </div>

        {capture.summary ? (
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Context found
            </p>
            <p className="whitespace-pre-wrap text-xs text-ink-soft">{capture.summary}</p>
          </div>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Proposed tasks ({capture.proposals.length})
            </p>
            {canWrite && capture.rawText ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => run(() => reextractCapture(capture.id))}
              >
                <RefreshCw />
                Re-extract
              </Button>
            ) : null}
          </div>

          {capture.proposals.length === 0 ? (
            <p className="text-xs text-ink-faint">
              No proposals from this source. Nothing was created.
            </p>
          ) : (
            <ul className="space-y-2">
              {capture.proposals.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  workspaceId={workspaceId}
                  members={members}
                  projects={projects}
                  canWrite={canWrite}
                />
              ))}
            </ul>
          )}
        </div>

        {error ? <ErrorNotice detail={error} /> : null}
      </div>
    </article>
  );
}
