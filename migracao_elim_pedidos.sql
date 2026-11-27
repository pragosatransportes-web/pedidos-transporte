-- Pedidos de Transporte CPSA — permitir a utilizadores autorizados eliminar pedidos
-- Correr no Supabase (projeto oqwpdjrewedfpaptcubl) › SQL Editor › New query › Run. Pode correr mais do que uma vez.
create or replace function public.eu_elim_ped() returns boolean
language sql stable security definer set search_path=public as $$
  select public.eu_admin() or exists(select 1 from docs d where d.col='utilizadores' and d.id=auth.uid()::text
    and coalesce((d.data->>'elimPed')::boolean,false) and coalesce((d.data->>'ativo')::boolean,true)) $$;
grant execute on function public.eu_elim_ped() to authenticated;

drop policy if exists docs_inserir on public.docs;
create policy docs_inserir on public.docs for insert to authenticated with check (
  public.eu_permitido() and (not public.col_admin(col) or public.eu_admin() or (col='eliminados' and data->>'col'='pedidos' and public.eu_elim_ped())) and (col<>'acessos' or id=auth.uid()::text or public.eu_admin()));

drop policy if exists docs_apagar on public.docs;
create policy docs_apagar on public.docs for delete to authenticated using (
  public.eu_permitido() and (not public.col_admin(col) or public.eu_admin()) and (col<>'pedidos' or public.eu_elim_ped()));
