-- ============================================================
-- Minhas Finanças — teto de uso do chat
--
-- Rode no Supabase em: SQL Editor → New query → colar → Run.
-- Pode rodar mais de uma vez sem estragar nada.
--
-- Por que isto existe: cada pergunta no chat custa dinheiro na
-- sua conta da OpenAI. Sem um teto, um cliente insatisfeito (ou
-- um script) faz mil perguntas numa madrugada e a conta é sua.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Uma linha por pessoa por dia
-- ------------------------------------------------------------

create table if not exists public.uso_chat (
  usuario  uuid    not null references auth.users (id) on delete cascade,
  dia      date    not null default current_date,
  perguntas integer not null default 0,

  primary key (usuario, dia)
);

comment on table public.uso_chat is
  'Contador diario de perguntas no chat. Alimentado so pela Edge Function.';


-- ------------------------------------------------------------
-- 2. Row Level Security
--
-- A tabela é escrita apenas pela Edge Function, que usa a chave
-- service_role e por isso ignora estas políticas. Para o app,
-- vale só a leitura do próprio consumo — útil para mostrar
-- "restam N perguntas hoje" mais adiante.
-- ------------------------------------------------------------

alter table public.uso_chat enable row level security;

drop policy if exists "ve o proprio uso" on public.uso_chat;

create policy "ve o proprio uso"
  on public.uso_chat for select
  to authenticated
  using ( (select auth.uid()) = usuario );

-- Sem política de INSERT nem UPDATE: ninguém zera o próprio contador.


-- ------------------------------------------------------------
-- 3. Contar e decidir, em uma operação só
--
-- Ler e depois gravar em dois passos abriria uma janela para
-- duas perguntas simultâneas passarem juntas pelo teto. O
-- INSERT ... ON CONFLICT resolve tudo numa instrução atômica.
--
-- Devolve TRUE se a pergunta está liberada, FALSE se estourou.
-- ------------------------------------------------------------

create or replace function public.registrar_uso_chat(p_usuario uuid, p_teto integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  insert into public.uso_chat (usuario, dia, perguntas)
  values (p_usuario, current_date, 1)
  on conflict (usuario, dia)
    do update set perguntas = public.uso_chat.perguntas + 1
  returning perguntas into v_total;

  return v_total <= p_teto;
end;
$$;

-- Só a Edge Function chama isto. Tirar do alcance do app evita
-- que alguém gaste o próprio limite de propósito para atrapalhar.
revoke execute on function public.registrar_uso_chat(uuid, integer) from anon, authenticated;


-- ------------------------------------------------------------
-- 4. Faxina
--
-- O contador de ontem não serve para nada. Sem limpeza a tabela
-- cresce para sempre. Rode de vez em quando, ou agende em
-- Database → Cron se quiser automático.
-- ------------------------------------------------------------

-- delete from public.uso_chat where dia < current_date - 7;


-- ------------------------------------------------------------
-- 5. Conferência
-- ------------------------------------------------------------

select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'uso_chat';
