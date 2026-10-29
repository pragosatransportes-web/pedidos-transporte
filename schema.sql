-- =====================================================================
-- Pedidos de Transporte CPSA — base de dados (Supabase)
-- Cole este script inteiro em: Supabase › SQL Editor › New query › Run
-- Pode ser executado mais do que uma vez sem perder dados.
-- =====================================================================

-- 1) Administradores da plataforma (por email). Altere/adicione aqui.
create table if not exists public.app_admins(email text primary key);
insert into public.app_admins(email) values ('__ADMIN_EMAIL__') on conflict do nothing;

-- 2) Documentos (cada coleção da plataforma: pedidos, obras, viaturas, ...)
create table if not exists public.docs(
  col text not null,
  id  text not null,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key(col,id)
);
create index if not exists docs_col_idx on public.docs(col);
create index if not exists docs_email_idx on public.docs(col,(lower(data->>'email')));
alter table public.docs replica identity full;

-- 3) Bloqueios curtos (numeração sequencial dos pedidos)
create table if not exists public.locks(
  col text not null, id text not null, holder text not null, until timestamptz not null,
  primary key(col,id));

-- 4) Quem pode entrar: só emails @pragosa.pt, e só os dos administradores, dos utilizadores e dos utilizadores criados (convites) ativos
create or replace function public.email_permitido(e text) returns boolean
language sql stable security definer set search_path=public as $$
  select e is not null and lower(e) like '%@pragosa.pt' and (
    exists(select 1 from app_admins a where lower(a.email)=lower(e))
    or exists(select 1 from docs d where d.col='utilizadores' and lower(d.data->>'email')=lower(e) and coalesce((d.data->>'ativo')::boolean,true))
    or exists(select 1 from docs d where d.col='convites' and lower(d.data->>'email')=lower(e) and coalesce((d.data->>'ativo')::boolean,true))
  ) $$;

create or replace function public.eu_permitido() returns boolean
language sql stable security definer set search_path=public as $$ select public.email_permitido(auth.jwt()->>'email') $$;

create or replace function public.eu_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from app_admins a where lower(a.email)=lower(auth.jwt()->>'email'))
      or exists(select 1 from docs d where d.col='utilizadores' and d.id=auth.uid()::text and d.data->>'perfil'='admin' and coalesce((d.data->>'ativo')::boolean,true)) $$;

-- coleções que só o administrador altera
create or replace function public.col_admin(c text) returns boolean language sql immutable as $$
  select c = any(array['utilizadores','categorias','equipamentos','materiais','zonas','cfg','gestores','convites','eliminados']) $$;

-- 5) Regras de acesso (aplicadas no servidor)
alter table public.docs enable row level security;
alter table public.locks enable row level security;
drop policy if exists docs_ler on public.docs;
drop policy if exists docs_inserir on public.docs;
drop policy if exists docs_alterar on public.docs;
drop policy if exists docs_apagar on public.docs;
create policy docs_ler on public.docs for select to authenticated using (
  public.eu_permitido() and (col not in ('eliminados','acessos') or public.eu_admin() or (col='acessos' and id=auth.uid()::text)));
create policy docs_inserir on public.docs for insert to authenticated with check (
  public.eu_permitido() and (not public.col_admin(col) or public.eu_admin()) and (col<>'acessos' or id=auth.uid()::text or public.eu_admin()));
create policy docs_alterar on public.docs for update to authenticated using (
  public.eu_permitido() and (not public.col_admin(col) or public.eu_admin()) and (col<>'acessos' or id=auth.uid()::text or public.eu_admin()))
  with check (public.eu_permitido() and (not public.col_admin(col) or public.eu_admin()));
create policy docs_apagar on public.docs for delete to authenticated using (
  public.eu_permitido() and (not public.col_admin(col) or public.eu_admin()));
drop policy if exists locks_tudo on public.locks;
create policy locks_tudo on public.locks for all to authenticated using (public.eu_permitido()) with check (public.eu_permitido());

-- 6) Escrita atómica: juntar campos (update) e bloqueio
create or replace function public.doc_merge(p_col text,p_id text,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare r jsonb; k text;
begin
  update docs set data = data || p_patch, version=version+1, updated_at=now(), updated_by=auth.uid()
   where col=p_col and id=p_id returning data into r;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  -- campos marcados para apagar
  for k in select key from jsonb_each(p_patch) where value = '{"__delete__":true}'::jsonb loop
    update docs set data = data - k where col=p_col and id=p_id returning data into r;
  end loop;
  return r;
end $$;

create or replace function public.lock_try(p_col text,p_id text,p_holder text,p_ms int) returns boolean
language plpgsql security invoker set search_path=public as $$
begin
  delete from locks where col=p_col and id=p_id and until < now();
  insert into locks(col,id,holder,until) values(p_col,p_id,p_holder,now()+make_interval(secs=>p_ms/1000.0))
    on conflict(col,id) do nothing;
  return exists(select 1 from locks where col=p_col and id=p_id and holder=p_holder);
end $$;

-- 7) Só se regista (cria palavra-passe) quem tem o email em Utilizadores
create or replace function public.bloquear_registo() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not public.email_permitido(new.email) then
    raise exception 'Email sem acesso à plataforma. Peça ao administrador para o criar em Utilizadores.';
  end if;
  return new;
end $$;
drop trigger if exists antes_registo on auth.users;
create trigger antes_registo before insert on auth.users for each row execute function public.bloquear_registo();

-- 8) Tempo real
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
grant select,insert,update,delete on public.docs, public.locks to authenticated;
grant execute on function public.doc_merge(text,text,jsonb), public.lock_try(text,text,text,int), public.eu_permitido(), public.eu_admin() to authenticated;
