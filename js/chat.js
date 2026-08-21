/* =========================================================
   chat.js — o chat de perguntas sobre as finanças.

   Divisão de trabalho, e ela é de propósito:

   - A IA NÃO recebe os lançamentos. Ela recebe a pergunta e
     devolve uma consulta ("saídas, agosto, texto ifood").
   - Quem executa a consulta é este arquivo, aqui no aparelho.
   - Só o resultado agregado ("R$ 284,90 em 7 lançamentos")
     volta para a IA, para ela escrever a resposta — categoria,
     valor e data, NUNCA a descrição do lançamento. O nome do
     estabelecimento e o de quem te pagou não saem daqui.

   Isso deixa a conta barata (o texto enviado é minúsculo) e
   mantém o extrato do cliente dentro do celular dele.
   ========================================================= */

window.Fin = window.Fin || {};

(function (Fin) {
  'use strict';

  Fin.chat = {};

  /* ---------- comparação de texto ----------
     "Alimentação", "alimentacao" e "ALIMENTAÇÃO" têm de casar. */

  function normal(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^\x00-\x7f]/g, '')   // depois do NFD, cada acento virou um caractere separado
      .replace(/\s+/g, ' ')
      .trim();
  }
  Fin.chat.normal = normal;

  /* ---------- datas ----------
     Tudo é 'AAAA-MM-DD', então comparar como texto já ordena. */

  var MIN = '0000-01-01';
  var MAX = '9999-12-31';

  function limparData(v, padrao) {
    var s = String(v || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : padrao;
  }

  // Primeiro e último dia do mês de uma data ISO.
  Fin.chat.mesDe = function (iso) {
    var a = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
    var ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    var mm = ('0' + m).slice(-2);
    return { de: a + '-' + mm + '-01', ate: a + '-' + mm + '-' + ultimo };
  };

  /* ---------- consulta ----------

     filtro = {
       tipo:      'saida' | 'entrada' | 'ambos'
       de, ate:   'AAAA-MM-DD'
       categoria: nome exato de categoria, ou vazio
       texto:     pedaço da descrição, ou vazio
     }

     O `texto` procura na descrição E no nome da categoria: quem
     pergunta "quanto gastei com mercado" pode estar falando da
     categoria Mercado ou de um lançamento escrito "mercado".   */

  var LIMITE_ITENS = 6;

  Fin.chat.consultar = function (dados, filtro) {
    var f = filtro || {};
    var tipo = f.tipo === 'saida' ? 'out' : f.tipo === 'entrada' ? 'in' : null;
    var de   = limparData(f.de, MIN);
    var ate  = limparData(f.ate, MAX);
    var cat  = f.categoria ? normal(f.categoria) : '';
    var txt  = f.texto ? normal(f.texto) : '';

    var achados = (dados.tx || []).filter(function (t) {
      if (tipo && t.type !== tipo) return false;

      var d = limparData(t.date, '');
      if (!d || d < de || d > ate) return false;

      if (cat && normal(t.category) !== cat) return false;

      if (txt) {
        var alvo = normal(t.note) + ' ' + normal(t.category);
        if (alvo.indexOf(txt) === -1) return false;
      }
      return true;
    });

    var total = 0;
    var porCat = {};

    achados.forEach(function (t) {
      var v = Number(t.amount) || 0;
      total += v;
      var c = t.category || 'Outros';
      if (!porCat[c]) porCat[c] = { categoria: c, total: 0, quantidade: 0 };
      porCat[c].total += v;
      porCat[c].quantidade++;
    });

    // Do maior para o menor: é o que a pergunta quase sempre quer.
    var lista = Object.keys(porCat).map(function (k) { return porCat[k]; })
                  .sort(function (a, b) { return b.total - a.total; });

    var itens = achados.slice()
      .sort(function (a, b) { return (Number(b.amount) || 0) - (Number(a.amount) || 0); })
      .slice(0, LIMITE_ITENS)
      .map(function (t) {
        // Repare no que NAO esta aqui: a descricao. "IFOOD *IFD BRASIL",
        // o nome de quem te pagou, o estabelecimento -- nada disso sai do
        // aparelho. Categoria, valor e data respondem "qual foi meu maior
        // gasto" quase tao bem, e sao dados que a propria pessoa escolheu.
        return {
          data: dataBR(t.date),
          valor: Number(t.amount) || 0,
          categoria: t.category || 'Outros'
        };
      });

    return {
      total: arred(total),
      quantidade: achados.length,
      porCategoria: lista.map(function (c) {
        return { categoria: c.categoria, total: arred(c.total), quantidade: c.quantidade };
      }),
      // Os maiores, não todos: o resto só encareceria a pergunta.
      maiores: itens,
      itensOmitidos: Math.max(0, achados.length - itens.length)
    };
  };

  /* ---------- resumo de um período ---------- */

  Fin.chat.resumo = function (dados, de, ate) {
    var entrada = Fin.chat.consultar(dados, { tipo: 'entrada', de: de, ate: ate });
    var saida   = Fin.chat.consultar(dados, { tipo: 'saida',   de: de, ate: ate });

    return {
      de: limparData(de, MIN),
      ate: limparData(ate, MAX),
      entradas: entrada.total,
      saidas: saida.total,
      sobra: arred(entrada.total - saida.total),
      saidasPorCategoria: saida.porCategoria,
      entradasPorCategoria: entrada.porCategoria,
      // O que se repete todo mês: dá a base do "quanto sobra por mês".
      fixosMensais: (Fin.fixosMensais ? Fin.fixosMensais(dados.tx || []) : [])
        .map(function (f) {
          return {
            tipo: f.type === 'in' ? 'entrada' : 'saida',
            categoria: f.category || 'Outros',
            valor: Number(f.amount) || 0
          };
        })
    };
  };

  // 'AAAA-MM-DD' vira 'DD/MM/AAAA'. A IA repete na resposta o que recebe,
  // entao mandar a data crua faz sair "no dia 2026-08-05" para quem le em
  // portugues. O filtro da consulta continua em AAAA-MM-DD; isto e so o
  // que a IA le de volta.
  function dataBR(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || '');
  }

  // Centavos, sem lixo de ponto flutuante (0.1 + 0.2 = 0.30000000000000004).
  function arred(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /* ---------- ponte com a IA ----------

     A IA pede uma das duas funções abaixo. Este despachante é o
     ÚNICO caminho: nome fora da lista não executa nada. Assim uma
     resposta estranha da IA não vira acesso a dado que não devia. */

  Fin.chat.executarFerramenta = function (dados, nome, argumentos) {
    var a = argumentos || {};

    if (nome === 'consultar_lancamentos') {
      return Fin.chat.consultar(dados, {
        tipo: a.tipo, de: a.de, ate: a.ate,
        categoria: a.categoria, texto: a.texto
      });
    }

    if (nome === 'resumo_periodo') {
      return Fin.chat.resumo(dados, a.de, a.ate);
    }

    return { erro: 'Consulta desconhecida: ' + nome };
  };

  /* As descricoes das ferramentas NAO ficam aqui: elas moram na Edge
     Function, em supabase/functions/chat/index.ts, para o servidor ser a
     fonte unica. Deste lado fica so quem executa, e o despachante acima
     so aceita os nomes que conhece.                                     */


  /* ---------- conversa com a Edge Function ----------

     A ida e volta e assim:

       1. app  -> funcao : a pergunta
       2. funcao -> IA   : a pergunta + a descricao das ferramentas
       3. IA -> funcao   : "chame consultar_lancamentos(saida, agosto, ifood)"
       4. funcao -> app  : repassa esse pedido
       5. app            : executa AQUI, nos dados do proprio aparelho
       6. app -> funcao  : "o resultado foi 285,00 em 3 lancamentos"
       7. funcao -> IA   : o resultado
       8. IA -> app      : a frase final

     Repare no passo 5: os lancamentos nunca saem do celular. O que
     viaja e a soma, nao o extrato.                                  */

  // Mais que isso e sinal de que o modelo entrou em loop de consultas.
  var MAX_VOLTAS = 3;
  var LIMITE_MS = 30000;

  function comLimite(promessa) {
    return new Promise(function (resolve, reject) {
      var caiu = false;
      var t = setTimeout(function () {
        caiu = true;
        reject(new Error('A resposta demorou demais. Tente de novo.'));
      }, LIMITE_MS);
      promessa.then(function (r) { if (!caiu) { clearTimeout(t); resolve(r); } },
                    function (e) { if (!caiu) { clearTimeout(t); reject(e); } });
    });
  }

  // O supabase-js nao entrega o corpo da resposta quando o status nao e 2xx:
  // ele vira um erro com o corpo escondido em .context. Sem desembrulhar,
  // "voce atingiu o limite de hoje" chegaria como "Edge Function returned a
  // non-2xx status code", que nao ajuda ninguem.
  function erroDaFuncao(erro) {
    var ctx = erro && erro.context;
    var generico = new Error('Nao consegui responder agora. Tente de novo em instantes.');

    if (!ctx || typeof ctx.json !== 'function') return Promise.reject(generico);

    return ctx.json().then(
      function (corpo) {
        return Promise.reject(new Error((corpo && corpo.erro) || generico.message));
      },
      function () { return Promise.reject(generico); }
    );
  }

  Fin.chat.perguntar = function (dados, itens) {
    var cliente = Fin.auth && Fin.auth.cliente && Fin.auth.cliente();
    if (!cliente) {
      return Promise.reject(new Error('Entre na sua conta para usar o chat.'));
    }

    function volta(input, restantes) {
      return comLimite(cliente.functions.invoke('chat', {
        body: { input: input, hoje: Fin.hojeISO() }
      })).then(function (r) {
        if (r.error) return erroDaFuncao(r.error);

        var d = r.data || {};
        if (d.erro) throw new Error(d.erro);

        // O que a IA produziu entra na conversa, senao a proxima volta
        // nao saberia que ela ja tinha pedido a consulta.
        var novo = input.concat(d.itens || []);
        var chamadas = d.chamadas || [];

        if (chamadas.length && restantes > 0) {
          chamadas.forEach(function (c) {
            var args = {};
            try { args = JSON.parse(c.arguments || '{}'); }
            catch (e) { args = {}; }

            var resultado = Fin.chat.executarFerramenta(dados, c.name, args);

            novo.push({
              type: 'function_call_output',
              call_id: c.call_id,
              output: JSON.stringify(resultado)
            });
          });
          return volta(novo, restantes - 1);
        }

        return {
          texto: d.texto || 'Nao consegui montar uma resposta para isso.',
          input: novo
        };
      });
    }

    return volta(itens, MAX_VOLTAS);
  };

  // Um item de pergunta no formato que o Responses API espera.
  Fin.chat.itemPergunta = function (texto) {
    return {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: String(texto || '').slice(0, 500) }]
    };
  };

})(window.Fin);
