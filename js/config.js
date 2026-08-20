/* =========================================================
   config.js — endereço do projeto no Supabase.

   Estes dois valores são PÚBLICOS por natureza: a chave anon
   sozinha não dá acesso a nada. Quem protege os dados é o
   Row Level Security, que roda dentro do banco.

   A chave `service_role` NUNCA entra aqui nem em nenhum
   arquivo do app — ela ignora todas as políticas.

   Onde achar: Supabase → Project Settings → API
   ========================================================= */

window.Fin = window.Fin || {};

window.Fin.CONFIG = {
  SUPABASE_URL: 'https://crokcwqjpandvhhlbnya.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_1azx8eJaPK2zoYKueLXXeA_9fKbfc3Q'
};
