drop policy if exists channels_update_creator on public.rooms;
create policy channels_update_creator on public.rooms
  for update to authenticated
  using (
    kind in ('channel', 'voice')
    and created_by = auth.uid()
    and public.is_workspace_member(workspace_id)
  )
  with check (
    kind in ('channel', 'voice')
    and created_by = auth.uid()
    and public.is_workspace_member(workspace_id)
  );

revoke update on public.rooms from authenticated;
grant update (name, purpose) on public.rooms to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
end;
$$;