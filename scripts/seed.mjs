#!/usr/bin/env node
/**
 * Seeds a development database with realistic demo data.
 *
 * Needs the service role key, because it creates confirmed auth users (so you
 * can sign in immediately without an email round trip) and writes rows that
 * row level security reserves for the server.
 *
 *   node --env-file=.env.local scripts/seed.mjs
 *
 * Idempotent: re-running it reuses the existing demo users and leaves their
 * data alone rather than duplicating it. Pass --reset to delete the demo users
 * first, which cascades to everything they own.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    'Missing configuration.\n\n' +
    '  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required.\n' +
    '  Copy .env.example to .env.local, fill them in, then run:\n\n' +
    '    node --env-file=.env.local scripts/seed.mjs\n',
  );
  process.exit(1);
}

const reset = process.argv.includes('--reset');
const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = 'demo-password-1';
const PEOPLE = [
  { email: 'alice@demo.test', name: 'Alice Alpha', whatsapp: '+919876543210' },
  { email: 'bob@demo.test', name: 'Bob Beta', whatsapp: '+919876543211' },
  { email: 'priya@demo.test', name: 'Priya Sharma', whatsapp: null },
];

/** Calendar date N days from today, as YYYY-MM-DD. */
function day(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function findUserByEmail(email) {
  // listUsers is paginated; the demo set is small enough for one page.
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  return data?.users?.find((u) => u.email === email) ?? null;
}

async function ensureUser({ email, name, whatsapp }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    await db.from('profiles')
      .update({ full_name: name, personal_whatsapp_e164: whatsapp })
      .eq('id', existing.id);
    return { id: existing.id, created: false };
  }

  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    // Confirmed up front so the demo accounts can sign in with no email step.
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw new Error(`Could not create ${email}: ${error.message}`);

  await db.from('profiles')
    .update({ full_name: name, personal_whatsapp_e164: whatsapp })
    .eq('id', data.user.id);

  return { id: data.user.id, created: true };
}

async function main() {
  if (reset) {
    console.log('Resetting demo users…');
    for (const person of PEOPLE) {
      const user = await findUserByEmail(person.email);
      if (user) {
        // Cascades to workspaces, tasks, captures and everything else owned.
        await db.auth.admin.deleteUser(user.id);
        console.log(`  deleted ${person.email}`);
      }
    }
  }

  console.log('Creating demo users…');
  const users = {};
  for (const person of PEOPLE) {
    const result = await ensureUser(person);
    users[person.email] = result.id;
    console.log(`  ${result.created ? 'created' : 'reused '} ${person.email}`);
  }

  const alice = users['alice@demo.test'];
  const bob = users['bob@demo.test'];
  const priya = users['priya@demo.test'];

  // --- Team workspace -------------------------------------------------------
  const TEAM_NAME = 'Acme Product';
  let { data: team } = await db
    .from('workspaces').select('id').eq('name', TEAM_NAME).eq('owner_id', alice).maybeSingle();

  if (!team) {
    const inserted = await db
      .from('workspaces')
      .insert({
        name: TEAM_NAME,
        kind: 'team',
        owner_id: alice,
        timezone: 'Asia/Kolkata',
        team_whatsapp_destination: null,
      })
      .select('id').single();
    if (inserted.error) throw new Error(inserted.error.message);
    team = inserted.data;
    console.log(`Created team workspace "${TEAM_NAME}"`);
  } else {
    console.log(`Reusing team workspace "${TEAM_NAME}"`);
  }

  await db.from('workspace_members').upsert([
    { workspace_id: team.id, user_id: alice, role: 'owner' },
    { workspace_id: team.id, user_id: bob, role: 'member' },
    { workspace_id: team.id, user_id: priya, role: 'viewer' },
  ], { onConflict: 'workspace_id,user_id' });

  // Everything below is skipped if the workspace already has tasks, so a
  // re-run does not pile up duplicates.
  const { count: existingTasks } = await db
    .from('tasks').select('id', { count: 'exact', head: true }).eq('workspace_id', team.id);

  if ((existingTasks ?? 0) > 0) {
    console.log(`\nWorkspace already has ${existingTasks} tasks; leaving its data alone.`);
    report(users, team.id);
    return;
  }

  // --- Projects -------------------------------------------------------------
  const { data: projects, error: projectError } = await db
    .from('projects')
    .insert([
      {
        workspace_id: team.id, name: 'Investor presentation',
        description: 'Series A deck, research appendix and the rehearsal schedule.',
        owner_id: alice, status: 'active', priority: 'high',
        start_date: day(-14), target_date: day(5), created_by: alice,
      },
      {
        workspace_id: team.id, name: 'Website relaunch',
        description: 'New marketing site on the rebuilt design system.',
        owner_id: bob, status: 'active', priority: 'medium',
        start_date: day(-30), target_date: day(35), created_by: alice,
      },
      {
        workspace_id: team.id, name: 'Q3 hiring',
        description: 'Two engineers and a designer.',
        owner_id: alice, status: 'planning', priority: 'low',
        start_date: day(7), target_date: day(90), created_by: alice,
      },
    ])
    .select('id, name');
  if (projectError) throw new Error(projectError.message);

  const byName = Object.fromEntries(projects.map((p) => [p.name, p.id]));
  const deck = byName['Investor presentation'];
  const site = byName['Website relaunch'];

  // --- Tasks ----------------------------------------------------------------
  // A deliberate spread: completed today, overdue, blocked, unassigned and
  // upcoming, so every dashboard panel and report section has real content.
  const tasks = [
    { project_id: deck, title: 'Finish the investor presentation', status: 'in_progress', priority: 'urgent', assignee_id: alice, due_date: day(0), estimated_minutes: 240 },
    { project_id: deck, title: 'Write the market research section', status: 'blocked', priority: 'high', assignee_id: bob, due_date: day(-2), estimated_minutes: 180 },
    { project_id: deck, title: 'Collect competitor pricing', status: 'completed', priority: 'medium', assignee_id: bob, due_date: day(-3), estimated_minutes: 60, completed_at: new Date().toISOString() },
    { project_id: deck, title: 'Rehearse the pitch with the team', status: 'todo', priority: 'high', assignee_id: alice, due_date: day(3), estimated_minutes: 90 },
    { project_id: deck, title: 'Build the financial model appendix', status: 'in_review', priority: 'high', assignee_id: bob, due_date: day(1), estimated_minutes: 300 },
    { project_id: site, title: 'Draft homepage copy', status: 'todo', priority: 'medium', assignee_id: alice, due_date: day(2), estimated_minutes: 120 },
    { project_id: site, title: 'Pick a web host', status: 'todo', priority: 'low', assignee_id: null, due_date: day(6), estimated_minutes: 30 },
    { project_id: site, title: 'Migrate the blog archive', status: 'todo', priority: 'low', assignee_id: bob, due_date: day(12), estimated_minutes: 480 },
    { project_id: site, title: 'Audit the old site for dead links', status: 'completed', priority: 'low', assignee_id: bob, due_date: day(-5), completed_at: new Date(Date.now() - 86_400_000).toISOString() },
    { project_id: null, title: 'Schedule the quarterly review', status: 'todo', priority: 'medium', assignee_id: null, due_date: day(1), estimated_minutes: 15 },
    { project_id: null, title: 'Renew the design tool subscription', status: 'todo', priority: 'low', assignee_id: alice, due_date: day(-1), estimated_minutes: 10 },
  ];

  const { data: insertedTasks, error: taskError } = await db
    .from('tasks')
    .insert(tasks.map((t) => ({ ...t, workspace_id: team.id, created_by: alice })))
    .select('id, title');
  if (taskError) throw new Error(taskError.message);

  const taskByTitle = Object.fromEntries(insertedTasks.map((t) => [t.title, t.id]));

  // The research section waits on competitor pricing.
  await db.from('task_dependencies').insert({
    task_id: taskByTitle['Write the market research section'],
    depends_on_task_id: taskByTitle['Collect competitor pricing'],
  });

  await db.from('task_comments').insert([
    {
      task_id: taskByTitle['Write the market research section'],
      author_id: bob,
      body: 'Blocked until the pricing sheet is signed off — the comparison table depends on it.',
    },
    {
      task_id: taskByTitle['Finish the investor presentation'],
      author_id: alice,
      body: 'Slides 1-9 are done. The appendix still needs the updated figures.',
    },
  ]);

  // --- Milestones, events, notes -------------------------------------------
  await db.from('milestones').insert([
    { workspace_id: team.id, project_id: deck, name: 'Deck reviewed by the board', due_date: day(3), status: 'pending' },
    { workspace_id: team.id, project_id: deck, name: 'Research appendix complete', due_date: day(-2), status: 'at_risk' },
    { workspace_id: team.id, project_id: site, name: 'Design system frozen', due_date: day(14), status: 'pending' },
  ]);

  await db.from('calendar_events').insert([
    {
      workspace_id: team.id, project_id: deck, title: 'Board review call',
      is_all_day: false,
      starts_at: `${day(3)}T04:30:00.000Z`, // 10:00 IST
      ends_at: `${day(3)}T05:30:00.000Z`,
      created_by: alice,
    },
    {
      workspace_id: team.id, title: 'Company offsite',
      is_all_day: true, start_date: day(10), end_date: day(11), created_by: alice,
    },
  ]);

  await db.from('notes').insert([
    {
      workspace_id: team.id, project_id: deck, author_id: alice,
      title: 'Pitch narrative outline',
      body: 'Problem, why now, what we built, traction, the ask.\n\n' +
            'Agreed with the board that the ask lands on slide 11, after traction.',
    },
  ]);

  // --- Capture with pending proposals --------------------------------------
  // Pre-extracted, so the approval inbox has something to review without
  // needing an AI key configured.
  const { data: capture } = await db
    .from('captures')
    .insert({
      workspace_id: team.id, owner_id: alice, kind: 'voice', status: 'ready',
      title: 'Monday standup note',
      raw_text:
        'Need to finish the investor presentation by Friday. Ask Bob to take the research ' +
        'section. We should also book a slot for the investor Q and A at some point, and ' +
        'somebody needs to chase the venue about the offsite.',
      source_provider: 'manual',
      processed_at: new Date().toISOString(),
      source_metadata: {
        summary: 'Standup covering the deck, the research split and two loose ends.',
        decisions: ['Bob takes the research section.'],
        blockers: ['Competitor pricing is not signed off.'],
        open_questions: ['When is the investor Q and A?'],
        instruction_attempt: false,
      },
    })
    .select('id').single();

  await db.from('proposed_tasks').insert([
    {
      capture_id: capture.id, workspace_id: team.id, status: 'pending',
      title: 'Ask Bob to take the research section',
      suggested_assignee_id: bob, suggested_due_date: day(4),
      suggested_priority: 'high', confidence: 0.86,
      uncertain_fields: [],
      source_excerpt: 'Ask Bob to take the research section.',
    },
    {
      capture_id: capture.id, workspace_id: team.id, status: 'pending',
      title: 'Book a slot for the investor Q&A',
      suggested_assignee_id: null, suggested_due_date: null,
      suggested_priority: null, confidence: 0.41,
      // Shows the "uncertain rather than invented" behaviour in the UI.
      uncertain_fields: ['assignee', 'due_date', 'priority'],
      extraction_notes: 'No owner or date was given: "at some point" is not a deadline.',
      source_excerpt: 'We should also book a slot for the investor Q and A at some point',
    },
    {
      capture_id: capture.id, workspace_id: team.id, status: 'pending',
      title: 'Chase the venue about the offsite',
      suggested_assignee_id: null, suggested_due_date: null,
      suggested_priority: 'medium', confidence: 0.72,
      uncertain_fields: ['assignee', 'due_date'],
      extraction_notes: '"Somebody" was not resolved to a person.',
      source_excerpt: 'somebody needs to chase the venue about the offsite',
    },
  ]);

  // --- Personal workspace content ------------------------------------------
  const { data: personal } = await db
    .from('workspaces').select('id').eq('owner_id', alice).eq('kind', 'personal').single();

  await db.from('tasks').insert([
    { workspace_id: personal.id, title: 'Book the dentist', status: 'todo', priority: 'medium', assignee_id: alice, created_by: alice, due_date: day(4) },
    { workspace_id: personal.id, title: 'Renew passport', status: 'todo', priority: 'high', assignee_id: alice, created_by: alice, due_date: day(-6) },
    { workspace_id: personal.id, title: 'Plan the weekend trip', status: 'completed', priority: 'low', assignee_id: alice, created_by: alice, completed_at: new Date().toISOString() },
  ]);

  console.log('\nSeeded the demo data.');
  report(users, team.id);
}

function report(users, teamId) {
  console.log('\nSign in with any of these (password: ' + PASSWORD + '):');
  for (const person of PEOPLE) {
    console.log(`  ${person.email.padEnd(22)} ${person.name}`);
  }
  console.log(
    '\n  Alice is the team owner, Bob a member, Priya a viewer (read-only).\n' +
    '  Alice also has a private personal workspace that the others cannot see.\n' +
    `  Team workspace id: ${teamId}\n`,
  );
  console.log('Next: npm run dev, then open http://localhost:3000\n');
}

main().catch((error) => {
  console.error('\nSeeding failed:', error.message);
  process.exit(1);
});
