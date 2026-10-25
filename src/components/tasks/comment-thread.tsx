'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNotice } from '@/components/ui/feedback';
import { addComment } from '@/app/(app)/actions';
import { formatDateIn } from '@/lib/dates';

export function CommentThread({
  taskId, comments, canWrite, timezone, currentUserId,
}: {
  taskId: string;
  comments: Array<{
    id: string; body: string; createdAt: string;
    authorId: string | null; authorName: string | null;
  }>;
  canWrite: boolean;
  timezone: string;
  currentUserId: string;
}) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const text = body.trim();
    if (!text) return;
    setError(null);
    startTransition(async () => {
      const result = await addComment({ taskId, body: text });
      if (!result.ok) setError(result.error ?? 'Could not post that comment.');
      else setBody('');
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comments</CardTitle>
        <span className="text-[11px] text-ink-faint">{comments.length}</span>
      </CardHeader>
      <CardContent>
        {comments.length === 0 ? (
          <p className="mb-3 text-xs text-ink-faint">No comments yet.</p>
        ) : (
          <ul className="mb-3 space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="border-b border-hairline pb-2 last:border-0 last:pb-0">
                <p className="mb-0.5 text-[11px] text-ink-faint">
                  {c.authorName ?? 'Unknown'}
                  {c.authorId === currentUserId ? ' (you)' : ''}
                  {' · '}
                  {formatDateIn(c.createdAt, timezone, 'd MMM yyyy, HH:mm')}
                </p>
                <p className="whitespace-pre-wrap text-sm text-ink">{c.body}</p>
              </li>
            ))}
          </ul>
        )}

        {canWrite ? (
          <div className="space-y-2">
            <Textarea
              aria-label="Add a comment"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add a comment…"
              className="min-h-16"
            />
            {error ? <ErrorNotice detail={error} /> : null}
            <Button size="sm" onClick={submit} disabled={pending || !body.trim()}>
              {pending ? 'Posting…' : 'Comment'}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
