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

revoke all on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;