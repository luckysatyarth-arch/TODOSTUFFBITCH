import { Suspense } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireSession, requireWorkspace } from '@/server/auth';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { CommandPalette } from '@/components/shell/command-palette';

/**
 * The authenticated shell.
 *
 * The active workspace comes from the query string so every page is linkable
 * and authorized per request. requireWorkspace throws rather than silently
 * falling back, so a tampered id is an error instead of a quiet switch to
 * another workspace.
 */
export default async function AppLayout({
  children,
  // Next 16 passes searchParams to a layout as a promise.
  params: _params,
}: {
  children: React.ReactNode;
  params: Promise<Record<string, string>>;
}) {
  const session = await requireSession();

  return (
    <Suspense fallback={<ShellSkeleton />}>
      <ShellBody session={session}>{children}</ShellBody>
    </Suspense>
  );
}

async function ShellBody({
  session, children,
}: {
  session: Awaited<ReturnType<typeof requireSession>>;
  children: React.ReactNode;
}) {
  // A layout cannot read searchParams, so the workspace is resolved from the
  // default (personal first) here and each page re-resolves it from its own
  // searchParams for authorization.
  const workspace = await requireWorkspace(session, undefined);

  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from('proposed_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  return (
    <div className="flex min-h-screen">
      <Sidebar
        workspaces={session.workspaces}
        active={workspace}
        pendingProposals={count ?? 0}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar session={session} workspace={workspace} />
        <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-4 md:px-6">{children}</main>
      </div>
      <CommandPalette workspaceId={workspace.id} isTeam={workspace.kind === 'team'} />
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-60 shrink-0 border-r border-hairline bg-paper md:block" />
      <div className="flex-1">
        <div className="h-12 border-b border-hairline bg-paper" />
      </div>
    </div>
  );
}
