/* =========================================================
   importar.js — leitura de extrato bancário.

   Formatos: OFX (1.x SGML e 2.x XML) e CSV.
   Tudo acontece no próprio aparelho: o arquivo nunca é enviado
   para lugar nenhum.
   ========================================================= */

window.Fin = window.Fin || {};

(function (Fin) {
  'use strict';

  /* ---------------------------------------------------------
     Texto do arquivo
     --------------------------------------------------------- */

  // Bancos brasileiros exportam OFX ora em UTF-8, ora em Windows-1252.
  // Decodifica como UTF-8 e, se aparecer caractere inválido, refaz em 1252.
  Fin.decodificar = function (buffer) {
    var texto = new TextDecoder('utf-8').decode(buffer);
    if (texto.indexOf('�') !== -1) {
      try { texto = new TextDecoder('windows-1252').decode(buffer); } catch (e) {}
    }
    return texto;
  };

  /* ---------------------------------------------------------
     Auxiliares de valor e data
     --------------------------------------------------------- */

  // "1.234,56", "1234.56", "-1.234,56", "R$ 89,90", "(50,00)"
  function valor(bruto) {
    if (bruto == null) return NaN;
    var s = String(bruto).trim();
    if (!s) return NaN;

    var negativo = /^\(.*\)$/.test(s) || s.indexOf('-') !== -1;
    s = s.replace(/[()]/g, '').replace(/[^\d.,-]/g, '').replace(/-/g, '');

    var temVirgula = s.indexOf(',') !== -1;
    var temPonto = s.indexOf('.') !== -1;

    if (temVirgula && temPonto) {
      // O último separador que aparece é o decimal.
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else if (temVirgula) {
      s = s.replace(',', '.');
    } else if (temPonto) {
      // "1.234" com 3 casas depois do ponto é separador de milhar, não decimal.
      if (/\.\d{3}$/.test(s) && s.replace(/\./g, '').length > 3) s = s.replace(/\./g, '');
    }

    var n = parseFloat(s);
    if (isNaN(n)) return NaN;
    return negativo ? -Math.abs(n) : n;
  }

  function doisDigitos(n) { return String(n).padStart(2, '0'); }

  // Devolve sempre AAAA-MM-DD, ou '' se não reconhecer.
  function data(bruto) {
    if (!bruto) return '';
    var s = String(bruto).trim();

    // OFX: 20260805, 20260805120000, 20260805120000[-3:BRT]
    var ofx = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (ofx) return ofx[1] + '-' + ofx[2] + '-' + ofx[3];

    // 2026-08-05
    var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return iso[1] + '-' + doisDigitos(iso[2]) + '-' + doisDigitos(iso[3]);

    // 05/08/2026 ou 05-08-2026 ou 05.08.26
    var br = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (br) {
      var ano = br[3].length === 2 ? '20' + br[3] : br[3];
      return ano + '-' + doisDigitos(br[2]) + '-' + doisDigitos(br[1]);
    }

    return '';
  }

  function limpar(texto) {
    return String(texto || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(n); })
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------------------------------------------------------
     OFX
     --------------------------------------------------------- */

  // Pega o valor de uma tag. Funciona no OFX 1.x (<TAG>valor, sem
  // fechamento) e no 2.x (<TAG>valor</TAG>), porque em ambos o valor
  // termina no próximo "<" ou na quebra de linha.
  function tag(bloco, nome) {
    var m = bloco.match(new RegExp('<' + nome + '>([^<\\r\\n]*)', 'i'));
    return m ? limpar(m[1]) : '';
  }

  Fin.lerOFX = function (texto) {
    var itens = [];

    // Identificação da conta, para rotular de onde veio o lançamento.
    var banco = tag(texto, 'ORG') || tag(texto, 'BANKID') || '';
    var conta = tag(texto, 'ACCTID') || '';
    var cartao = /<CCSTMTRS|<CCACCTFROM/i.test(texto);
    var rotulo = (banco || (cartao ? 'Cartão' : 'Banco')).replace(/\s+/g, ' ').trim();
    if (conta) rotulo += ' ••' + conta.replace(/\D/g, '').slice(-4);

    var blocos = texto.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];

    blocos.forEach(function (b) {
      var bruto = tag(b, 'TRNAMT');
      var v = valor(bruto);
      var d = data(tag(b, 'DTPOSTED') || tag(b, 'DTUSER'));
      if (isNaN(v) || v === 0 || !d) return;

      var nome = tag(b, 'NAME');
      var memo = tag(b, 'MEMO');
      // NAME e MEMO às vezes trazem o mesmo texto; junta sem repetir.
      var desc = nome;
      if (memo && memo.toLowerCase() !== nome.toLowerCase()) {
        desc = desc ? desc + ' · ' + memo : memo;
      }

      var fitid = tag(b, 'FITID');

      itens.push({
        fitid: fitid ? 'ofx:' + fitid : chaveSintetica(d, v, desc),
        date: d,
        amount: Math.abs(v),
        type: v < 0 ? 'out' : 'in',
        memo: desc || tag(b, 'TRNTYPE') || 'Movimentação',
        conta: rotulo
      });
    });

    return itens;
  };

  // Sem FITID (caso do CSV), a chave vem dos próprios dados da linha.
  // Serve para não importar a mesma movimentação duas vezes.
  function chaveSintetica(d, v, memo) {
    var base = d + '|' + v.toFixed(2) + '|' +
               String(memo || '').toLowerCase().replace(/\s+/g, '').slice(0, 40);
    var h = 5381;
    for (var i = 0; i < base.length; i++) h = ((h * 33) ^ base.charCodeAt(i)) >>> 0;
    return 'csv:' + h.toString(36) + ':' + base.slice(0, 24);
  }

  /* ---------------------------------------------------------
     CSV
     --------------------------------------------------------- */

  // Quebra uma linha respeitando aspas: a;"texto; com ponto e vírgula";b
  function celulas(linha, sep) {
    var out = [], atual = '', dentro = false;
    for (var i = 0; i < linha.length; i++) {
      var c = linha[i];
      if (c === '"') {
        if (dentro && linha[i + 1] === '"') { atual += '"'; i++; }
        else dentro = !dentro;
      } else if (c === sep && !dentro) {
        out.push(atual); atual = '';
      } else {
        atual += c;
      }
    }
    out.push(atual);
    return out.map(function (s) { return s.trim(); });
  }

  function separador(linhas) {
    var candidatos = [';', ',', '\t', '|'];
    var melhor = ';', melhorNota = -1;
    candidatos.forEach(function (sep) {
      var contagens = linhas.slice(0, 12).map(function (l) {
        return celulas(l, sep).length;
      }).filter(function (n) { return n > 1; });
      if (!contagens.length) return;
      // Bom separador produz o mesmo número de colunas em quase toda linha.
      var moda = {}, top = 0, qtd = 0;
      contagens.forEach(function (n) {
        moda[n] = (moda[n] || 0) + 1;
        if (moda[n] > qtd) { qtd = moda[n]; top = n; }
      });
      var nota = qtd * 10 + top;
      if (nota > melhorNota) { melhorNota = nota; melhor = sep; }
    });
    return melhor;
  }

  function achaColuna(cabecalho, padrao) {
    for (var i = 0; i < cabecalho.length; i++) {
      if (padrao.test(cabecalho[i])) return i;
    }
    return -1;
  }

  Fin.lerCSV = function (texto, nomeArquivo) {
    var linhas = texto.split(/\r\n|\n|\r/).filter(function (l) { return l.trim(); });
    if (!linhas.length) return [];

    var sep = separador(linhas);

    // Nomes de coluna aceitos. Cobre português e inglês, porque alguns
    // bancos (Nubank, C6, Wise) exportam o CSV com cabeçalho em inglês.
    var RE_DATA    = /^data|^date|dt\b|data.*lan[çc]|lan[çc].*data|posted/;
    var RE_DESC    = /desc|hist[óo]ric|lan[çc]amento|memo|detalhe|estabelec|t[íi]tulo|opera[çc]|payee|merchant|reference/;
    var RE_VALOR   = /^valor|montante|amount|quantia|^vlr|^value/;
    var RE_CREDITO = /cr[ée]dit|entrada|receita|dep[óo]sito/;
    var RE_DEBITO  = /d[ée]bit|sa[íi]da|despesa|retirada|withdraw/;

    // Acha a linha de cabeçalho: a primeira que fala de data e de valor.
    var iCab = -1, cab = null;
    for (var i = 0; i < Math.min(linhas.length, 15); i++) {
      var c = celulas(linhas[i], sep).map(function (s) { return s.toLowerCase(); });
      var temData = c.some(function (s) { return RE_DATA.test(s); });
      var temValor = c.some(function (s) {
        return RE_VALOR.test(s) || RE_CREDITO.test(s) || RE_DEBITO.test(s);
      });
      if (temData && temValor) { iCab = i; cab = c; break; }
    }

    var col;
    if (cab) {
      col = {
        data: achaColuna(cab, RE_DATA),
        desc: achaColuna(cab, RE_DESC),
        valor: achaColuna(cab, RE_VALOR),
        credito: achaColuna(cab, RE_CREDITO),
        debito: achaColuna(cab, RE_DEBITO)
      };
    } else {
      // Sem cabeçalho reconhecível: assume data, descrição, valor.
      iCab = -1;
      col = { data: 0, desc: 1, valor: 2, credito: -1, debito: -1 };
    }

    if (col.data < 0 || (col.valor < 0 && col.credito < 0 && col.debito < 0)) return [];

    var rotulo = (nomeArquivo || 'Extrato').replace(/\.[a-z]+$/i, '').slice(0, 28);
    var itens = [];

    linhas.slice(iCab + 1).forEach(function (linha) {
      var c = celulas(linha, sep);
      if (c.length < 2) return;

      var d = data(c[col.data]);
      if (!d) return;

      var v = NaN;
      if (col.valor >= 0) v = valor(c[col.valor]);

      // Planilhas com colunas separadas de crédito e débito.
      if (isNaN(v) || v === 0) {
        var cr = col.credito >= 0 ? valor(c[col.credito]) : NaN;
        var db = col.debito >= 0 ? valor(c[col.debito]) : NaN;
        if (!isNaN(cr) && cr !== 0) v = Math.abs(cr);
        else if (!isNaN(db) && db !== 0) v = -Math.abs(db);
      }

      if (isNaN(v) || v === 0) return;

      var memo = col.desc >= 0 ? limpar(c[col.desc]) : '';
      if (!memo) {
        // Usa a maior célula de texto que sobrou como descrição.
        memo = c.filter(function (x, i) {
          return i !== col.data && i !== col.valor && isNaN(valor(x)) && x.length > 2;
        }).sort(function (a, b) { return b.length - a.length; })[0] || 'Movimentação';
        memo = limpar(memo);
      }

      itens.push({
        fitid: chaveSintetica(d, v, memo),
        date: d,
        amount: Math.abs(v),
        type: v < 0 ? 'out' : 'in',
        memo: memo,
        conta: rotulo
      });
    });

    return itens;
  };

  /* ---------------------------------------------------------
     PDF

     Ao contrário do OFX e do CSV, PDF não tem estrutura: é texto
     solto com coordenadas. A leitura reagrupa os pedaços em linhas
     pela altura (y) e identifica as colunas pela posição (x).

     Testado com o extrato de conta corrente do Banco do Brasil.
     Outros bancos caem no modo genérico, que acerta menos.
     --------------------------------------------------------- */

  // A biblioteca de PDF pesa ~1,5 MB, então só é baixada quando você
  // realmente escolhe um PDF — e nunca na abertura do app.
  Fin.carregarPDFjs = function () {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);

    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = './vendor/pdf.min.js';
      s.onload = function () {
        if (!window.pdfjsLib) { reject(new Error('leitor de PDF não carregou')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('sem conexão para baixar o leitor de PDF')); };
      document.head.appendChild(s);
    });
  };

  // Junta os pedaços de texto que estão na mesma altura numa "linha".
  function linhasDaPagina(textContent) {
    var linhas = [];

    textContent.items.forEach(function (it) {
      var texto = (it.str || '').trim();
      if (!texto) return;

      var x = it.transform[4], y = it.transform[5];
      var linha = null;
      for (var k = 0; k < linhas.length; k++) {
        if (Math.abs(linhas[k].y - y) < 3) { linha = linhas[k]; break; }
      }
      if (!linha) { linha = { y: y, itens: [] }; linhas.push(linha); }
      linha.itens.push({ x: x, t: texto });
    });

    linhas.sort(function (a, b) { return b.y - a.y; });          // de cima para baixo
    linhas.forEach(function (l) {
      l.itens.sort(function (a, b) { return a.x - b.x; });        // da esquerda para a direita
    });
    return linhas;
  }

  var RE_DATA_BR  = /^\d{2}\/\d{2}\/\d{4}$/;
  var RE_VALOR_BB = /^([\d.]+,\d{2})\s*\(([+-])\)$/;

  // Movimentações internas do BB. A conta corrente é varrida para o
  // Rende Fácil todo dia, então cada lançamento real tem um espelho.
  // Importar os dois zeraria tudo.
  var INTERNAS = /rende\s*f[áa]cil|bb\s*rf|saldo\s*anterior|saldo\s*do\s*dia|\bs\s+a\s+l\s+d\s+o\b|total\s*aplica/i;

  // Separa uma linha em data (coluna da esquerda), valor (coluna da
  // direita) e texto do histórico (coluna do meio).
  function analisar(linha) {
    var r = { data: '', valor: '', sinal: '', hist: [] };

    linha.itens.forEach(function (it) {
      if (!r.data && it.x < 120 && RE_DATA_BR.test(it.t)) { r.data = it.t; return; }
      var m = it.t.match(RE_VALOR_BB);
      if (m && it.x > 420) { r.valor = m[1]; r.sinal = m[2]; return; }
      if (it.x >= 200 && it.x < 500) r.hist.push(it.t);
    });

    r.hist = r.hist.join(' ').trim();
    r.ehLancamento = !!(r.data && r.valor);
    r.soHistorico = !r.data && !r.valor && !!r.hist;
    return r;
  }

  // A segunda linha do histórico vem como "dia hora [CPF/CNPJ] NOME".
  // Ex.: "01/07 18:00 00000000000000 FULANO DE TAL" vira "FULANO DE TAL".
  function nomeDoDetalhe(texto) {
    return String(texto || '')
      .replace(/^\d{2}\/\d{2}\s+\d{2}:\d{2}\s*/, '')   // dia e hora da compra
      .replace(/^\d{6,20}\s+/, '')                      // CPF/CNPJ do outro lado
      .trim();
  }

  function contaDoExtrato(linhas) {
    var texto = linhas.slice(0, 8).map(function (l) {
      return l.itens.map(function (i) { return i.t; }).join(' ');
    }).join(' ');

    var m = texto.match(/Conta:?\s*([\d.\-]+)/i);
    var digitos = m ? m[1].replace(/\D/g, '') : '';
    var banco = /banco do brasil|extrato de conta corrente/i.test(texto) ? 'Banco do Brasil' : 'Extrato';
    return digitos ? banco + ' ••' + digitos.slice(-4) : banco;
  }

  // Percorre as linhas de todas as páginas montando os lançamentos.
  //
  // O BB centraliza o histórico em duas linhas em volta da linha que traz
  // a data e o valor: a primeira fica ACIMA dela, e a segunda fica na
  // própria linha ou, quando não cabe, ABAIXO.
  function montarLancamentos(linhas, rotulo) {
    var itens = [];
    var info = linhas.map(analisar);

    info.forEach(function (a, i) {
      if (!a.ehLancamento) return;

      var acima  = i > 0 ? info[i - 1] : null;
      var abaixo = i + 1 < info.length ? info[i + 1] : null;

      var tipo = (acima && acima.soHistorico) ? acima.hist : '';
      var detalhe = a.hist;
      if (!detalhe && abaixo && abaixo.soHistorico) detalhe = abaixo.hist;

      var completo = (tipo + ' ' + detalhe).trim();
      if (!completo || INTERNAS.test(completo)) return;

      var v = valor(a.valor);
      if (isNaN(v) || v === 0) return;

      var d = data(a.data);
      if (!d) return;

      var nome = nomeDoDetalhe(detalhe);
      var memo = tipo
        ? (nome ? tipo + ' · ' + nome : tipo)
        : (nome || 'Movimentação');

      itens.push({
        // A chave inclui o texto completo da linha, então reimportar o
        // mesmo PDF não duplica nada.
        fitid: chaveSintetica(d, a.sinal === '+' ? v : -v, memo + completo),
        date: d,
        amount: Math.abs(v),
        type: a.sinal === '+' ? 'in' : 'out',
        memo: memo,
        conta: rotulo
      });
    });

    return itens;
  }

  // Rede de segurança para bancos de layout desconhecido: qualquer linha
  // que tenha uma data e um valor vira lançamento, e o resto vira descrição.
  function modoGenerico(linhas, rotulo) {
    var itens = [];

    linhas.forEach(function (l) {
      var texto = l.itens.map(function (i) { return i.t; }).join(' ');
      var mData = texto.match(/(\d{2}\/\d{2}\/\d{2,4})/);
      var mValor = texto.match(/(-?\s?R?\$?\s?[\d.]{1,12},\d{2})\s*(\([+-]\))?/);
      if (!mData || !mValor) return;
      if (INTERNAS.test(texto)) return;

      var d = data(mData[1]);
      var v = valor(mValor[1]);
      if (!d || isNaN(v) || v === 0) return;

      var negativo = /\(-\)/.test(texto) || /-\s?R?\$?\s?[\d.]+,\d{2}/.test(texto) || v < 0;
      var memo = texto.replace(mData[0], '').replace(mValor[0], '').replace(/\s+/g, ' ').trim();

      itens.push({
        fitid: chaveSintetica(d, negativo ? -Math.abs(v) : Math.abs(v), memo),
        date: d,
        amount: Math.abs(v),
        type: negativo ? 'out' : 'in',
        memo: memo || 'Movimentação',
        conta: rotulo
      });
    });

    return itens;
  }

  Fin.lerPDF = function (buffer) {
    var pdfjsLib;

    return Fin.carregarPDFjs()
      .then(function (lib) {
        pdfjsLib = lib;
        return pdfjsLib.getDocument({ data: buffer }).promise;
      })
      .then(function (pdf) {
        var linhas = [];
        var fila = Promise.resolve();

        for (var n = 1; n <= pdf.numPages; n++) {
          (function (pagina) {
            fila = fila.then(function () {
              return pdf.getPage(pagina)
                .then(function (p) { return p.getTextContent(); })
                .then(function (tc) { linhas = linhas.concat(linhasDaPagina(tc)); });
            });
          })(n);
        }

        return fila.then(function () {
          if (!linhas.length) {
            throw new Error('PDF sem texto — provavelmente é digitalizado');
          }

          var rotulo = contaDoExtrato(linhas);
          var itens = montarLancamentos(linhas, rotulo);
          var modo = 'PDF';

          if (!itens.length) {
            itens = modoGenerico(linhas, rotulo);
            modo = 'PDF (genérico)';
          }

          return { formato: modo, itens: itens };
        });
      });
  };

  /* ---------------------------------------------------------
     Palpite de categoria pelo texto da movimentação
     --------------------------------------------------------- */

  var REGRAS_SAIDA = [
    ['Uber',           /\buber|99\s?(app|pop|taxi)|cabify|t[áa]xi/],
    ['Gasolina',       /posto|combust|shell|ipiranga|petrobr|br\s?mania|ale\b|gasolin|etanol/],
    ['Mercado',        /mercado|supermerc|atacad|carrefour|assa[íi]|p[aã]o de a[çc]|extra\b|big\b|sendas|zaffari|angeloni|hortifr|sacol[aã]o|dia\s?%|golff|muffato|condor\b|tauste|sonda\b|tenda\b|savegnago/],
    ['Alimentação',    /ifood|rappi|restaurant|refei[çc][õo]es|lanchon|padaria|pizzar|hamburg|burger|mc\s?donal|bk\b|subway|cafeteri|churrasc|a[çc]a[íi]|bar\s?e\s?rest|delivery|food/],
    ['Assinaturas',    /netflix|spotify|prime\s?video|amazon\s?prime|disney|hbo|max\b|globoplay|deezer|youtube\s?prem|icloud|google\s?one|dropbox|assinatur|mensalidade\s?app/],
    ['Saúde',          /farm[áa]c|drogar|drogasil|\braia\d*\b|pacheco|pague\s?menos|panvel|nissei|unimed|amil|bradesco\s?sa[úu]|hospital|cl[íi]nic|laborat[óo]r|dentist|psic[óo]log|exame/],
    ['Contas',         /energia|eletric|cemig|cpfl|light\b|enel|copel|celesc|sabesp|copasa|caesb|[áa]gua\b|g[áa]s\b|comgas|vivo|claro|tim\b|oi\s?fixo|net\s?servi|internet|telefon|boleto|fatura|conta\s?de/],
    ['Moradia',        /aluguel|condom[íi]nio|imobili[áa]r|iptu|reforma|constru|leroy|telha\s?norte/],
    ['Compra virtual', /amazon|mercado\s?livre|mercadolivre|shopee|aliexpress|magalu|magazine\s?luiza|americanas|casas\s?bahia|shein|submarino|kabum|netshoes|pag\s?seguro|paypal/],
    ['Educação',       /escola|col[ée]gio|faculdade|universi|curso|udemy|alura|coursera|mensalidade\s?escolar|material\s?escolar|livraria/],
    ['Lazer',          /cinema|teatro|show\b|ingresso|park|clube|academia|smart\s?fit|bar\b|pub\b|balada|viagem|hotel|airbnb|booking|passagem|latam|gol\b|azul\b|\bgaming\b|\bgames\b|\bsteam\b|playstation|xbox|nintendo|barbearia|sal[ãa]o de beleza/]
  ];

  var REGRAS_ENTRADA = [
    ['Salário',       /sal[áa]rio|pagamento\s?de\s?sal|remunera|proventos|folha\s?de\s?pag|adiantamento|13[ºo°]?\s?sal|f[ée]rias/],
    ['Investimentos', /rendiment|juros|dividend|jcp\b|resgate|aplica[çc]|cdb\b|tesouro|poupan[çc]a|renda\s?fixa/],
    ['Freelance',     /freela|servi[çc]o\s?prestado|nota\s?fiscal|honor[áa]r|consultori/],
    ['Reembolso',     /reembols|estorno|devolu[çc]|cashback|ressarc/],
    // "Pix recebido" de propósito NÃO entra aqui: um Pix recebido pode ser
    // venda, reembolso ou empréstimo. Melhor deixar você escolher.
    ['Vendas',        /venda|recebiment\s?de\s?venda/]
  ];

  // Sugere uma categoria pelo descritivo. Só devolve nome que exista de
  // verdade naquele tipo (inclusive as categorias criadas pelo usuário).
  Fin.palpiteCategoria = function (memo, tipo) {
    var texto = String(memo || '').toLowerCase();
    var disponiveis = Fin.catsDe(tipo);

    function existe(nome) {
      return disponiveis.some(function (c) { return c.name === nome; }) ? nome : '';
    }

    // As categorias do próprio usuário têm prioridade: se o nome dela
    // aparece no descritivo, é o palpite mais confiável que existe.
    var propria = disponiveis.filter(function (c) { return c.custom; })
      .sort(function (a, b) { return b.name.length - a.name.length; })
      .find(function (c) {
        return c.name.length >= 3 && texto.indexOf(c.name.toLowerCase()) !== -1;
      });
    if (propria) return propria.name;

    var regras = tipo === 'in' ? REGRAS_ENTRADA : REGRAS_SAIDA;
    for (var i = 0; i < regras.length; i++) {
      if (regras[i][1].test(texto)) {
        var achou = existe(regras[i][0]);
        if (achou) return achou;
      }
    }
    return '';
  };

  /* ---------------------------------------------------------
     Entrada única: lê o arquivo e devolve o que é novo
     --------------------------------------------------------- */

  Fin.lerExtrato = function (texto, nomeArquivo) {
    var ehOFX = /<OFX>|OFXHEADER|<STMTTRN>/i.test(texto);
    var itens = ehOFX ? Fin.lerOFX(texto) : Fin.lerCSV(texto, nomeArquivo);
    return { formato: ehOFX ? 'OFX' : 'CSV', itens: itens };
  };

  // Um PDF começa sempre com "%PDF". Checar os bytes é mais confiável do
  // que confiar na extensão do arquivo.
  Fin.ehPDF = function (buffer) {
    var b = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
    return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  };

  // Ponto único de entrada: decide o formato e devolve sempre uma Promise.
  Fin.lerArquivo = function (buffer, nomeArquivo) {
    if (Fin.ehPDF(buffer)) return Fin.lerPDF(buffer);
    return Promise.resolve(Fin.lerExtrato(Fin.decodificar(buffer), nomeArquivo));
  };

  // Remove o que já existe (por fitid) e sugere categoria para o resto.
  Fin.filtrarNovos = function (itens, dados) {
    var vistos = {};
    dados.tx.forEach(function (t) { if (t.fitid) vistos[t.fitid] = true; });
    dados.pendentes.forEach(function (p) { if (p.fitid) vistos[p.fitid] = true; });

    var novos = [], repetidos = 0, seq = 0;

    itens.forEach(function (it) {
      if (vistos[it.fitid]) { repetidos++; return; }
      vistos[it.fitid] = true;
      novos.push({
        id: Date.now() + (seq++),
        fitid: it.fitid,
        date: it.date,
        amount: it.amount,
        type: it.type,
        memo: it.memo,
        conta: it.conta,
        category: Fin.palpiteCategoria(it.memo, it.type)
      });
    });

    return { novos: novos, repetidos: repetidos };
  };

})(window.Fin);
