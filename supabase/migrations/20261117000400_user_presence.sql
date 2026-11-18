alter table public.profiles
  add column if not exists presence_status text not null default 'online'
    check (presence_status in ('online', 'away', 'busy', 'offline')),
  add column if not exists last_seen_at timestamptz not null default now();

alter table public.profiles replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;