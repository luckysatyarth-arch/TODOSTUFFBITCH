import { resolvePageContext } from '@/server/page-context';
import { listWorkspaceMembers } from '@/server/services/tasks';
import { canManage } from '@/server/auth';
import { capabilities } from '@/lib/env';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProfileForm } from '@/components/settings/profile-form';
import { WorkspaceForm } from '@/components/settings/workspace-form';
import { MembersPanel } from '@/components/settings/members-panel';
import { DataPanel } from '@/components/settings/data-panel';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, workspace } = await resolvePageContext(searchParams);
  const members = await listWorkspaceMembers(workspace.id);
  const isAdmin = canManage(workspace.role);
  const caps = capabilities();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Settings"
        description={`${workspace.name} · your role: ${workspace.role}`}
      />

      <ProfileForm
        fullName={session.fullName}
        email={session.email}
        timezone={session.timezone}
        personalWhatsapp={session.personalWhatsapp}
      />

      <WorkspaceForm
        workspaceId={workspace.id}
        name={workspace.name}
        kind={workspace.kind}
        timezone={workspace.timezone}
        canManage={isAdmin}
      />

      {workspace.kind === 'team' ? (
        <MembersPanel
          workspaceId={workspace.id}
          ownerId={workspace.ownerId}
          currentUserId={session.userId}
          canManage={isAdmin}
          members={members.map((m) => ({
            id: m.id, name: m.name, email: m.email, role: m.role,
          }))}
        />
      ) : (
        <Card>
          <CardHeader><CardTitle>Members</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs text-ink-faint">
              This is your personal workspace. It has exactly one member — you — and nobody can be
              added to it. Team membership elsewhere never grants access to anything here.
            </p>
          </CardContent>
        </Card>
      )}

      <DataPanel workspaceId={workspace.id} />

      <Card>
        <CardHeader><CardTitle>This deployment</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-2 text-xs text-ink-faint">
            What is configured right now. A feature marked off is genuinely unavailable rather
            than silently degraded.
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            <Flag label="Scheduled reports (service role)" on={caps.serviceRole} />
            <Flag label="Cron secret" on={caps.cron} />
            <Flag label="AI extraction and answers" on={caps.ai} />
            <Flag label="Semantic search" on={caps.embeddings} />
            <Flag label="Audio transcription" on={caps.transcription} />
            <Flag label="Credential encryption" on={caps.credentialEncryption} />
            <Flag
              label="WhatsApp delivery"
              on={caps.whatsapp !== false}
              detail={caps.whatsapp === 'dry_run' ? 'dry-run: records, does not send' : undefined}
            />
            <Flag label="Google connectors" on={caps.google} />
            <Flag label="Microsoft connectors" on={caps.microsoft} />
            <Flag label="Notion connector" on={caps.notion} />
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Flag({ label, on, detail }: { label: string; on: boolean; detail?: string }) {
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="min-w-0 truncate text-ink-soft">{label}</span>
      <Badge tone={on ? 'done' : 'neutral'}>{detail ?? (on ? 'on' : 'off')}</Badge>
    </li>
  );
}
