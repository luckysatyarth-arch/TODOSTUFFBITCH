import { FileText } from 'lucide-react';
import { resolvePageContext } from '@/server/page-context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canWrite } from '@/server/auth';
import { formatDateIn } from '@/lib/dates';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';
import { NoteComposer } from '@/components/notes/note-composer';
import { listWorkspaceProjects } from '@/server/services/tasks';

export const metadata = { title: 'Documents & Notes' };

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await resolvePageContext(searchParams);
  const supabase = await createSupabaseServerClient();

  const [{ data: notes }, projects] = await Promise.all([
    supabase
      .from('notes')
      .select('id, title, body, project_id, updated_at, projects(name)')
      .eq('workspace_id', workspace.id)
      .order('updated_at', { ascending: false })
      .limit(100),
    listWorkspaceProjects(workspace.id),
  ]);

  const writable = canWrite(workspace.role);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Documents & Notes"
        description="Written material kept alongside the work. Notes are indexed for search."
      />

      {writable ? (
        <NoteComposer
          workspaceId={workspace.id}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      ) : null}

      {(notes ?? []).length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="No notes yet"
              hint="Notes are searchable alongside tasks and projects, and can be attached to a project."
              icon={<FileText className="size-5" />}
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {(notes ?? []).map((n) => (
            <li key={n.id}>
              <Card>
                <CardContent className="pt-3.5">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <h2 className="text-sm font-semibold text-ink">{n.title}</h2>
                    {n.projects ? (
                      <Badge tone="outline">
                        {(n.projects as { name: string }).name}
                      </Badge>
                    ) : null}
                    <span className="ml-auto text-[11px] text-ink-faint">
                      {formatDateIn(n.updated_at, workspace.timezone, 'd MMM yyyy, HH:mm')}
                    </span>
                  </div>
                  {n.body ? (
                    <p className="whitespace-pre-wrap text-xs text-ink-soft">{n.body}</p>
                  ) : (
                    <p className="text-xs text-ink-faint">Empty note.</p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
