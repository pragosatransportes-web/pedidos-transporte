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

-- 6b) Primeiro acesso: ativa o convite do email da sessão. Quem chama só pode ativar o seu próprio convite.
create or replace function public.ativar_convite() returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  e text := lower(auth.jwt()->>'email');
  u text := auth.uid()::text;
  c record; g text; pf text; atual jsonb; agora text; acao text;
begin
  if e is null or u is null then return null; end if;
  select d.id, d.data into c from docs d
   where d.col='convites' and lower(d.data->>'email')=e and coalesce((d.data->>'ativo')::boolean,true) and coalesce(d.data->>'usadoPor','')=''
   order by d.updated_at limit 1 for update;
  if not found then return null; end if;
  pf := c.data->>'perfil';
  agora := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  acao := 'Primeiro acesso com o utilizador criado (' || case pf when 'admin' then 'Administrador' when 'logistica' then 'Gestor de logística' when 'consulta' then 'Consulta e análise' else pf end || ')';
  select d.data into atual from docs d where d.col='utilizadores' and d.id=u for update;
  if atual is null then
    insert into docs(col,id,data,updated_by) values('utilizadores',u,jsonb_build_object(
      'perfil',pf,'alcunha',c.data->>'nome','email',c.data->>'email','ativo',true,'criadoEm',agora,
      'criadoPor',coalesce(c.data->>'criadoPor',u),'historico',jsonb_build_array(jsonb_build_object('em',agora,'por',u,'acao',acao))),auth.uid());
  elsif pf='admin' then
    -- quem já está registado só muda de perfil por um convite de administrador; os outros convites nunca lhe baixam o perfil
    update docs set data = data || jsonb_build_object('perfil','admin','ativo',true,'email',c.data->>'email',
      'historico',coalesce(data->'historico','[]'::jsonb) || jsonb_build_array(jsonb_build_object('em',agora,'por',u,'acao',acao))),
      version=version+1, updated_at=now(), updated_by=auth.uid() where col='utilizadores' and id=u;
  end if;
  update docs set data = data || jsonb_build_object('usadoPor',u,'usadoEm',agora), version=version+1, updated_at=now(), updated_by=auth.uid()
   where col='convites' and id=c.id;
  update docs set data = data || jsonb_build_object('estado','aprovado'), version=version+1, updated_at=now(), updated_by=auth.uid()
   where col='acessos' and id=u;
  -- ligar a ficha de gestor responsável e os pedidos que lhe estavam atribuídos
  select d.id into g from docs d where d.col='gestores' and coalesce(d.data->>'utilizadorId','')=''
     and (d.data->>'conviteId'=c.id or lower(d.data->>'email')=e or lower(trim(d.data->>'nome'))=lower(trim(c.data->>'nome')))
   order by (d.data->>'conviteId'=c.id) desc nulls last limit 1;
  if g is not null then
    update docs set data = data || jsonb_build_object('utilizadorId',u), version=version+1, updated_at=now(), updated_by=auth.uid() where col='gestores' and id=g;
    update docs set data = data || jsonb_build_object('logisticaId',u), version=version+1, updated_at=now(), updated_by=auth.uid() where col='pedidos' and data->>'logisticaId'='g:'||g;
  end if;
  return jsonb_build_object('perfil',pf);
end $$;
revoke all on function public.ativar_convite() from public, anon;
grant execute on function public.ativar_convite() to authenticated;

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
