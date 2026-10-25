import Link from 'next/link';
import { Search as SearchIcon } from 'lucide-react';
import { resolvePageContext, one } from '@/server/page-context';
import { answerQuestion, type SearchResult } from '@/server/services/search';
import { capabilities } from '@/lib/env';
import { formatDateIn } from '@/lib/dates';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, SetupNotice } from '@/components/ui/feedback';
import { SearchBox } from '@/components/search/search-box';

export const metadata = { title: 'AI Search' };

const SOURCE_LABELS: Record<SearchResult['sourceType'], string> = {
  internal_task: 'Task',
  internal_project: 'Project',
  internal_comment: 'Comment',
  internal_note: 'Note',
  google_drive: 'Google Drive',
  email: 'Email',
  teams: 'Microsoft Teams',
  notion: 'Notion',
  whatsapp: 'WhatsApp',
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, workspace, params } = await resolvePageContext(searchParams);
  const query = one(params.q)?.trim() ?? '';
  const caps = capabilities();

  const outcome = query
    ? await answerQuestion(workspace, session.userId, query)
    : null;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="AI Search"
        description="Ask about your work. Answers are built only from records you are allowed to see."
      />

      <SearchBox workspaceId={workspace.id} initialQuery={query} />

      {!caps.embeddings ? (
        <SetupNotice
          className="mb-4"
          title="Semantic search is not configured"
          detail={
            'Keyword search works. Set OPENAI_API_KEY to also match on meaning rather than ' +
            'exact wording.'
          }
        />
      ) : null}

      {outcome === null ? (
        <Card>
          <CardContent>
            <EmptyState
              title="Ask a question"
              hint={
                'For example: "Which tasks are still open for the investor presentation?", ' +
                '"What is blocking the current project?", "What did I promise to finish this week?"'
              }
              icon={<SearchIcon className="size-5" />}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {outcome.unavailableReason ? (
            <SetupNotice className="mb-4" title="Answer unavailable" detail={outcome.unavailableReason} />
          ) : null}

          {outcome.answer ? (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Answer</CardTitle>
                {outcome.answer.insufficient_evidence ? (
                  <Badge tone="high">Insufficient evidence</Badge>
                ) : (
                  <Badge tone="done">{outcome.answer.citations.length} citation(s)</Badge>
                )}
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-ink">{outcome.answer.answer}</p>

                {outcome.answer.insufficient_evidence && outcome.answer.missing ? (
                  <p className="mt-2 rounded-md border border-high/30 bg-high-soft px-3 py-2 text-xs text-high">
                    {outcome.answer.missing}
                  </p>
                ) : null}

                {outcome.answer.citations.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Grounded in
                    </p>
                    <ul className="space-y-1">
                      {outcome.answer.citations.map((c, i) => {
                        const source = outcome.results.find((r) => r.ref === c.ref);
                        return (
                          <li key={`${c.ref}-${i}`} className="text-xs">
                            <span className="text-ink-faint">[{c.ref}] </span>
                            {source?.url?.startsWith('/') ? (
                              <Link href={source.url} className="text-accent hover:underline">
                                {source.title}
                              </Link>
                            ) : source?.url ? (
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent hover:underline"
                              >
                                {source.title}
                              </a>
                            ) : (
                              <span className="text-ink">{source?.title ?? 'unknown record'}</span>
                            )}
                            <span className="text-ink-faint"> — {c.supports}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {/* Inferences are shown apart from the answer so a conclusion
                    is never mistaken for something a record stated. */}
                {outcome.answer.inferences.length > 0 ? (
                  <div className="mt-3 rounded-md border border-hairline bg-canvas px-3 py-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Inferred, not stated in the records
                    </p>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-soft">
                      {outcome.answer.inferences.map((inf, i) => <li key={i}>{inf}</li>)}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Matching records</CardTitle>
              <Badge>{outcome.results.length}</Badge>
            </CardHeader>
            <CardContent>
              {outcome.results.length === 0 ? (
                <EmptyState
                  title="No records matched"
                  hint={
                    'Tasks, projects, comments and notes are indexed automatically. External ' +
                    'sources appear only once their integration is connected and synced.'
                  }
                />
              ) : (
                <ul className="space-y-2.5">
                  {outcome.results.map((r) => (
                    <li key={`${r.sourceType}-${r.sourceRecordId}`} className="border-b border-hairline pb-2 last:border-0 last:pb-0">
                      <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-ink-faint">[{r.ref}]</span>
                        <Badge tone="outline">{SOURCE_LABELS[r.sourceType]}</Badge>
                        {r.accessScope === 'owner_only' ? (
                          <Badge tone="neutral">private to you</Badge>
                        ) : null}
                        <Badge tone="neutral">{r.matchedBy}</Badge>
                        {r.timestamp ? (
                          <span className="text-[11px] text-ink-faint">
                            {formatDateIn(r.timestamp, workspace.timezone, 'd MMM yyyy')}
                          </span>
                        ) : null}
                      </div>

                      {r.url?.startsWith('/') ? (
                        <Link href={r.url} className="text-sm text-ink hover:text-accent hover:underline">
                          {r.title}
                        </Link>
                      ) : r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-ink hover:text-accent hover:underline"
                        >
                          {r.title}
                        </a>
                      ) : (
                        <span className="text-sm text-ink">{r.title}</span>
                      )}

                      {r.snippet ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-ink-faint">{r.snippet}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
