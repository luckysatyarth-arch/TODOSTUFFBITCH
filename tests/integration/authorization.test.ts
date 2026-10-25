import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Authorization boundaries, against the real database.
 *
 * The point of these is that RLS is not something application code can be
 * trusted to enforce: each assertion is made with a client holding a real
 * user's session, so the policies themselves are what pass or fail.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const configured = Boolean(url && serviceKey && anonKey);
const describeIf = configured ? describe : describe.skip;

if (!configured) {
  console.warn(
    '\n[integration] Skipped: set NEXT_PUBLIC_SUPABASE_URL, ' +
    'NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to run these.\n',
  );
}

const stamp = Date.now();
const ALICE = `alice-${stamp}@integration.test`;
const BOB = `bob-${stamp}@integration.test`;
const PASSWORD = 'integration-test-password-1';

describeIf('authorization boundaries', () => {
  let admin: SupabaseClient;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let aliceId = '';
  let bobId = '';
  let alicePersonalWs = '';
  let teamWs = '';
  let alicePrivateTask = '';
  let sharedTask = '';

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const makeUser = async (email: string, name: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (error) throw new Error(`Could not create ${email}: ${error.message}`);
      return data.user!.id;
    };

    aliceId = await makeUser(ALICE, 'Alice Integration');
    bobId = await makeUser(BOB, 'Bob Integration');

    const signIn = async (email: string) => {
      const client = createClient(url!, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`Could not sign in ${email}: ${error.message}`);
      return client;
    };

    aliceClient = await signIn(ALICE);
    bobClient = await signIn(BOB);

    // The signup trigger should already have made a personal workspace each.
    const { data: personal } = await admin
      .from('workspaces').select('id').eq('owner_id', aliceId).eq('kind', 'personal').single();
    alicePersonalWs = personal!.id;

    const { data: team } = await admin
      .from('workspaces')
      .insert({ name: `Team ${stamp}`, kind: 'team', owner_id: aliceId })
      .select('id').single();
    teamWs = team!.id;

    await admin.from('workspace_members').insert([
      { workspace_id: teamWs, user_id: aliceId, role: 'owner' },
      { workspace_id: teamWs, user_id: bobId, role: 'member' },
    ]);

    const { data: priv } = await admin
      .from('tasks')
      .insert({ workspace_id: alicePersonalWs, title: 'ALICE PRIVATE', created_by: aliceId })
      .select('id').single();
    alicePrivateTask = priv!.id;

    const { data: shared } = await admin
      .from('tasks')
      .insert({ workspace_id: teamWs, title: 'SHARED TEAM TASK', created_by: aliceId })
      .select('id').single();
    sharedTask = shared!.id;
  }, 60_000);

  afterAll(async () => {
    if (!configured) return;
    // Cascades remove the workspaces, tasks and captures with the users.
    for (const id of [aliceId, bobId]) {
      if (id) await admin.auth.admin.deleteUser(id).catch(() => undefined);
    }
  }, 30_000);

  it('provisions a profile and a personal workspace on signup', async () => {
    const { data: profile } = await admin.from('profiles').select('email').eq('id', aliceId).single();
    expect(profile?.email).toBe(ALICE);
    expect(alicePersonalWs).toBeTruthy();
  });

  it('allows exactly one personal workspace per user', async () => {
    const { error } = await admin
      .from('workspaces')
      .insert({ name: 'Second personal', kind: 'personal', owner_id: aliceId });
    expect(error).not.toBeNull();
  });

  it('lets a team member read the shared task', async () => {
    const { data } = await bobClient.from('tasks').select('id').eq('id', sharedTask);
    expect(data).toHaveLength(1);
  });

  it('hides a personal task from a team colleague', async () => {
    // The core privacy promise: team membership reaches no personal workspace.
    const { data } = await bobClient.from('tasks').select('id').eq('id', alicePrivateTask);
    expect(data).toHaveLength(0);
  });

  it('hides the personal workspace itself from a colleague', async () => {
    const { data } = await bobClient.from('workspaces').select('id').eq('id', alicePersonalWs);
    expect(data).toHaveLength(0);
  });

  it('refuses a write into a workspace the user does not belong to', async () => {
    const { error } = await bobClient
      .from('tasks')
      .insert({ workspace_id: alicePersonalWs, title: 'Smuggled in' });
    expect(error).not.toBeNull();
  });

  it('denies all access to integration credentials', async () => {
    const { data } = await bobClient.from('integration_credentials').select('integration_id');
    expect(data ?? []).toHaveLength(0);
  });

  it('denies all access to the job queue', async () => {
    const { data } = await bobClient.from('job_runs').select('id');
    expect(data ?? []).toHaveLength(0);
  });

  it('rejects a task referencing another workspace\'s project', async () => {
    const { data: project } = await admin
      .from('projects')
      .insert({ workspace_id: teamWs, name: `P-${stamp}`, created_by: aliceId })
      .select('id').single();

    // Alice may write to both workspaces, so only the integrity trigger can
    // stop this -- RLS alone would permit it.
    const { error } = await aliceClient.from('tasks').insert({
      workspace_id: alicePersonalWs,
      project_id: project!.id,
      title: 'Cross-workspace smuggle',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not in workspace/i);
  });

  it('rejects assigning work to a non-member', async () => {
    const { error } = await aliceClient.from('tasks').insert({
      workspace_id: alicePersonalWs,
      title: 'Assign to an outsider',
      assignee_id: bobId,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not a member/i);
  });

  it('clears completed_at when the status is not completed', async () => {
    const { data } = await aliceClient
      .from('tasks')
      .insert({
        workspace_id: alicePersonalWs,
        title: 'Not actually done',
        status: 'todo',
        completed_at: new Date().toISOString(),
      })
      .select('completed_at')
      .single();

    // The trigger is what guarantees completion cannot be faked.
    expect(data?.completed_at).toBeNull();
  });

  it('sets completed_at only on a real transition to completed', async () => {
    const { data: created } = await aliceClient
      .from('tasks')
      .insert({ workspace_id: alicePersonalWs, title: 'Will be completed' })
      .select('id, completed_at').single();
    expect(created?.completed_at).toBeNull();

    const { data: done } = await aliceClient
      .from('tasks').update({ status: 'completed' }).eq('id', created!.id)
      .select('completed_at').single();
    expect(done?.completed_at).not.toBeNull();

    const { data: reopened } = await aliceClient
      .from('tasks').update({ status: 'todo' }).eq('id', created!.id)
      .select('completed_at').single();
    expect(reopened?.completed_at).toBeNull();
  });

  it('refuses a write from a viewer', async () => {
    await admin.from('workspace_members')
      .update({ role: 'viewer' }).eq('workspace_id', teamWs).eq('user_id', bobId);

    const { error } = await bobClient
      .from('tasks').insert({ workspace_id: teamWs, title: 'Viewer should not write' });
    expect(error).not.toBeNull();

    // A viewer still reads.
    const { data } = await bobClient.from('tasks').select('id').eq('id', sharedTask);
    expect(data).toHaveLength(1);

    await admin.from('workspace_members')
      .update({ role: 'member' }).eq('workspace_id', teamWs).eq('user_id', bobId);
  });
});
