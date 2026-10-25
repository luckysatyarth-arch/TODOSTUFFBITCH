'use client';

import { useState, useTransition } from 'react';
import { Mic, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea, Label, Select } from '@/components/ui/input';
import { ErrorNotice } from '@/components/ui/feedback';
import { captureText } from '@/app/(app)/inbox/actions';
import { createTask } from '@/app/(app)/actions';

/**
 * The global capture button.
 *
 * Two deliberately different paths: "Add task" writes a task directly, because
 * the user typed exactly what they wanted. "Extract with AI" produces
 * proposals for review in the inbox and creates nothing. Keeping them as
 * separate buttons means no one can accidentally let the model create work.
 */
export function QuickCapture({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'text' | 'meeting_transcript' | 'whatsapp' | 'email'>('text');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setText('');
    setError(null);
    setNotice(null);
  }

  function submitDirect() {
    const title = text.trim();
    if (!title) return;
    setError(null);
    startTransition(async () => {
      const result = await createTask({ workspaceId, title });
      if (!result.ok) {
        setError(result.error ?? 'Could not create the task.');
        return;
      }
      reset();
      setOpen(false);
    });
  }

  function submitExtraction() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await captureText({ workspaceId, text: body, kind });
      if (!result.ok) {
        setError(result.error ?? 'Could not capture that.');
        return;
      }
      const count = result.data?.proposalCount ?? 0;
      setNotice(
        count === 0
          ? 'Captured. No action items were found in it.'
          : `Captured. ${count} proposal${count === 1 ? '' : 's'} waiting for your review in the Inbox.`,
      );
      setText('');
    });
  }

  return (
    <>
      <Button variant="primary" size="default" onClick={() => setOpen(true)}>
        <Plus />
        <span className="hidden sm:inline">Capture</span>
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => { setOpen(false); reset(); }}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Quick capture"
            className="relative w-full max-w-xl rounded-[var(--radius-card)] border border-hairline bg-paper p-4 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Quick capture</h2>
              <a
                href={`/inbox?workspace=${workspaceId}`}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <Mic className="size-3.5" />
                Record a voice note
              </a>
            </div>

            <Label htmlFor="capture-text">What needs doing?</Label>
            <Textarea
              id="capture-text"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                'Type a single task, or paste a longer note, message or transcript and ' +
                'let AI propose tasks from it.'
              }
              className="min-h-28"
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter is the fast path for the common case.
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  submitDirect();
                }
              }}
            />

            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <Label htmlFor="capture-kind">Source</Label>
                <Select
                  id="capture-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                  className="w-48"
                >
                  <option value="text">Typed note</option>
                  <option value="meeting_transcript">Meeting transcript</option>
                  <option value="whatsapp">Forwarded WhatsApp message</option>
                  <option value="email">Email</option>
                </Select>
              </div>

              <div className="flex gap-2">
                <Button onClick={submitDirect} disabled={pending || !text.trim()}>
                  Add as task
                </Button>
                <Button
                  variant="primary"
                  onClick={submitExtraction}
                  disabled={pending || !text.trim()}
                >
                  <Sparkles />
                  {pending ? 'Working…' : 'Extract with AI'}
                </Button>
              </div>
            </div>

            <p className="mt-2 text-[11px] text-ink-faint">
              Extraction only proposes tasks. Nothing is created until you approve it in the Inbox.
            </p>

            {error ? <ErrorNotice className="mt-2" detail={error} /> : null}
            {notice ? (
              <p className="mt-2 rounded-md border border-done/30 bg-done-soft px-3 py-2 text-xs text-done">
                {notice}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
