import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Approval idempotency and report uniqueness, against the real database.
 *
 * These cover acceptance criteria 8, 9 and 17: nothing is created before
 * approval, one proposal yields at most one task however many times it is
 * approved, and a duplicate scheduled run produces no duplicate report.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const configured = Boolean(url && serviceKey && anonKey);
const describeIf = configured ? describe : describe.skip;

const stamp = Date.now();
const OWNER = `owner-${stamp}@integration.test`;
const OTHER = `other-${stamp}@integration.test`;
const PASSWORD = 'integration-test-password-1';

describeIf('approval and report idempotency', () => {
  let admin: SupabaseClient;
  let ownerClient: SupabaseClient;
  let otherClient: SupabaseClient;
  let ownerId = '';
  let otherId = '';
  let teamWs = '';
  let captureId = '';
  let proposalId = '';

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const makeUser = async (email: string, name: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name },
      });
      if (error) throw new Error(error.message);
      return data.user!.id;
    };
    ownerId = await makeUser(OWNER, 'Owner Integration');
    otherId = await makeUser(OTHER, 'Other Integration');

    const signIn = async (email: string) => {
      const client = createClient(url!, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(error.message);
      return client;
    };
    ownerClient = await signIn(OWNER);
    otherClient = await signIn(OTHER);

    const { data: ws } = await admin
      .from('workspaces')
      .insert({ name: `Approval ${stamp}`, kind: 'team', owner_id: ownerId })
      .select('id').single();
    teamWs = ws!.id;

    await admin.from('workspace_members').insert([
      { workspace_id: teamWs, user_id: ownerId, role: 'owner' },
      { workspace_id: teamWs, user_id: otherId, role: 'member' },
    ]);

    const { data: capture } = await admin
      .from('captures')
      .insert({
        workspace_id: teamWs, owner_id: ownerId, kind: 'voice', status: 'ready',
        title: 'Test note', raw_text: 'Finish the deck by Friday.',
      })
      .select('id').single();
    captureId = capture!.id;

    const { data: proposal } = await admin
      .from('proposed_tasks')
      .insert({
        capture_id: captureId, workspace_id: teamWs, status: 'pending',
        title: 'Finish the deck', confidence: 0.9,
        uncertain_fields: ['assignee'], source_excerpt: 'Finish the deck by Friday.',
      })
      .select('id').single();
    proposalId = proposal!.id;
  }, 60_000);

  afterAll(async () => {
    if (!configured) return;
    for (const id of [ownerId, otherId]) {
      if (id) await admin.auth.admin.deleteUser(id).catch(() => undefined);
    }
  }, 30_000);

  it('creates no task before approval', async () => {
    const { data } = await admin
      .from('tasks').select('id').eq('source_capture_id', captureId);
    expect(data ?? []).toHaveLength(0);

    const { data: proposal } = await admin
      .from('proposed_tasks').select('status, created_task_id').eq('id', proposalId).single();
    expect(proposal?.status).toBe('pending');
    expect(proposal?.created_task_id).toBeNull();
  });

  it('hides a proposal from someone who does not own the capture', async () => {
    const { data } = await otherClient
      .from('proposed_tasks').select('id').eq('id', proposalId);
    expect(data ?? []).toHaveLength(0);
  });

  it('refuses approval by a non-owner of the capture', async () => {
    const { error } = await otherClient.rpc('approve_proposed_task', {
      p_proposal_id: proposalId,
    });
    expect(error).not.toBeNull();
  });

  it('produces exactly one task from repeated approvals', async () => {
    // Three concurrent calls, as a double-click plus a retry would make.
    const results = await Promise.all([
      ownerClient.rpc('approve_proposed_task', { p_proposal_id: proposalId }),
      ownerClient.rpc('approve_proposed_task', { p_proposal_id: proposalId }),
      ownerClient.rpc('approve_proposed_task', { p_proposal_id: proposalId }),
    ]);

    const ids = results.map((r) => r.data).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    // Every successful call must name the same task.
    expect(new Set(ids).size).toBe(1);

    const { data: tasks } = await admin
      .from('tasks').select('id').eq('source_capture_id', captureId);
    expect(tasks).toHaveLength(1);

    const { data: proposal } = await admin
      .from('proposed_tasks').select('status, created_task_id').eq('id', proposalId).single();
    expect(proposal?.status).toBe('approved');
    expect(proposal?.created_task_id).toBe(ids[0]);
  }, 30_000);

  it('records an audit row for the approval', async () => {
    const { data } = await admin
      .from('audit_logs').select('action, entity_id')
      .eq('action', 'proposal.approved').eq('entity_id', proposalId);
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a second team report for the same date', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const row = {
      workspace_id: teamWs, scope: 'team' as const, subject_user_id: null,
      report_date: today, status: 'generated' as const,
    };
    const first = await admin.from('daily_reports').insert(row);
    expect(first.error).toBeNull();

    const second = await admin.from('daily_reports').insert(row);
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe('23505');
  });

  it('rejects a second personal report for the same subject and date', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const row = {
      workspace_id: teamWs, scope: 'personal' as const, subject_user_id: ownerId,
      report_date: today, status: 'generated' as const,
    };
    expect((await admin.from('daily_reports').insert(row)).error).toBeNull();
    expect((await admin.from('daily_reports').insert(row)).error).not.toBeNull();
  });

  it('keeps a personal report invisible to another member', async () => {
    const { data } = await otherClient
      .from('daily_reports').select('id').eq('scope', 'personal').eq('subject_user_id', ownerId);
    expect(data ?? []).toHaveLength(0);
  });

  it('lets a member read the team report', async () => {
    const { data } = await otherClient
      .from('daily_reports').select('id').eq('workspace_id', teamWs).eq('scope', 'team');
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('reports project progress from the real task rows', async () => {
    const { data: project } = await admin
      .from('projects')
      .insert({ workspace_id: teamWs, name: `Progress ${stamp}`, created_by: ownerId })
      .select('id').single();

    await admin.from('tasks').insert([
      { workspace_id: teamWs, project_id: project!.id, title: 'a', status: 'completed', completed_at: new Date().toISOString() },
      { workspace_id: teamWs, project_id: project!.id, title: 'b', status: 'todo' },
      { workspace_id: teamWs, project_id: project!.id, title: 'c', status: 'blocked' },
      // Cancelled work is excluded from the denominator.
      { workspace_id: teamWs, project_id: project!.id, title: 'd', status: 'cancelled' },
    ]);

    const { data: progress } = await admin
      .from('project_progress').select('*').eq('project_id', project!.id).single();

    expect(Number(progress!.total_tasks)).toBe(3);
    expect(Number(progress!.completed_tasks)).toBe(1);
    expect(Number(progress!.blocked_tasks)).toBe(1);
    expect(Number(progress!.percent_complete)).toBeCloseTo(33.3, 1);
  }, 30_000);

  it('reports null rather than zero for a project with no tasks', async () => {
    const { data: project } = await admin
      .from('projects')
      .insert({ workspace_id: teamWs, name: `Empty ${stamp}`, created_by: ownerId })
      .select('id').single();

    const { data: progress } = await admin
      .from('project_progress').select('*').eq('project_id', project!.id).single();

    expect(Number(progress!.total_tasks)).toBe(0);
    expect(progress!.percent_complete).toBeNull();
  });
});
