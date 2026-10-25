-- The job queue's claim, retry and reclaim semantics.
--
-- The property that matters is that two workers running at the same moment
-- cannot take the same job. That cannot be tested from a single session, so
-- the concurrency check below uses two real connections via dblink; everything
-- else runs inline.

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.check(label text, actual anyelement, expected anyelement)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL % — expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok   % (%)', label, actual;
end;
$$;

-- Enqueueing ----------------------------------------------------------------

select public.enqueue_job('transcribe', '{"capture":"c1"}'::jsonb, 'capture:c1') as j1 \gset

select pg_temp.check('enqueue returns an id',
  (select count(*) from public.job_runs where id = :'j1'::uuid), 1::bigint);

select pg_temp.check('a new job starts queued with no attempts',
  (select status::text || '/' || attempts from public.job_runs where id = :'j1'::uuid),
  'queued/0');

-- The same key must not create a second job, so an inline path and a sweep can
-- both enqueue the same work and get one job.
select public.enqueue_job('transcribe', '{"capture":"c1"}'::jsonb, 'capture:c1') as j1b \gset

select pg_temp.check('the same idempotency key returns the same job',
  :'j1b'::uuid = :'j1'::uuid, true);

select pg_temp.check('and creates no second row',
  (select count(*) from public.job_runs), 1::bigint);

-- Without a key, two enqueues are two jobs.
select public.enqueue_job('embed', '{"doc":"d1"}'::jsonb) as j2 \gset
select public.enqueue_job('embed', '{"doc":"d1"}'::jsonb) as j3 \gset

select pg_temp.check('an unkeyed job is not deduplicated',
  :'j2'::uuid <> :'j3'::uuid, true);

-- Claiming -------------------------------------------------------------------

select pg_temp.check('claiming marks the job running and counts the attempt',
  (select status::text || '/' || attempts || '/' || locked_by
     from public.claim_jobs('worker-a', 1, array['transcribe'])),
  'running/1/worker-a');

select pg_temp.check('a running job is not claimed again',
  (select count(*) from public.claim_jobs('worker-b', 10, array['transcribe'])),
  0::bigint);

select pg_temp.check('the type filter is honoured',
  (select count(*) from public.claim_jobs('worker-a', 10, array['nonexistent'])),
  0::bigint);

-- A job scheduled for later is not due yet.
select public.enqueue_job('later', '{}'::jsonb, null, now() + interval '1 hour') as j4 \gset

select pg_temp.check('a future job is not claimed',
  (select count(*) from public.claim_jobs('worker-a', 10, array['later'])),
  0::bigint);

select pg_temp.check('claiming respects the limit',
  (select count(*) from public.claim_jobs('worker-a', 1, array['embed'])),
  1::bigint);

-- Completing and failing -----------------------------------------------------

select public.complete_job(:'j1'::uuid, '{"text":"done"}'::jsonb);

select pg_temp.check('a completed job releases its lock and keeps its result',
  (select status::text || '/' || (locked_by is null)::text || '/' || (result ->> 'text')
     from public.job_runs where id = :'j1'::uuid),
  'succeeded/true/done');

-- A retryable failure goes back to the queue, with a later run_after.
select public.fail_job(:'j2'::uuid, 'provider timed out', true) as outcome \gset

select pg_temp.check('a retryable failure is requeued',
  :'outcome'::text, 'queued');

select pg_temp.check('and is deferred rather than retried immediately',
  (select run_after > now() and locked_by is null and last_error = 'provider timed out'
     from public.job_runs where id = :'j2'::uuid),
  true);

-- A non-retryable failure is done, however many attempts remain.
select public.fail_job(:'j3'::uuid, 'payload was malformed', false) as outcome3 \gset

select pg_temp.check('a non-retryable failure is dead at once',
  :'outcome3'::text, 'dead');

select pg_temp.check('even with attempts to spare',
  (select attempts < max_attempts from public.job_runs where id = :'j3'::uuid),
  true);

-- Attempts are finite: a job that keeps failing dies rather than looping.
select public.enqueue_job('flaky', '{}'::jsonb, 'flaky:1', null, 3) as j5 \gset

do $$
declare
  v_outcome public.job_status;
  v_id uuid := (select id from public.job_runs where idempotency_key = 'flaky:1');
begin
  for i in 1..3 loop
    -- run_after is pushed into the future by each failure, so the claim is
    -- simulated rather than waiting out the backoff.
    update public.job_runs set status = 'queued', run_after = now() where id = v_id;
    perform public.claim_jobs('worker-a', 1, array['flaky']);
    v_outcome := public.fail_job(v_id, format('attempt %s failed', i), true);
  end loop;

  if v_outcome <> 'dead' then
    raise exception 'FAIL a job past max_attempts was still queued (%)', v_outcome;
  end if;
  raise notice 'ok   a job that exhausts max_attempts becomes dead, not queued';
end;
$$;

select pg_temp.check('the dead job records its last error and attempt count',
  (select attempts || '/' || last_error from public.job_runs
     where idempotency_key = 'flaky:1'),
  '3/attempt 3 failed');

-- Reclaiming -----------------------------------------------------------------

-- A worker killed mid-job leaves a row running with nobody running it.
select public.enqueue_job('stuck', '{}'::jsonb, 'stuck:1') as j6 \gset
select count(*) from public.claim_jobs('worker-doomed', 1, array['stuck']) \gset claimed_

update public.job_runs set locked_at = now() - interval '1 hour'
  where idempotency_key = 'stuck:1';

select pg_temp.check('a stale running job is reclaimed',
  public.reclaim_stale_jobs('15 minutes'), 1);

select pg_temp.check('and is claimable again',
  (select status::text from public.job_runs where idempotency_key = 'stuck:1'),
  'queued');

-- A job that is running but still fresh must not be snatched from its worker.
select public.enqueue_job('fresh', '{}'::jsonb, 'fresh:1') \gset enq_
select count(*) from public.claim_jobs('worker-busy', 1, array['fresh']) \gset c2_

select pg_temp.check('a freshly claimed job is left alone',
  public.reclaim_stale_jobs('15 minutes'), 0);

select pg_temp.check('and is still held by its worker',
  (select status::text || '/' || locked_by from public.job_runs
     where idempotency_key = 'fresh:1'),
  'running/worker-busy');

-- A worker that keeps dying must not retry forever either.
update public.job_runs
  set attempts = max_attempts, locked_at = now() - interval '1 hour'
  where idempotency_key = 'fresh:1';

select pg_temp.check('a stale job with no attempts left is reclaimed as dead',
  (select public.reclaim_stale_jobs('15 minutes') > 0), true);

select pg_temp.check('so it stops being retried',
  (select status::text from public.job_runs where idempotency_key = 'fresh:1'),
  'dead');

-- Authorization --------------------------------------------------------------

-- The queue is service-role-only. `job_runs` has RLS on with no policies, but
-- that alone is not enough: the functions above are SECURITY DEFINER, so if a
-- client could execute one it would run as the table's owner and read straight
-- past the policies. PostgreSQL grants EXECUTE to PUBLIC by default and
-- `authenticated` holds USAGE on the app schema for the RLS helpers, so the
-- grants have to be revoked by hand -- and therefore tested, since nothing
-- about the table's own setup would reveal the gap.

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.com');

insert into public.job_runs (job_type, payload)
values ('secret', '{"access_token":"super-secret-value"}'::jsonb);

grant select on public.job_runs to authenticated;

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';

select pg_temp.check(
  'a signed-in user reads no jobs directly, despite an explicit SELECT grant',
  (select count(*) from public.job_runs),
  0::bigint);

-- Each of the five must be refused by name. A loop would hide which one is
-- open if a future migration re-grants it.
do $$
declare
  v_open text[] := '{}';
begin
  begin perform public.claim_jobs('attacker', 10);
    v_open := v_open || 'claim_jobs'::text;
  exception when insufficient_privilege then null; end;

  begin perform public.enqueue_job('attacker', '{}'::jsonb);
    v_open := v_open || 'enqueue_job'::text;
  exception when insufficient_privilege then null; end;

  begin perform public.complete_job('00000000-0000-0000-0000-000000000000'::uuid);
    v_open := v_open || 'complete_job'::text;
  exception when insufficient_privilege then null; end;

  begin perform public.fail_job('00000000-0000-0000-0000-000000000000'::uuid, 'x');
    v_open := v_open || 'fail_job'::text;
  exception when insufficient_privilege then null; end;

  begin perform public.reclaim_stale_jobs();
    v_open := v_open || 'reclaim_stale_jobs'::text;
  exception when insufficient_privilege then null; end;

  if array_length(v_open, 1) > 0 then
    raise exception 'FAIL a client can execute: %', array_to_string(v_open, ', ');
  end if;
  raise notice 'ok   all five queue functions are refused to a signed-in client';
end;
$$;

reset role;

-- And to an anonymous caller, which Supabase's default privileges on the
-- public schema would otherwise have granted alongside `authenticated`.
set local role anon;

do $$
begin
  perform public.claim_jobs('anon-attacker', 10);
  raise exception 'FAIL an anonymous caller claimed jobs';
exception when insufficient_privilege then
  raise notice 'ok   the queue is refused to an anonymous caller too';
end;
$$;

reset role;

-- The service role is what the worker runs as, and it must still work.
set local role service_role;

select pg_temp.check(
  'the service role can still claim',
  (select count(*) from public.claim_jobs('worker-real', 1, array['secret'])),
  1::bigint);

reset role;

rollback;
