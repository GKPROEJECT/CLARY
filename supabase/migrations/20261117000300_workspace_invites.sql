alter table public.workspaces
  add column if not exists icon_path text;

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz
);

alter table public.workspace_invites enable row level security;
revoke all on public.workspace_invites from public, anon, authenticated;

create or replace function public.create_workspace_invite(target_workspace_id uuid, target_token_hash text)
returns timestamptz
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  expiry timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null or not public.is_workspace_member(target_workspace_id) then
    raise exception 'No tienes permiso para invitar a este espacio.';
  end if;
  if target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'El enlace de invitación no es válido.';
  end if;
  insert into public.workspace_invites (workspace_id, token_hash, created_by, expires_at)
  values (target_workspace_id, target_token_hash, auth.uid(), expiry);
  return expiry;
end;
$$;

create or replace function public.accept_workspace_invite(target_token_hash text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  invite public.workspace_invites%rowtype;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Inicia sesión para unirte a un espacio.'; end if;
  select * into invite
  from public.workspace_invites
  where token_hash = target_token_hash
  for update;
  if invite.id is null then
    raise exception 'El enlace ha caducado o ya se ha utilizado.';
  end if;
  if invite.accepted_at is not null then
    if invite.accepted_by = current_user_id then return invite.workspace_id; end if;
    raise exception 'El enlace ha caducado o ya se ha utilizado.';
  end if;
  if invite.expires_at <= now() then raise exception 'El enlace ha caducado o ya se ha utilizado.'; end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (invite.workspace_id, current_user_id, 'member')
  on conflict (workspace_id, user_id) do nothing;
  update public.workspace_invites
  set accepted_by = current_user_id, accepted_at = now()
  where id = invite.id;
  return invite.workspace_id;
end;
$$;

revoke all on function public.create_workspace_invite(uuid, text) from public, anon;
revoke all on function public.accept_workspace_invite(text) from public, anon;
grant execute on function public.create_workspace_invite(uuid, text) to authenticated;
grant execute on function public.accept_workspace_invite(text) to authenticated;