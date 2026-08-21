-- ============================================================
-- Minhas Finanças — avisar na hora, sem esperar a próxima rodada
--
-- Rode no Supabase em: SQL Editor → New query → colar → Run.
-- Pode rodar mais de uma vez sem estragar nada.
--
-- Sem isto, o outro aparelho só descobre a novidade quando
-- sincroniza. Com isto, o servidor avisa no instante em que a
-- linha muda, e o lançamento aparece sozinho na outra tela.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Colocar a tabela na transmissão
--
-- O Postgres só publica mudanças das tabelas que estão nesta
-- publicação. Ela existe desde a criação do projeto, mas começa
-- vazia — nenhuma tabela é transmitida por padrão.
-- ------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.registros;
exception
  -- Rodar de novo depois de já ter adicionado não é erro.
  when duplicate_object then null;
  when others then
    if sqlerrm like '%already member%' then null; else raise; end if;
end;
$$;


-- ------------------------------------------------------------
-- 2. O aviso respeita o Row Level Security
--
-- Isto é o que impede o aviso de virar vazamento: quem escuta só
-- recebe as linhas que já poderia ler pela política de SELECT.
-- Sem RLS ligado, o servidor transmitiria as mudanças de todo
-- mundo para quem estivesse ouvindo.
--
-- O RLS já foi ligado em sync.sql; aqui só conferimos.
-- ------------------------------------------------------------

do $$
declare
  v_ligado boolean;
begin
  select rowsecurity into v_ligado
  from pg_tables where schemaname = 'public' and tablename = 'registros';

  if v_ligado is not true then
    raise exception 'RLS desligado em public.registros. Rode supabase/sync.sql antes deste arquivo.';
  end if;
end;
$$;


-- ------------------------------------------------------------
-- 3. Conferência
--
-- Tem de aparecer uma linha com "registros". Se vier vazio, o
-- passo 1 não pegou e o aviso instantâneo não vai funcionar --
-- o app continua sincronizando, só que sem tempo real.
-- ------------------------------------------------------------

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'registros';
