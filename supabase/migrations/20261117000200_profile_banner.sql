alter table public.profiles
  add column if not exists banner_path text;

alter table public.workspaces alter column created_by drop not null;
alter table public.workspaces drop constraint if exists workspaces_created_by_fkey;
alter table public.workspaces
  add constraint workspaces_created_by_fkey foreign key (created_by)
  references public.profiles (id) on delete set null;

alter table public.rooms alter column created_by drop not null;
alter table public.rooms drop constraint if exists rooms_created_by_fkey;
alter table public.rooms
  add constraint rooms_created_by_fkey foreign key (created_by)
  references public.profiles (id) on delete set null;

alter table public.room_messages alter column author_id drop not null;
alter table public.room_messages drop constraint if exists room_messages_author_id_fkey;
alter table public.room_messages
  add constraint room_messages_author_id_fkey foreign key (author_id)
  references public.profiles (id) on delete set null;