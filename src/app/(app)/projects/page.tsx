import Link from 'next/link';
import { FolderKanban } from 'lucide-react';
import { resolvePageContext } from '@/server/page-context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canWrite } from '@/server/auth';
import { formatDateIn, todayIn } from '@/lib/dates';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import { PROJECT_STATUS_LABELS, ProgressBar } from '@/components/ui/labels';
import { NewProjectForm } from '@/components/projects/new-project-form';

export const metadata = { title: 'Projects' };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await resolvePageContext(searchParams);
  const supabase = await createSupabaseServerClient();
  const today = todayIn(workspace.timezone);

  const [{ data: projects }, { data: progress }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, description, status, priority, start_date, target_date, owner_id, profiles!projects_owner_id_fkey(full_name)')
      .eq('workspace_id', workspace.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('project_progress').select('*').eq('workspace_id', workspace.id),
  ]);

  const progressById = new Map((progress ?? []).map((p) => [p.project_id as string, p]));
  const writable = canWrite(workspace.role);

  return (
    <>
      <PageHeader
        title="Projects"
        description={`${(projects ?? []).length} active in ${workspace.name}`}
      />

      {writable ? <NewProjectForm workspaceId={workspace.id} /> : null}

      {(projects ?? []).length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="No projects yet"
              hint="A project groups related tasks and gives you a progress figure you can check."
              icon={<FolderKanban className="size-5" />}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(projects ?? []).map((p) => {
            const prog = progressById.get(p.id);
            const total = Number(prog?.total_tasks ?? 0);
            const completed = Number(prog?.completed_tasks ?? 0);
            const overdue = Number(prog?.overdue_tasks ?? 0);
            const blocked = Number(prog?.blocked_tasks ?? 0);
            const percent =
              prog?.percent_complete === null || prog?.percent_complete === undefined
                ? null
                : Number(prog.percent_complete);
            const late = p.target_date !== null && p.target_date < today && total > completed;

            return (
              <Card key={p.id}>
                <CardContent className="pt-3.5">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={p.status === 'active' ? 'accent' : 'neutral'}>
                      {PROJECT_STATUS_LABELS[p.status]}
                    </Badge>
                    <Badge tone={p.priority}>{p.priority}</Badge>
                    {late ? <Badge tone="urgent">Past target</Badge> : null}
                  </div>

                  <Link
                    href={`/projects/${p.id}?workspace=${workspace.id}`}
                    className="block text-sm font-semibold text-ink hover:text-accent hover:underline"
                  >
                    {p.name}
                  </Link>

                  {p.description ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-faint">{p.description}</p>
                  ) : null}

                  <div className="mt-2.5">
                    <ProgressBar percent={percent} label={`${p.name} progress`} />
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {total === 0
                        ? 'No tasks yet'
                        : `${completed} of ${total} tasks complete`}
                      {overdue > 0 ? ` · ${overdue} overdue` : ''}
                      {blocked > 0 ? ` · ${blocked} blocked` : ''}
                    </p>
                  </div>

                  <dl className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-ink-faint">
                    <div>
                      <dt className="inline">Owner: </dt>
                      <dd className="inline text-ink-soft">
                        {(p.profiles as { full_name: string | null } | null)?.full_name ?? 'Unassigned'}
                      </dd>
                    </div>
                    {p.target_date ? (
                      <div>
                        <dt className="inline">Target: </dt>
                        <dd className="inline text-ink-soft">{formatDateIn(p.target_date)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
