// ============================================================
// Edge Function "chat" — a ponte entre o app e a OpenAI.
//
// Ela existe por um motivo só: a chave da OpenAI não pode ficar
// no app. O repositório é público e o app roda no navegador —
// qualquer pessoa abriria o código e gastaria na sua conta.
//
// O que esta função NÃO faz: ver os lançamentos de ninguém.
// O app manda a pergunta, a OpenAI devolve uma consulta, o app
// executa essa consulta no próprio celular e manda de volta só
// o resultado somado. O extrato nunca passa por aqui.
//
// Publicar:  supabase functions deploy chat
// Chave:     supabase secrets set OPENAI_API_KEY=sk-...
// ============================================================

import OpenAI from 'npm:openai@^7.5.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

// gpt-5.4 dá conta de somar e comparar números com folga e custa
// menos que o 5.6. Trocável sem publicar o app de novo:
//   supabase secrets set OPENAI_MODELO=gpt-5.6
const MODELO = Deno.env.get('OPENAI_MODELO') || 'gpt-5.4';

// Tetos. Existem para uma pergunta esquisita não virar uma conta
// alta: sem eles, um cliente (ou um script) manda 10 MB de texto.
const MAX_ITENS       = 40;      // itens na conversa
const MAX_CARACTERES  = 24000;   // tamanho do corpo inteiro
const MAX_SAIDA       = 700;     // tokens de resposta
const MAX_POR_DIA     = 60;      // perguntas por pessoa por dia

// As ferramentas moram AQUI, e nao no app, por dois motivos: o servidor
// e a fonte unica da verdade, e assim o cliente nao descreve as proprias
// ferramentas para o modelo. Quem executa cada uma e o aparelho -- veja
// Fin.chat.executarFerramenta em js/chat.js. Os nomes tem de bater.
const FERRAMENTAS = [
  {
    type: 'function',
    name: 'consultar_lancamentos',
    description: 'Soma os lancamentos do usuario com filtros. Use para perguntas ' +
                 'sobre quanto foi gasto ou recebido, em que categoria, com quem.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['saida', 'entrada', 'ambos'],
                description: 'saida = dinheiro que saiu; entrada = dinheiro que entrou' },
        de:   { type: 'string', description: 'Primeiro dia do periodo, AAAA-MM-DD' },
        ate:  { type: 'string', description: 'Ultimo dia do periodo, AAAA-MM-DD' },
        categoria: { type: 'string', description: 'Nome exato da categoria, se a pergunta citar uma' },
        texto: { type: 'string', description: 'Pedaco da descricao, como "ifood" ou "posto"' }
      },
      required: ['tipo', 'de', 'ate'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'resumo_periodo',
    description: 'Entradas, saidas, sobra e gastos fixos de um periodo. Use para ' +
                 'perguntas amplas, como "como foi meu mes" ou "quanto sobra por mes".',
    parameters: {
      type: 'object',
      properties: {
        de:  { type: 'string', description: 'Primeiro dia do periodo, AAAA-MM-DD' },
        ate: { type: 'string', description: 'Ultimo dia do periodo, AAAA-MM-DD' }
      },
      required: ['de', 'ate'],
      additionalProperties: false
    }
  }
];

// Esta lista tem de conter TODO cabeçalho que o supabase-js envia. Se
// faltar um, o navegador reprova a checagem prévia e o app recebe um
// "Failed to fetch" sem explicação — enquanto o curl, que não faz essa
// checagem, funciona normalmente e dá a impressão de que está tudo bem.
// Faltava 'apikey' aqui, e era exatamente isso que derrubava o chat.
const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ORIGEM_PERMITIDA') || '*',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

// As instruções ficam AQUI, no servidor. Se viessem do app, qualquer
// pessoa poderia reescrevê-las e usar sua chave para outra coisa.
function instrucoes(hoje: string) {
  return [
    'Você é o assistente de um app de finanças pessoais brasileiro.',
    'Responda em português do Brasil, em no máximo três frases, direto ao ponto.',
    '',
    'Você NÃO tem os lançamentos. Para saber qualquer valor, chame uma das',
    'funções disponíveis. Nunca invente números: se a função devolver zero',
    'lançamentos, diga que não encontrou nada naquele período.',
    '',
    'As funções devolvem categoria, valor e data — nunca a descrição do',
    'lançamento, de propósito. Então diga "R$ 1.200,00 em Moradia", e não',
    'invente o nome de um estabelecimento que você não recebeu.',
    '',
    'Valores vêm em reais. Escreva no formato R$ 1.234,56.',
    'Hoje é ' + hoje + '. Use esta data para resolver "esse mês",',
    '"mês passado", "esse ano" e afins.',
    '',
    'Se a pergunta não for sobre as finanças do usuário, diga com educação',
    'que você só ajuda com as contas dele.'
  ].join('\n');
}

// Só estes formatos entram. Sem esta peneira, o app poderia mandar
// um item de sistema e reescrever as instruções acima.
const TIPOS_ACEITOS = ['message', 'function_call', 'function_call_output'];

function peneirar(input: unknown) {
  if (!Array.isArray(input)) return null;
  if (input.length === 0 || input.length > MAX_ITENS) return null;

  const limpos = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') return null;
    const tipo = (item as any).type;

    if (tipo === 'message') {
      const papel = (item as any).role;
      // 'system' e 'developer' de fora: quem dá as instruções é esta função.
      if (papel !== 'user' && papel !== 'assistant') return null;
      limpos.push(item);
      continue;
    }

    if (TIPOS_ACEITOS.includes(tipo)) {
      limpos.push(item);
      continue;
    }
    return null;
  }
  return limpos;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405);

  const chave = Deno.env.get('OPENAI_API_KEY');
  if (!chave) {
    return json({ erro: 'O chat ainda não foi configurado pelo administrador.' }, 500);
  }

  // ---- quem está pedindo ----
  // A função roda com verify_jwt ligado, então chegar aqui já significa
  // que a pessoa está logada. Lemos o id para contar o uso dela.
  const autorizacao = req.headers.get('Authorization') || '';
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: quem } = await admin.auth.getUser(autorizacao.replace('Bearer ', ''));
  const usuario = quem?.user;
  if (!usuario) return json({ erro: 'Entre na sua conta para usar o chat.' }, 401);

  // ---- corpo ----
  const bruto = await req.text();
  if (bruto.length > MAX_CARACTERES) {
    return json({ erro: 'Pergunta longa demais.' }, 413);
  }

  let corpo: any;
  try { corpo = JSON.parse(bruto); }
  catch { return json({ erro: 'Pedido malformado.' }, 400); }

  const input = peneirar(corpo?.input);
  if (!input) return json({ erro: 'Pedido malformado.' }, 400);

  const hoje = /^\d{4}-\d{2}-\d{2}$/.test(corpo?.hoje || '')
    ? corpo.hoje
    : new Date().toISOString().slice(0, 10);

  // ---- teto diário ----
  // Conta só o começo de conversa (quando o app ainda não mandou
  // resultado de função), senão a ida e volta da mesma pergunta
  // contaria duas vezes.
  const primeiraVolta = !input.some((i: any) => i.type === 'function_call_output');

  if (primeiraVolta) {
    const { data: usou, error: erroUso } = await admin.rpc('registrar_uso_chat', {
      p_usuario: usuario.id,
      p_teto: MAX_POR_DIA
    });
    if (erroUso) {
      console.error('contador de uso falhou:', erroUso.message);
      // Não barra o cliente por causa de um problema nosso.
    } else if (usou === false) {
      return json({ erro: 'Você atingiu o limite de perguntas de hoje. Tente amanhã.' }, 429);
    }
  }

  // ---- OpenAI ----
  try {
    const openai = new OpenAI({ apiKey: chave });

    const resposta = await openai.responses.create({
      model: MODELO,
      instructions: instrucoes(hoje),
      input,
      tools: FERRAMENTAS,
      max_output_tokens: MAX_SAIDA
    });

    // As chamadas de função voltam para o app executar: os dados
    // estão lá, não aqui.
    const chamadas = (resposta.output ?? [])
      .filter((item: any) => item.type === 'function_call')
      .map((item: any) => ({
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments
      }));

    return json({
      texto: resposta.output_text ?? '',
      chamadas,
      // devolvido para o app anexar à conversa antes da próxima volta
      itens: resposta.output ?? []
    });

  } catch (e) {
    console.error('OpenAI:', e instanceof Error ? e.message : e);
    return json({ erro: 'Não consegui responder agora. Tente de novo em instantes.' }, 502);
  }
});
