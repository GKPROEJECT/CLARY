create or replace function public.delete_workspace_channel(target_room_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  target_workspace_id uuid;
begin
  select workspace_id into target_workspace_id
  from public.rooms
  where id = target_room_id
    and kind in ('channel', 'voice')
    and created_by = auth.uid()
  for update;

  if target_workspace_id is null then
    raise exception 'Solo quien creó este canal puede eliminarlo.';
  end if;

  delete from public.rooms where id = target_room_id;
  return target_workspace_id;
end;
$$;

revoke all on function public.delete_workspace_channel(uuid) from public, anon;
grant execute on function public.delete_workspace_channel(uuid) to authenticated;

drop policy if exists chat_files_delete_channel_creator on storage.objects;
create policy chat_files_delete_channel_creator on storage.objects
  for delete to authenticated using (
    bucket_id = 'chat-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.rooms as room
      where room.id = ((storage.foldername(name))[1])::uuid
        and room.kind in ('channel', 'voice')
        and room.created_by = auth.uid()
        and public.is_workspace_member(room.workspace_id)
    )
  );