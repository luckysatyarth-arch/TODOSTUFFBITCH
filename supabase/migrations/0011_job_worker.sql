-- The job queue's claim, completion and failure semantics.
--
-- `job_runs` was created in 0006 with the right columns -- attempts,
-- max_attempts, run_after, locked_at, locked_by -- but nothing ever claimed a
-- row, so the queue was a table and not a queue. These are the four operations
-- a worker needs, in SQL rather than in application code, because atomic
-- claiming is the one part that cannot be got right from outside the database.
--
-- The table has RLS enabled with no policies, so every function here is
-- SECURITY DEFINER and reachable only through the service role. A client
-- cannot enqueue, claim or complete anything.

/*
 * Claims up to p_limit due jobs for one worker.
 *
 * `for update skip locked` is what makes two workers running at the same
 * moment safe: the second skips the rows the first has locked instead of
 * waiting for them or taking them twice. Without it, two overlapping cron
 * invocations would both run the same job, which for a transcription means
 * paying twice and for a delivery means sending twice.
 */
create or replace function public.claim_jobs(
  p_worker text,
  p_limit integer default 5,
  p_types text[] default null
)
returns setof public.job_runs
language sql security definer set search_path = '' as $$
  with due as (
    select j.id
    from public.job_runs j
    where j.status = 'queued'
      and j.run_after <= now()
      and (p_types is null or j.job_type = any (p_types))
    order by j.run_after, j.created_at
    limit greatest(1, least(coalesce(p_limit, 5), 50))
    for update skip locked
  )
  update public.job_runs j
  set status = 'running',
      attempts = j.attempts + 1,
      locked_at = now(),
      locked_by = p_worker,
      updated_at = now()
  from due
  where j.id = due.id
  returning j.*;
$$;

/** Records a job that finished. */
create or replace function public.complete_job(p_id uuid, p_result jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.job_runs
  set status = 'succeeded',
      result = coalesce(p_result, '{}'::jsonb),
      last_error = null,
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where id = p_id;
$$;

/*
 * Records a failure, and decides whether it gets another turn.
 *
 * A job that has used up its attempts becomes 'dead' rather than 'failed', so
 * "needs looking at" is a state someone can query for and not a judgement
 * about how many times a row has been retried. Backoff matches the report
 * deliveries: capped exponential, in minutes.
 */
create or replace function public.fail_job(
  p_id uuid,
  p_error text,
  p_retryable boolean default true
)
returns public.job_status
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.job_runs;
  v_status public.job_status;
begin
  select * into v_job from public.job_runs where id = p_id;
  if not found then return null; end if;

  if p_retryable and v_job.attempts < v_job.max_attempts then
    v_status := 'queued';
  else
    v_status := 'dead';
  end if;

  update public.job_runs
  set status = v_status,
      last_error = left(coalesce(p_error, 'unknown error'), 2000),
      -- Only a job that will run again needs a next time.
      run_after = case
        when v_status = 'queued'
          then now() + (least(power(2, v_job.attempts)::int, 32) || ' minutes')::interval
        else run_after
      end,
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where id = p_id;

  return v_status;
end;
$$;

/*
 * Returns jobs whose worker died mid-run to the queue.
 *
 * A process killed between claiming and finishing leaves a row 'running' with
 * nobody running it, and without this it would stay that way forever. The
 * attempt is already counted, so a job that repeatedly kills its worker still
 * reaches max_attempts and dies rather than looping.
 */
create or replace function public.reclaim_stale_jobs(p_older_than interval default '15 minutes')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  with stale as (
    update public.job_runs
    set status = case
          when attempts >= max_attempts then 'dead'::public.job_status
          else 'queued'::public.job_status
        end,
        last_error = coalesce(last_error, 'worker did not finish; reclaimed'),
        locked_at = null,
        locked_by = null,
        updated_at = now()
    where status = 'running'
      and locked_at < now() - p_older_than
    returning 1
  )
  select count(*) into v_count from stale;
  return v_count;
end;
$$;

/*
 * Enqueues a job, or returns the existing one with the same idempotency key.
 *
 * Returning the existing id rather than raising is what lets a caller enqueue
 * the same unit of work from two places -- an inline path and a sweep -- and
 * get one job.
 */
create or replace function public.enqueue_job(
  p_job_type text,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_run_after timestamptz default null,
  p_max_attempts integer default 5
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_idempotency_key is not null then
    select id into v_id from public.job_runs where idempotency_key = p_idempotency_key;
    if found then return v_id; end if;
  end if;

  insert into public.job_runs
    (job_type, payload, idempotency_key, run_after, max_attempts)
  values
    (p_job_type, coalesce(p_payload, '{}'::jsonb), p_idempotency_key,
     coalesce(p_run_after, now()), greatest(1, least(coalesce(p_max_attempts, 5), 20)))
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  -- Lost a race to a concurrent enqueue with the same key; take theirs.
  if v_id is null and p_idempotency_key is not null then
    select id into v_id from public.job_runs where idempotency_key = p_idempotency_key;
  end if;

  return v_id;
end;
$$;

comment on table public.job_runs is
  'Durable background work. Claimed with app.claim_jobs (for update skip locked); finished with app.complete_job or app.fail_job. RLS on with no policies: service role only.';

-- ---------------------------------------------------------------------------
-- Who may call these
-- ---------------------------------------------------------------------------
--
-- These five live in `public` rather than `app` because the worker reaches
-- them over PostgREST, which only exposes `public`; an `app` function would
-- simply 404 at runtime.
--
-- That makes the grants load-bearing. PostgreSQL grants EXECUTE on a new
-- function to PUBLIC, and Supabase's default privileges on this schema grant
-- it to `anon` and `authenticated` as well. Since these are SECURITY DEFINER,
-- a client call would run as the table's owner and read straight past the
-- deny-all RLS on job_runs -- so a signed-in user could read job payloads,
-- mark work succeeded that never ran, or flood the queue.
--
-- So each one is revoked from all three, explicitly. Only the service role,
-- which the worker route uses, keeps them.

revoke all on function public.claim_jobs(text, integer, text[]) from public, anon, authenticated;
revoke all on function public.complete_job(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_job(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.reclaim_stale_jobs(interval) from public, anon, authenticated;
revoke all on function public.enqueue_job(text, jsonb, text, timestamptz, integer) from public, anon, authenticated;

grant execute on function public.claim_jobs(text, integer, text[]) to service_role;
grant execute on function public.complete_job(uuid, jsonb) to service_role;
grant execute on function public.fail_job(uuid, text, boolean) to service_role;
grant execute on function public.reclaim_stale_jobs(interval) to service_role;
grant execute on function public.enqueue_job(text, jsonb, text, timestamptz, integer) to service_role;

-- The same default applies to the trigger functions added earlier in this
-- schema. PostgreSQL already refuses to call a trigger function directly
-- ("trigger functions can only be called as triggers"), so this closes
-- nothing exploitable; it is here so that the grant on an `app` function is
-- never an accident.
revoke all on function app.spawn_recurring_task() from public;
revoke all on function app.handle_new_user() from public;
revoke all on function app.log_task_activity() from public;

-- Deliberately NOT revoked: the helpers the RLS policies call
-- (app.is_workspace_member, app.can_write_workspace, app.can_manage_workspace,
-- app.can_read_document, app.can_read_integration, app.owns_capture,
-- app.shares_workspace, app.task_workspace, app.project_workspace). A policy
-- expression is evaluated as the querying user, so revoking EXECUTE on these
-- would break row level security on every table that uses them. Each answers
-- only about the caller's own access -- they read auth.uid() internally -- so
-- calling one directly tells a client nothing it could not already read. The
-- two lookups that do not (task_workspace, project_workspace, which return
-- the workspace id of a given row) require knowing a task or project id
-- already, and return only an opaque workspace id.
