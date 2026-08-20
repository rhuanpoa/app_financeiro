-- ============================================================
-- Minhas Finanças — estrutura de contas
--
-- Rode no Supabase em: SQL Editor → New query → colar → Run.
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Perfil de quem se cadastra
--
-- O e-mail e a senha ficam com o Supabase, em auth.users.
-- Aqui ficam só nome e CPF, ligados pelo mesmo id.
-- ------------------------------------------------------------

create table if not exists public.perfis (
  id            uuid primary key references auth.users (id) on delete cascade,
  nome_completo text        not null check (length(trim(nome_completo)) >= 3),

  -- guardado só com dígitos, para "529.982.247-25" e "52998224725"
  -- nunca virarem duas contas diferentes
  cpf           text        not null unique check (cpf ~ '^[0-9]{11}$'),

  criado_em     timestamptz not null default now()
);

comment on column public.perfis.cpf is
  'Somente dígitos. A restrição UNIQUE é o que impede a mesma pessoa de abrir duas contas.';


-- ------------------------------------------------------------
-- 2. Row Level Security
--
-- SEM ISTO, qualquer pessoa com a chave pública lê a tabela
-- inteira. RLS vem DESLIGADO em tabela nova — ligar é o passo
-- que não pode ser esquecido.
-- ------------------------------------------------------------

alter table public.perfis enable row level security;

drop policy if exists "ve o proprio perfil"    on public.perfis;
drop policy if exists "edita o proprio perfil" on public.perfis;

create policy "ve o proprio perfil"
  on public.perfis for select
  to authenticated
  using ( (select auth.uid()) = id );

create policy "edita o proprio perfil"
  on public.perfis for update
  to authenticated
  using      ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- De propósito NÃO existe política de INSERT: ninguém cria perfil
-- pela API. Quem cria é o gatilho abaixo, no momento do cadastro.
-- Assim não dá para forjar um perfil com o CPF de outra pessoa.


-- ------------------------------------------------------------
-- 3. Gatilho: cria o perfil junto com a conta
--
-- Roda dentro da mesma transação do cadastro. Se o CPF já
-- existir, o cadastro inteiro é desfeito — não sobra usuário
-- órfão sem perfil.
-- ------------------------------------------------------------

create or replace function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_cpf  text;
begin
  v_nome := trim(coalesce(new.raw_user_meta_data ->> 'nome_completo', ''));
  v_cpf  := regexp_replace(coalesce(new.raw_user_meta_data ->> 'cpf', ''), '[^0-9]', '', 'g');

  if length(v_nome) < 3 then
    raise exception 'nome_invalido';
  end if;

  if v_cpf !~ '^[0-9]{11}$' then
    raise exception 'cpf_invalido';
  end if;

  insert into public.perfis (id, nome_completo, cpf)
  values (new.id, v_nome, v_cpf);

  return new;

exception
  -- Mensagem reconhecível: o app traduz para "Este CPF já tem conta".
  -- Sem isto, chegaria só um "Database error" genérico.
  when unique_violation then
    raise exception 'cpf_ja_cadastrado';
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();


-- ------------------------------------------------------------
-- 4. Conferência
--
-- Depois de rodar, o resultado abaixo deve mostrar rowsecurity = true.
-- Se vier false, os dados estão expostos e algo acima não rodou.
-- ------------------------------------------------------------

select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'perfis';
