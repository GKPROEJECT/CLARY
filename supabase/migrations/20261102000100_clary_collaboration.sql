create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('channel', 'voice', 'direct', 'group')),
  name text not null check (char_length(name) between 1 and 80),
  purpose text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((kind in ('channel', 'voice') and workspace_id is not null) or (kind in ('direct', 'group') and workspace_id is null))
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  content text not null default '',
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint check (attachment_size is null or attachment_size between 1 and 26214400),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (char_length(content) <= 10000),
  check (char_length(btrim(content)) > 0 or attachment_path is not null or deleted_at is not null)
);

create index if not exists workspace_members_user_idx on public.workspace_members (user_id, workspace_id);
create index if not exists room_members_user_idx on public.room_members (user_id, room_id);
create index if not exists room_messages_room_created_idx on public.room_messages (room_id, created_at);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_room_member(target_room_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.room_members
    where room_id = target_room_id and user_id = auth.uid()
  );
$$;

create or replace function public.can_access_room(target_room_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rooms as room
    where room.id = target_room_id
      and (
        (room.kind in ('channel', 'voice') and public.is_workspace_member(room.workspace_id))
        or (room.kind in ('direct', 'group') and public.is_room_member(room.id))
      )
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_room_member(uuid) from public, anon;
revoke all on function public.can_access_room(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.can_access_room(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  base_username text;
  user_display_name text;
begin
  user_display_name := left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'Usuario'), '@', 1)), 80);
  base_username := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, 'usuario'), '@', 1)), '[^a-zA-Z0-9._-]', '', 'g'));
  base_username := left(coalesce(nullif(base_username, ''), 'usuario'), 24) || '-' || left(replace(new.id::text, '-', ''), 6);

  insert into public.profiles (id, username, display_name)
  values (new.id, base_username, user_display_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_clary on auth.users;
create trigger on_auth_user_created_clary
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.provision_workspace()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');

  insert into public.rooms (workspace_id, kind, name, purpose, created_by)
  values (new.id, 'channel', 'general', 'El canal principal del espacio.', new.created_by);
  return new;
end;
$$;

drop trigger if exists on_workspace_created_clary on public.workspaces;
create trigger on_workspace_created_clary
  after insert on public.workspaces
  for each row execute function public.provision_workspace();

create or replace function public.provision_room_creator()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.room_members (room_id, user_id)
  values (new.id, new.created_by)
  on conflict do nothing;
  return new;
end;
$$;

create or replace function public.create_workspace(workspace_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  new_workspace_id uuid;
begin
  if current_user_id is null then raise exception 'Inicia sesión para crear un espacio.'; end if;
  if char_length(btrim(workspace_name)) not between 1 and 80 then
    raise exception 'El nombre del espacio debe tener entre 1 y 80 caracteres.';
  end if;
  if not exists (select 1 from public.profiles where id = current_user_id) then
    raise exception 'No se encontró el perfil de tu cuenta.';
  end if;

  insert into public.workspaces (name, created_by)
  values (btrim(workspace_name), current_user_id)
  returning id into new_workspace_id;

  return new_workspace_id;
end;
$$;

drop trigger if exists on_room_created_clary on public.rooms;
create trigger on_room_created_clary
  after insert on public.rooms
  for each row execute function public.provision_room_creator();

create or replace function public.create_direct_room(other_user_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  new_room_id uuid;
begin
  if current_user_id is null or other_user_id = current_user_id then
    raise exception 'Selecciona otra persona para iniciar el mensaje directo.';
  end if;
  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'No se encontró esa cuenta.';
  end if;

  select room.id into new_room_id
  from public.rooms as room
  join public.room_members as current_member on current_member.room_id = room.id and current_member.user_id = current_user_id
  join public.room_members as other_member on other_member.room_id = room.id and other_member.user_id = other_user_id
  where room.kind = 'direct'
  limit 1;

  if new_room_id is not null then return new_room_id; end if;

  insert into public.rooms (kind, name, created_by)
  values ('direct', 'Conversación directa', current_user_id)
  returning id into new_room_id;

  insert into public.room_members (room_id, user_id)
  values (new_room_id, other_user_id)
  on conflict do nothing;
  return new_room_id;
end;
$$;

create or replace function public.create_group_room(group_name text, member_usernames text[])
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_usernames text[];
  matching_profiles integer;
  new_room_id uuid;
begin
  if current_user_id is null then raise exception 'Inicia sesión para crear un grupo.'; end if;
  if char_length(btrim(group_name)) not between 1 and 80 then raise exception 'El nombre del grupo no es válido.'; end if;

  select array_agg(distinct lower(ltrim(btrim(value), '@')))
  into normalized_usernames
  from unnest(coalesce(member_usernames, array[]::text[])) as entry(value)
  where btrim(value) <> '';
  normalized_usernames := coalesce(normalized_usernames, array[]::text[]);

  select count(*) into matching_profiles
  from public.profiles where username = any(normalized_usernames);
  if matching_profiles <> cardinality(normalized_usernames) then
    raise exception 'Uno o más nombres de usuario no existen.';
  end if;

  insert into public.rooms (kind, name, created_by)
  values ('group', btrim(group_name), current_user_id)
  returning id into new_room_id;

  insert into public.room_members (room_id, user_id)
  select new_room_id, profile.id from public.profiles as profile
  where profile.username = any(normalized_usernames)
  on conflict do nothing;
  return new_room_id;
end;
$$;

create or replace function public.add_workspace_member(target_workspace_id uuid, target_username text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  invited_user_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'Solo el propietario puede invitar personas a este espacio.';
  end if;

  select id into invited_user_id from public.profiles
  where username = lower(ltrim(btrim(target_username), '@'));
  if invited_user_id is null then raise exception 'No se encontró esa cuenta.'; end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (target_workspace_id, invited_user_id, 'member')
  on conflict do nothing;
end;
$$;

revoke all on function public.create_direct_room(uuid) from public, anon;
revoke all on function public.create_group_room(text, text[]) from public, anon;
revoke all on function public.add_workspace_member(uuid, text) from public, anon;
revoke all on function public.create_workspace(text) from public, anon;
grant execute on function public.create_direct_room(uuid) to authenticated;
grant execute on function public.create_group_room(text, text[]) to authenticated;
grant execute on function public.add_workspace_member(uuid, text) to authenticated;
grant execute on function public.create_workspace(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_messages enable row level security;

drop policy if exists profiles_read_authenticated on public.profiles;
create policy profiles_read_authenticated on public.profiles
  for select to authenticated using (true);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists workspaces_read_member on public.workspaces;
create policy workspaces_read_member on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
drop policy if exists workspaces_create_self on public.workspaces;
create policy workspaces_create_self on public.workspaces
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists workspaces_update_owner on public.workspaces;
create policy workspaces_update_owner on public.workspaces
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists workspace_members_read_member on public.workspace_members;
create policy workspace_members_read_member on public.workspace_members
  for select to authenticated using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

drop policy if exists rooms_read_member on public.rooms;
create policy rooms_read_member on public.rooms
  for select to authenticated using (
    (kind in ('channel', 'voice') and public.is_workspace_member(workspace_id))
    or (kind in ('direct', 'group') and public.is_room_member(id))
  );
drop policy if exists channels_create_member on public.rooms;
create policy channels_create_member on public.rooms
  for insert to authenticated with check (
    kind in ('channel', 'voice') and created_by = auth.uid() and public.is_workspace_member(workspace_id)
  );

drop policy if exists room_members_read_room on public.room_members;
create policy room_members_read_room on public.room_members
  for select to authenticated using (user_id = auth.uid() or public.can_access_room(room_id));

drop policy if exists messages_read_room on public.room_messages;
create policy messages_read_room on public.room_messages
  for select to authenticated using (public.can_access_room(room_id));
drop policy if exists messages_create_as_self on public.room_messages;
create policy messages_create_as_self on public.room_messages
  for insert to authenticated with check (author_id = auth.uid() and public.can_access_room(room_id));
drop policy if exists messages_delete_own on public.room_messages;
create policy messages_delete_own on public.room_messages
  for update to authenticated
  using (author_id = auth.uid() and deleted_at is null and public.can_access_room(room_id))
  with check (author_id = auth.uid() and deleted_at is not null and public.can_access_room(room_id));

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select, insert on public.rooms to authenticated;
grant select on public.room_members to authenticated;
grant select, insert on public.room_messages to authenticated;
grant update (deleted_at, content, attachment_path, attachment_name, attachment_mime, attachment_size)
  on public.room_messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/*']),
  ('chat-files', 'chat-files', false, 26214400, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatar_upload_own on storage.objects;
create policy avatar_upload_own on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists avatar_update_own on storage.objects;
create policy avatar_update_own on storage.objects
  for update to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists avatar_delete_own on storage.objects;
create policy avatar_delete_own on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists chat_files_read_room on storage.objects;
create policy chat_files_read_room on storage.objects
  for select to authenticated using (
    bucket_id = 'chat-files' and public.can_access_room(((storage.foldername(name))[1])::uuid)
  );
drop policy if exists chat_files_upload_room on storage.objects;
create policy chat_files_upload_room on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-files'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.can_access_room(((storage.foldername(name))[1])::uuid)
  );
drop policy if exists chat_files_delete_own on storage.objects;
create policy chat_files_delete_own on storage.objects
  for delete to authenticated using (
    bucket_id = 'chat-files'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.can_access_room(((storage.foldername(name))[1])::uuid)
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_messages'
  ) then
    alter publication supabase_realtime add table public.room_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;