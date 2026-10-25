-- 0002: profiles, workspaces, membership, and the SECURITY DEFINER helpers
-- that every workspace-scoped RLS policy is built on.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  -- All display and report rendering happens in this zone.
  timezone text not null default 'Asia/Kolkata',
  -- E.164. Destination for the private 9pm personal report.
  personal_whatsapp_e164 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_whatsapp_e164_format
    check (personal_whatsapp_e164 is null or personal_whatsapp_e164 ~ '^\+[1-9]\d{7,14}$')
);

create table if not exists public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  kind public.workspace_kind not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  timezone text not null default 'Asia/Kolkata',
  -- Group destination for the 9pm team report. Shape depends on the provider;
  -- see docs/INTEGRATIONS.md for which providers can address a group at all.
  team_whatsapp_destination text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Exactly one personal workspace per user; team workspaces are unlimited.
create unique index if not exists workspaces_one_personal_per_owner
  on public.workspaces (owner_id) where kind = 'personal';
create index if not exists workspaces_owner_idx on public.workspaces (owner_id);

create table if not exists public.workspace_members (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members (user_id);
create index if not exists workspace_members_workspace_idx on public.workspace_members (workspace_id);

create table if not exists public.workspace_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role public.workspace_role not null default 'member',
  -- Only the digest is stored; the raw token is e-mailed once.
  token_hash text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists workspace_invitations_pending_unique
  on public.workspace_invitations (workspace_id, lower(email)) where accepted_at is null;

-- ---------------------------------------------------------------------------
-- RLS helpers.
--
-- These are SECURITY DEFINER so that a policy on workspace_members can itself
-- ask "is the caller a member?" without re-entering that same policy, which
-- would recurse. search_path is pinned empty and every reference is qualified,
-- so the function body cannot be hijacked by a caller-controlled search_path.
-- ---------------------------------------------------------------------------

create or replace function app.is_workspace_member(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace and wm.user_id = auth.uid()
  );
$$;

create or replace function app.workspace_role(p_workspace uuid)
returns public.workspace_role language sql stable security definer set search_path = '' as $$
  select wm.role from public.workspace_members wm
  where wm.workspace_id = p_workspace and wm.user_id = auth.uid();
$$;

-- Owners and admins may change workspace settings, membership and integrations.
create or replace function app.can_manage_workspace(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.workspace_role(p_workspace) in ('owner', 'admin');
$$;

-- Viewers are deliberately excluded: they read, they do not write.
create or replace function app.can_write_workspace(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.workspace_role(p_workspace) in ('owner', 'admin', 'member');
$$;

-- True when the caller and p_user share at least one workspace. Used so that
-- profile rows (names, avatars) are visible to collaborators but not globally.
create or replace function app.shares_workspace(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user
  );
$$;

-- A personal workspace is private to its owner even if the owner also belongs
-- to team workspaces. Team membership never reaches into personal data.
create or replace function app.is_personal_workspace(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace and w.kind = 'personal'
  );
$$;

revoke all on function app.is_workspace_member(uuid) from public;
revoke all on function app.workspace_role(uuid) from public;
revoke all on function app.can_manage_workspace(uuid) from public;
revoke all on function app.can_write_workspace(uuid) from public;
revoke all on function app.shares_workspace(uuid) from public;
revoke all on function app.is_personal_workspace(uuid) from public;

grant execute on function app.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function app.workspace_role(uuid) to authenticated, service_role;
grant execute on function app.can_manage_workspace(uuid) to authenticated, service_role;
grant execute on function app.can_write_workspace(uuid) to authenticated, service_role;
grant execute on function app.shares_workspace(uuid) to authenticated, service_role;
grant execute on function app.is_personal_workspace(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

create or replace trigger workspaces_touch before update on public.workspaces
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Signup: every new auth user gets a profile and their own personal workspace,
-- so "switch between personal and team workspaces" works from first login.
-- ---------------------------------------------------------------------------

create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid;
  v_name text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, v_name)
  on conflict (id) do nothing;

  insert into public.workspaces (name, kind, owner_id)
  values ('Personal', 'personal', new.id)
  on conflict do nothing
  returning id into v_workspace;

  -- Null when the personal workspace already existed (idempotent re-run).
  if v_workspace is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_workspace, new.id, 'owner')
    on conflict (workspace_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();
