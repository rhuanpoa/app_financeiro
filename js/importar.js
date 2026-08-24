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
          var itens, modo;

          // Fatura antes de extrato: os leitores de fatura sao especificos
          // e so reconhecem o proprio banco, entao um extrato nunca cai
          // neles por engano. O contrario nao vale -- o leitor generico
          // aceita quase tudo e faria uma leitura ruim da fatura.
          var conferencia = null;

          if (ehNubank(linhas)) {
            itens = faturaNubank(linhas, rotulo || 'Cartão Nubank');
            modo = 'Fatura Nubank';
          } else if (ehCaixa(linhas)) {
            itens = faturaCaixa(linhas, rotulo || 'Cartão Caixa');
            modo = 'Fatura Caixa';
          } else if (Fin.ehFatura(linhas)) {
            // Banco que eu não estudei. O leitor genérico tenta, e a
            // conferência abaixo é que diz se dá para confiar.
            itens = faturaGenerica(linhas, rotulo || 'Cartão');
            modo = 'Fatura (formato não reconhecido)';
          }

          if (itens && itens.length) {
            conferencia = Fin.conferirFatura(itens, linhas);
          }

          if (!itens || !itens.length) {
            itens = montarLancamentos(linhas, rotulo);
            modo = 'PDF';
          }

          if (!itens.length) {
            itens = modoGenerico(linhas, rotulo);
            modo = 'PDF (genérico)';
          }

          return { formato: modo, itens: itens, conferencia: conferencia };
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

  // Sugere uma categoria pelo descritivo, dizendo de onde veio o palpite.
  // Só devolve nome que exista de verdade naquele tipo.
  /* =========================================================
     Fatura de cartão de crédito

     Duas coisas que só existem em fatura e não em extrato:

     1. A compra parcelada, escrita dentro da descrição:
        "MAGAZ LUIZA PARC 03/12". O app já tem uma tela de
        Parcelas que alimenta a Previsão — vale transformar.

     2. O pagamento da fatura, que aparece no EXTRATO da conta
        corrente. Se a pessoa importar os dois, o mesmo dinheiro
        é contado duas vezes: uma nas compras da fatura, outra
        no pagamento. Quem decide é ela, na tela de confirmação.
     ========================================================= */

  /* Acha "3/12" e variantes dentro da descrição.

     O risco aqui é confundir com data: "03/12" também é 3 de
     dezembro. Por isso só aceitamos duas formas — com palavra-chave
     em qualquer lugar ("PARC 3/12"), ou o número no FIM da
     descrição, que é onde as faturas o colocam. Uma data solta no
     meio do nome da loja não vira parcela.                        */

  var COM_PALAVRA = /\b(?:parc(?:ela)?s?\.?|presta[çc][aã]o)\s*:?\s*(\d{1,2})\s*(?:\/|\s+de\s+)\s*(\d{1,2})\b/i;
  var NO_FIM      = /(?:^|[\s(\-])(\d{1,2})\s*\/\s*(\d{1,2})\s*\)?\s*$/;

  /* A Caixa escreve a parcela com espaço: "MP EMAGSAUL 04 06".
     Isso é bem mais ambíguo que a barra, então aqui exigimos os dois
     números com DOIS dígitos, como a Caixa sempre escreve — assim
     "LOJA 5 10" fica de fora e "LOJA 05 10" entra. */
  var SEPARADO    = /(?:^|\s)(\d{2})\s+(\d{2})\s*$/;

  Fin.lerParcelaDoMemo = function (memo) {
    var s = String(memo || '').trim();
    if (!s) return null;

    var m = s.match(COM_PALAVRA) || s.match(NO_FIM);
    var porEspaco = false;
    if (!m) { m = s.match(SEPARADO); porEspaco = !!m; }
    if (!m) return null;

    var numero = parseInt(m[1], 10);
    var total  = parseInt(m[2], 10);

    // 1/1 não é parcelamento, é compra à vista escrita de outro jeito.
    // Acima de 48 não existe na prática e provavelmente é outra coisa.
    //
    // O formato com espaço ("MERCADO 12 34") é o mais fácil de
    // confundir com número de loja ou código, então recebe um teto
    // mais baixo: parcelamento acima de 24 vezes quase não existe, e
    // aceitar até 48 aqui transformaria códigos soltos em parcelas.
    var teto = porEspaco ? 24 : 48;
    if (!(total >= 2 && total <= teto)) return null;
    if (!(numero >= 1 && numero <= total)) return null;

    // A descrição sem o "3/12" no fim: é ela que identifica a compra
    // ao longo dos meses, já que o número muda a cada fatura.
    var descricao = s.replace(m[0], ' ').replace(/\s+/g, ' ').trim();

    return { numero: numero, total: total, descricao: descricao || s };
  };

  /* Id derivado, não sorteado: a fatura de setembro e a de outubro
     trazem a MESMA compra com número diferente ("3/12" e "4/12").
     Derivando o id do que não muda — quem recebeu, em quantas vezes,
     e o valor da parcela — as duas chegam ao mesmo registro e se
     fundem, em vez de virarem duas compras iguais na tela.          */
  Fin.idDaParcela = function (descricao, total, valorParcela) {
    var chave = Fin.chaveDestinatario(descricao) || 'sem-nome';
    var centavos = Math.round((Number(valorParcela) || 0) * 100);
    return 'parc:' + chave + ':' + total + ':' + centavos;
  };

  /* O mês da primeira parcela, a partir da parcela atual.
     `mesISO` é o mês da compra, tipo '2026-08'.                    */
  Fin.primeiraParcela = function (mesISO, numero) {
    var p = String(mesISO || '').split('-');
    var ano = parseInt(p[0], 10), mes = parseInt(p[1], 10);
    if (!ano || !mes) return mesISO;

    var indice = ano * 12 + (mes - 1) - (numero - 1);
    var a = Math.floor(indice / 12), m2 = (indice % 12) + 1;
    return a + '-' + (m2 < 10 ? '0' : '') + m2;
  };

  /* Pagamento de fatura no extrato da conta corrente.

     NÃO filtramos isto sozinhos. Se a pessoa não importar a fatura
     daquele mês, este pagamento é o único registro do gasto e
     precisa contar. Quem sabe disso é ela.                          */
  var PAGAMENTO_CARTAO =
    /pagamento[\s.]*(de\s*)?(fatura|cart[aã]o)|pag[\s.]*fatura|fatura\s*cart[aã]o|pagto[\s.]*cart/i;

  Fin.ehPagamentoDeCartao = function (memo) {
    return PAGAMENTO_CARTAO.test(String(memo || ''));
  };

  /* Linhas que não são compra: encargos, e o pagamento da fatura
     anterior aparecendo dentro da própria fatura (crédito). */
  var CREDITO_NA_FATURA =
    /pagamento\s*(efetuado|recebido)|pgto\s*(efetuado|recebido)|cr[ée]dito\s*de\s*pagamento|estorno/i;

  Fin.ehCreditoDaFatura = function (memo) {
    return CREDITO_NA_FATURA.test(String(memo || ''));
  };

  /* =========================================================
     Leitura da fatura em PDF

     Os dois bancos que estudei montam a página de jeitos
     completamente diferentes:

       Nubank — tudo numa linha, em colunas:
         [x111]03 SET   [x175]Dm *Spotify   [x531]34,90

       Caixa — duas linhas por transação:
         [x16]13/05 [x260]76,23
         [x16]MP EMAGSAUL 04 06

     Por isso são dois leitores, e não um genérico com remendos.
     ========================================================= */

  var MESES_ABREV = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
                      jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

  function semAcento(s) {
    s = String(s || '').toLowerCase();
    return s.normalize ? s.normalize('NFD').replace(/[^\x00-\x7f]/g, '') : s;
  }

  function textoDaLinha(l) {
    return l.itens.map(function (i) { return i.t; }).join(' ').replace(/\s+/g, ' ').trim();
  }

  function valorBR(s) {
    var n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  /* Lançamentos que NÃO são compra.

     Descoberto conferindo contra o resumo da própria fatura: somando
     tudo dava R$ 2.367,46, e o "Total de compras" declarado era
     R$ 2.328,14 — exatamente os juros e o IOF de rotativo a mais.

     Pagamento e rotativo ficam de fora porque não são gasto: são o
     dinheiro entrando para quitar, e a máquina de carregar a dívida
     para o mês seguinte. Contá-los inflaria o gasto do mês. */
  var NAO_E_COMPRA =
    /^(pagamento em|pagamento recebido|cr[ée]dito de rotativo|saldo em rotativo|saldo anterior|estorno)/i;

  // Juros e IOF são custo de verdade: entram como gasto, mas separados
  // das compras, porque é isso que a fatura declara.
  var ENCARGO = /^(juros|iof|multa|anuidade|mora)\b/i;

  /* ---------- Nubank ---------- */

  function ehNubank(linhas) {
    var texto = linhas.slice(0, 60).map(textoDaLinha).join(' ');
    return /nu pagamentos/i.test(texto) ||
           (/TRANSA[ÇC][ÕO]ES/i.test(texto) && /VALORES EM R\$/i.test(texto));
  }

  // "FATURA 10 OUT 2023" no cabeçalho dá o ano de referência.
  function anoDaFaturaNubank(linhas) {
    for (var i = 0; i < linhas.length; i++) {
      var t = textoDaLinha(linhas[i]);
      var m = t.match(/FATURA\s+\d{1,2}\s+([A-Za-zÇ]{3})\s+(\d{4})/i);
      if (m) return { mes: MESES_ABREV[semAcento(m[1])] || 0, ano: parseInt(m[2], 10) };
    }
    return null;
  }

  function faturaNubank(linhas, rotulo) {
    var ref = anoDaFaturaNubank(linhas);
    var itens = [];

    linhas.forEach(function (l) {
      if (l.itens.length < 3) return;

      var data = null, desc = [], valor = null;

      l.itens.forEach(function (it) {
        // A data fica na primeira coluna; a continuação "Total a pagar:"
        // começa em x≈195 e não tem data, então cai fora sozinha.
        if (!data && it.x < 140 && /^\d{1,2}\s+[A-Za-zÇ]{3}$/.test(it.t)) { data = it.t; return; }
        if (it.x > 480 && /^[\d.]+,\d{2}$/.test(it.t)) { valor = it.t; return; }
        if (it.x >= 140 && it.x <= 480) desc.push(it.t);
      });

      if (!data || !valor) return;

      var memo = desc.join(' ').replace(/\s+/g, ' ').trim();
      if (!memo) return;

      var v = valorBR(valor);
      if (v === null || v === 0) return;

      var p = data.split(/\s+/);
      var dia = parseInt(p[0], 10);
      var mes = MESES_ABREV[semAcento(p[1])];
      if (!dia || !mes) return;

      // Sem ano na linha. A fatura de janeiro traz compras de dezembro:
      // mês maior que o da fatura significa ano anterior.
      var ano = ref ? (mes > ref.mes ? ref.ano - 1 : ref.ano) : new Date().getFullYear();

      itens.push(montarDaFatura(memo, v, ano, mes, dia, rotulo));
    });

    return itens.filter(Boolean);
  }

  /* ---------- Caixa ---------- */

  function ehCaixa(linhas) {
    var texto = linhas.slice(0, 80).map(textoDaLinha).join(' ');
    return /movimenta[çc][õo]es nacionais/i.test(texto) ||
           /caixa econ[ôo]mica/i.test(texto);
  }

  function faturaCaixa(linhas, rotulo) {
    var itens = [];
    var hoje = new Date();

    for (var i = 0; i < linhas.length; i++) {
      var t = textoDaLinha(linhas[i]);

      // "13/05 76,23" ou "14/08 0,02C" — o C no fim marca crédito.
      var m = t.match(/^(\d{2})\/(\d{2})\s+([\d.]+,\d{2})\s*([CD])?$/);
      if (!m) continue;

      // A descrição vem na linha SEGUINTE, não na mesma.
      var memo = i + 1 < linhas.length ? textoDaLinha(linhas[i + 1]) : '';
      if (!memo || /^\d{2}\/\d{2}\s/.test(memo)) continue;
      i++;

      var v = valorBR(m[3]);
      if (v === null || v === 0) continue;

      var dia = parseInt(m[1], 10), mes = parseInt(m[2], 10);
      if (!dia || !mes || mes > 12) continue;

      // Esta fatura não traz o ano em lugar nenhum. Compra em mês
      // adiante do atual só pode ser do ano passado.
      var ano = mes > (hoje.getMonth() + 1) ? hoje.getFullYear() - 1 : hoje.getFullYear();

      var credito = m[4] === 'C';
      itens.push(montarDaFatura(memo, v, ano, mes, dia, rotulo, credito));
    }

    return itens.filter(Boolean);
  }

  /* ---------- bancos que eu não conheço ----------

     Só consegui estudar Nubank e Caixa. Para os outros existe este
     leitor genérico — e, junto com ele, uma conferência, porque um
     leitor genérico acerta às vezes e a pessoa não tem como saber
     quando errou.

     A diferença mais perigosa entre fatura e extrato: na fatura os
     valores vêm SEM sinal. O leitor de extrato, ao não achar sinal
     de menos, classificava tudo como entrada — uma fatura de
     R$ 3.000 entrava como R$ 3.000 de receita. Aqui, reconhecendo
     que o documento é uma fatura, o padrão passa a ser saída.       */

  Fin.ehFatura = function (linhas) {
    var texto = semAcento(linhas.slice(0, 120).map(textoDaLinha).join(' '));
    var pistas = 0;
    if (/fatura/.test(texto)) pistas++;
    if (/cartao de credito|cartao final|limite total|limite de credito/.test(texto)) pistas++;
    if (/vencimento/.test(texto)) pistas++;
    if (/lancamentos|transacoes|movimenta/.test(texto)) pistas++;
    return pistas >= 2;
  };

  var MES_NUM = /^(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?$/;

  function faturaGenerica(linhas, rotulo) {
    var itens = [];
    var hoje = new Date();

    linhas.forEach(function (l) {
      var data = null, valor = null, desc = [], xValor = -1;

      l.itens.forEach(function (it) {
        var t = it.t.trim();
        if (!data && (MES_NUM.test(t) || /^\d{1,2}\s+[A-Za-zÇ]{3}$/.test(t))) { data = t; return; }
        if (/^R?\$?\s*[\d.]+,\d{2}$/.test(t)) { valor = t; xValor = it.x; return; }
        desc.push(t);
      });

      if (!data || valor === null) return;

      // O valor tem de estar à DIREITA da descrição. Sem isso, um
      // número solto no meio do nome da loja viraria o valor.
      if (xValor >= 0 && desc.length) {
        var maisADireita = Math.max.apply(null, l.itens
          .filter(function (i) { return desc.indexOf(i.t.trim()) !== -1; })
          .map(function (i) { return i.x; }));
        if (xValor < maisADireita) return;
      }

      var memo = desc.join(' ').replace(/\s+/g, ' ').trim();
      if (!memo || memo.length < 2) return;

      var v = valorBR(valor.replace(/R?\$?\s*/, ''));
      if (v === null || v === 0) return;

      var dia, mes, ano;
      var m = data.match(MES_NUM);
      if (m) {
        dia = parseInt(m[1], 10); mes = parseInt(m[2], 10);
        ano = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : null;
      } else {
        var p = data.split(/\s+/);
        dia = parseInt(p[0], 10); mes = MESES_ABREV[semAcento(p[1])]; ano = null;
      }
      if (!dia || !mes || mes > 12 || dia > 31) return;
      if (ano === null) {
        ano = mes > (hoje.getMonth() + 1) ? hoje.getFullYear() - 1 : hoje.getFullYear();
      }

      itens.push(montarDaFatura(memo, v, ano, mes, dia, rotulo));
    });

    return itens.filter(Boolean);
  }

  /* O total que a própria fatura declara.

     É o que permite dizer "li R$ 1.240 mas a fatura diz R$ 1.890" em
     vez de entregar um número errado com cara de certo. Vale mais para
     banco desconhecido do que qualquer esperteza no leitor. */
  var RE_TOTAL =
    /(total\s*(a\s*pagar|de\s*compras|da\s*fatura)|valor\s*total|total\s*desta\s*fatura)/i;

  Fin.totalDeclarado = function (linhas) {
    var achados = [];

    linhas.forEach(function (l) {
      var t = textoDaLinha(l);
      if (!RE_TOTAL.test(t)) return;
      var m = t.match(/R?\$?\s*([\d.]+,\d{2})\s*$/);
      if (!m) return;
      var v = valorBR(m[1]);
      if (v !== null && v > 0) {
        achados.push({ rotulo: t.replace(/\s+/g, ' ').trim(), valor: v });
      }
    });

    if (!achados.length) return null;

    // "Total de compras" é o que se compara com a soma dos lançamentos.
    // "Total a pagar" inclui saldo antigo e juros, e não bate de propósito.
    var compras = achados.filter(function (a) { return /de\s*compras/i.test(a.rotulo); });
    return (compras[0] || achados[achados.length - 1]);
  };

  /* Compara o que li com o que a fatura declara. */
  Fin.conferirFatura = function (itens, linhas) {
    var declarado = Fin.totalDeclarado(linhas);
    if (!declarado) return { temTotal: false };

    var lido = itens
      .filter(function (i) { return i.type === 'out' && !i.encargo; })
      .reduce(function (s, i) { return s + i.amount; }, 0);

    var dif = Math.abs(lido - declarado.valor);

    return {
      temTotal: true,
      lido: Math.round(lido * 100) / 100,
      declarado: declarado.valor,
      rotulo: declarado.rotulo,
      // Alguns centavos são arredondamento da própria fatura; acima
      // disso, alguma linha não foi lida ou foi lida errado.
      bate: dif < 0.10,
      diferenca: Math.round(dif * 100) / 100
    };
  };

  /* ---------- comum aos dois ---------- */

  // A Caixa marca credito com "C" depois do valor, mas nem sempre: um
  // "AJUSTE CRED PARC S JUROS" vem sem marca nenhuma e mesmo assim e
  // dinheiro voltando. A descricao tambem conta.
  var CREDITO_PELO_TEXTO =
    /\b(ajuste\s*cr[ée]d|estorno|cr[ée]dito|devolu[çc][aã]o|reembolso)/i;

  function montarDaFatura(memo, valor, ano, mes, dia, rotulo, credito) {
    if (NAO_E_COMPRA.test(memo)) return null;
    if (!credito && CREDITO_PELO_TEXTO.test(memo)) credito = true;

    var d = ano + '-' + (mes < 10 ? '0' : '') + mes + '-' + (dia < 10 ? '0' : '') + dia;

    return {
      // Crédito na fatura (estorno, ajuste) volta como entrada.
      type: credito ? 'in' : 'out',
      amount: Math.abs(valor),
      date: d,
      memo: memo,
      conta: rotulo,
      // Marca a origem: a tela de confirmação usa para explicar que
      // isto veio de uma fatura, e não do extrato da conta.
      fatura: true,
      encargo: ENCARGO.test(memo) || undefined,
      fitid: chaveSintetica(d, credito ? valor : -valor, memo)
    };
  }

  Fin.palpiteDetalhado = function (memo, tipo) {
    var texto = String(memo || '').toLowerCase();
    var disponiveis = Fin.catsDe(tipo);

    function existe(nome) {
      return disponiveis.some(function (c) { return c.name === nome; }) ? nome : '';
    }

    // 1º: o que VOCÊ já escolheu para este mesmo destinatário. Ganha de
    // qualquer palavra-chave — é decisão sua, não chute do app.
    var regra = Fin.regraPara(memo, tipo);
    if (regra && existe(regra.category)) {
      return { category: regra.category, origem: 'aprendido' };
    }

    // As categorias do próprio usuário têm prioridade: se o nome dela
    // aparece no descritivo, é o palpite mais confiável que existe.
    var propria = disponiveis.filter(function (c) { return c.custom; })
      .sort(function (a, b) { return b.name.length - a.name.length; })
      .find(function (c) {
        return c.name.length >= 3 && texto.indexOf(c.name.toLowerCase()) !== -1;
      });
    if (propria) return { category: propria.name, origem: 'sua categoria' };

    var regras = tipo === 'in' ? REGRAS_ENTRADA : REGRAS_SAIDA;
    for (var i = 0; i < regras.length; i++) {
      if (regras[i][1].test(texto)) {
        var achou = existe(regras[i][0]);
        if (achou) return { category: achou, origem: 'palavra-chave' };
      }
    }
    return { category: '', origem: '' };
  };

  Fin.palpiteCategoria = function (memo, tipo) {
    return Fin.palpiteDetalhado(memo, tipo).category;
  };

  /* ---------------------------------------------------------
     Aprender com o que você escolheu

     Ao confirmar a revisão, cada movimentação vira uma regra
     "este destinatário é desta categoria". Na próxima importação
     ela já vem preenchida.
     --------------------------------------------------------- */

  Fin.aprender = function (regras, itens) {
    var lista = Array.isArray(regras) ? regras.slice() : [];

    itens.forEach(function (it) {
      if (!it.category) return;
      var chave = Fin.chaveDestinatario(it.memo);
      // chave curta demais identificaria coisas demais
      if (!chave || chave.length < 3) return;

      var atual = lista.find(function (r) {
        return r.chave === chave && r.type === it.type;
      });

      if (atual) {
        // a escolha mais recente manda
        atual.category = it.category;
        atual.usos = (atual.usos || 1) + 1;
        atual.exemplo = it.memo;
        atual.id = atual.id || Fin.idDaRegra(atual);
        atual.atualizado_em = Fin.agora();
        atual._sujo = 1;
      } else {
        var nova = {
          chave: chave,
          type: it.type,
          category: it.category,
          exemplo: it.memo,
          usos: 1
        };
        nova.id = Fin.idDaRegra(nova);
        nova.atualizado_em = Fin.agora();
        nova._sujo = 1;
        lista.push(nova);
      }
    });

    return lista;
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

    var aprendidos = 0;

    itens.forEach(function (it) {
      if (vistos[it.fitid]) { repetidos++; return; }
      vistos[it.fitid] = true;

      var palpite = Fin.palpiteDetalhado(it.memo, it.type);
      if (palpite.origem === 'aprendido') aprendidos++;

      novos.push({
        id: Fin.novoId(),
        atualizado_em: Fin.agora(),
        fitid: it.fitid,
        date: it.date,
        amount: it.amount,
        type: it.type,
        memo: it.memo,
        conta: it.conta,
        category: palpite.category,
        // de onde veio a sugestão, para a revisão poder mostrar
        origemPalpite: palpite.origem
      });
    });

    return { novos: novos, repetidos: repetidos, aprendidos: aprendidos };
  };

})(window.Fin);
