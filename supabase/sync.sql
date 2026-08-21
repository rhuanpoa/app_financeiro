-- ============================================================
-- Minhas Finanças — sincronização entre aparelhos
--
-- Rode no Supabase em: SQL Editor → New query → colar → Run.
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Uma linha por registro
--
-- Uma tabela só, genérica, em vez de uma para lançamentos,
-- outra para metas, outra para parcelas. O motivo: o app carrega
-- tudo na memória de uma vez e nunca faz consulta relacional.
-- Com uma tabela genérica, acrescentar um campo no app (ou uma
-- coleção nova) não exige mexer no banco nunca mais.
--
-- `dados` guarda o registro inteiro como veio do aparelho.
-- `apagado` é a lápide: a linha CONTINUA existindo depois de
-- apagada, senão o outro aparelho reenviaria o registro e ele
-- ressuscitaria.
-- ------------------------------------------------------------

create table if not exists public.registros (
  usuario       uuid        not null references auth.users (id) on delete cascade,
  colecao       text        not null,
  id            text        not null,

  dados         jsonb,
  apagado       boolean     not null default false,

  -- Relógio do SERVIDOR. Serve de marcador para "o que mudou
  -- desde a última vez que conversamos". Não confundir com o
  -- atualizado_em que vem dentro de `dados`, que é do aparelho.
  atualizado_em timestamptz not null default now(),

  primary key (usuario, colecao, id)
);

-- Só se busca "o que mudou depois de X", sempre do próprio dono.
create index if not exists registros_por_data
  on public.registros (usuario, atualizado_em);

comment on column public.registros.atualizado_em is
  'Relogio do servidor, usado como marcador de sincronizacao. A data de
   edicao de verdade fica dentro de dados->>atualizado_em, e e a do aparelho.';


-- ------------------------------------------------------------
-- 2. O relógio é sempre o do servidor
--
-- Se o aparelho pudesse mandar esta data, um celular com a hora
-- adiantada gravaria um marcador no futuro — e todos os outros
-- aparelhos deixariam de enxergar as próprias mudanças até o
-- relógio real alcançar aquele valor.
-- ------------------------------------------------------------

create or replace function public.marcar_hora()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists registros_hora on public.registros;

create trigger registros_hora
  before insert or update on public.registros
  for each row execute function public.marcar_hora();


-- ------------------------------------------------------------
-- 3. Row Level Security
--
-- Cada pessoa só enxerga e só escreve as próprias linhas. O
-- `with check` no insert é o que impede alguém de gravar uma
-- linha no nome de outra pessoa.
-- ------------------------------------------------------------

alter table public.registros enable row level security;

drop policy if exists "le os proprios registros"     on public.registros;
drop policy if exists "cria os proprios registros"   on public.registros;
drop policy if exists "edita os proprios registros"  on public.registros;
drop policy if exists "apaga os proprios registros"  on public.registros;

create policy "le os proprios registros"
  on public.registros for select
  to authenticated
  using ( (select auth.uid()) = usuario );

create policy "cria os proprios registros"
  on public.registros for insert
  to authenticated
  with check ( (select auth.uid()) = usuario );

create policy "edita os proprios registros"
  on public.registros for update
  to authenticated
  using      ( (select auth.uid()) = usuario )
  with check ( (select auth.uid()) = usuario );

-- DELETE de verdade fica de fora de propósito: apagar é marcar
-- `apagado`, nunca remover a linha. Uma linha removida some do
-- "o que mudou" e o outro aparelho nunca ficaria sabendo.


-- ------------------------------------------------------------
-- 4. Gravar sem eco
--
-- Sem esta função, reenviar um registro idêntico atualizaria a
-- hora, o que faria o outro aparelho baixá-lo de novo, o que o
-- faria reenviar... um vai-e-vem sem fim entre dois aparelhos
-- que já estão em dia.
--
-- Aqui a hora só muda se o conteúdo mudou de verdade.
-- ------------------------------------------------------------

create or replace function public.guardar_registros(p_linhas jsonb)
returns timestamptz
language plpgsql
security invoker           -- continua valendo o RLS acima
set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
  v_ultima  timestamptz;
begin
  if v_usuario is null then
    raise exception 'sem sessao';
  end if;

  insert into public.registros (usuario, colecao, id, dados, apagado)
  select v_usuario,
         linha->>'colecao',
         linha->>'id',
         linha->'dados',
         coalesce((linha->>'apagado')::boolean, false)
  from jsonb_array_elements(p_linhas) as linha
  on conflict (usuario, colecao, id) do update
     set dados   = excluded.dados,
         apagado = excluded.apagado
   where public.registros.dados   is distinct from excluded.dados
      or public.registros.apagado is distinct from excluded.apagado;

  select max(atualizado_em) into v_ultima
  from public.registros where usuario = v_usuario;

  return v_ultima;
end;
$$;


-- ------------------------------------------------------------
-- 5. Conferência
--
-- rowsecurity tem de vir true. Se vier false, os dados de todo
-- mundo estão abertos para quem tiver a chave pública.
-- ------------------------------------------------------------

select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'registros';
