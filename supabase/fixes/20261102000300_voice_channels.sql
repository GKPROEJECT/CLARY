alter table public.rooms drop constraint if exists rooms_kind_check;
alter table public.rooms add constraint rooms_kind_check
  check (kind in ('channel', 'voice', 'direct', 'group'));

alter table public.rooms drop constraint if exists rooms_check;
alter table public.rooms drop constraint if exists rooms_workspace_kind_check;
alter table public.rooms add constraint rooms_workspace_kind_check
  check (
    (kind in ('channel', 'voice') and workspace_id is not null)
    or (kind in ('direct', 'group') and workspace_id is null)
  );

drop policy if exists rooms_read_member on public.rooms;
create policy rooms_read_member on public.rooms
  for select to authenticated using (
    (kind in ('channel', 'voice') and public.is_workspace_member(workspace_id))
    or (kind in ('direct', 'group') and public.is_room_member(id))
  );

drop policy if exists channels_create_member on public.rooms;
create policy channels_create_member on public.rooms
  for insert to authenticated with check (
    kind in ('channel', 'voice')
    and created_by = auth.uid()
    and public.is_workspace_member(workspace_id)
  );

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

revoke all on function public.can_access_room(uuid) from public, anon;
grant execute on function public.can_access_room(uuid) to authenticated;

drop policy if exists clary_private_voice_signaling on realtime.messages;
create policy clary_private_voice_signaling on realtime.messages
  for all to authenticated
  using (
    case
      when realtime.topic() ~ '^voice:[0-9a-fA-F-]{36}$'
        then public.can_access_room(split_part(realtime.topic(), ':', 2)::uuid)
      when realtime.topic() ~ '^voice-call:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$'
        then auth.uid() = split_part(realtime.topic(), ':', 2)::uuid
          or public.can_access_room(split_part(realtime.topic(), ':', 3)::uuid)
      else false
    end
  )
  with check (
    case
      when realtime.topic() ~ '^voice:[0-9a-fA-F-]{36}$'
        then public.can_access_room(split_part(realtime.topic(), ':', 2)::uuid)
      when realtime.topic() ~ '^voice-call:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$'
        then public.can_access_room(split_part(realtime.topic(), ':', 3)::uuid)
      else false
    end
  );