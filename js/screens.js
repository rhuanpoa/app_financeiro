/* =========================================================
   screens.js — monta o HTML de cada tela.
   Funções puras: recebem os dados calculados + o estado e
   devolvem uma string. Quem coloca no DOM é o app.js.
   ========================================================= */

window.Fin = window.Fin || {};

(function (Fin) {
  'use strict';

  var esc = Fin.esc;

  /* ---------- pedaços reaproveitados ---------- */

  var ICONE_FECHAR =
    '<button class="icon-btn close" data-nav="{{destino}}" type="button" aria-label="Fechar">✕</button>';

  function fechar(destino) {
    return ICONE_FECHAR.replace('{{destino}}', destino);
  }

  function vazio(titulo, texto) {
    return '<div class="card dashed">' +
             '<div class="empty-title">' + titulo + '</div>' +
             '<div class="empty-text">' + texto + '</div>' +
           '</div>';
  }

  function barra(pct, cor, classe) {
    return '<div class="bar ' + (classe || '') + '">' +
             '<i style="width:' + pct + '%' + (cor ? ';background:' + cor : '') + '"></i>' +
           '</div>';
  }

  // Uma linha de lançamento. `apagavel` liga o ✕ à direita.
  function linhaTx(t, apagavel) {
    return '<div class="row">' +
             '<div class="avatar" style="background:' + t.tint + '"><i style="background:' + t.dot + '"></i></div>' +
             '<div class="body">' +
               '<div class="title">' + esc(t.note) + '</div>' +
               '<div class="meta">' + esc(t.meta) + '</div>' +
             '</div>' +
             '<div class="amount mono ' + t.amountClass + '">' + t.amountFmt + '</div>' +
             (apagavel
               ? '<button class="del" data-action="del-tx" data-id="' + t.id + '" type="button" aria-label="Apagar">✕</button>'
               : '') +
           '</div>';
  }

  // Chips de categoria de um formulário.
  function chips(lista, form, selecionada) {
    return '<div class="chips" data-chips="' + form + '">' +
      lista.map(function (c) {
        var on = c.name === selecionada;
        var estilo = on
          ? 'border-color:' + c.color + ';background:' + c.color + '18;color:' + c.color
          : '';
        return '<button type="button" class="chip' + (on ? ' on' : '') + '" style="' + estilo + '" ' +
               'data-action="pick-cat" data-form="' + form + '" data-cat="' + esc(c.name) + '" ' +
               'data-color="' + c.color + '">' +
                 '<i style="background:' + c.color + '"></i>' + esc(c.name) +
               '</button>';
      }).join('') + '</div>';
  }

  function campo(opts) {
    return '<input class="field ' + (opts.mono ? 'mono' : '') + '"' +
           ' type="' + (opts.type || 'text') + '"' +
           (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') +
           ' placeholder="' + esc(opts.placeholder || '') + '"' +
           ' value="' + esc(opts.value || '') + '"' +
           ' data-form="' + opts.form + '" data-field="' + opts.field + '">';
  }

  Fin.telas = {};

  /* =========================================================
     Início
     ========================================================= */

  Fin.telas.dash = function (v) {
    var h = '<div class="screen">';

    // O botão redondo do canto é o do design original; hoje ele abre o menu.
    h += '<div class="head">' +
           '<div>' +
             '<div class="head-eyebrow">' + v.saudacao + '</div>' +
             '<div class="head-title">Suas finanças</div>' +
           '</div>' +
           '<button class="icon-btn" data-action="abrir-menu" type="button" aria-label="Abrir menu">' +
             '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>' +
           '</button>' +
         '</div>';

    // Atalho para revisar o que veio do extrato e ainda não entrou no caixa.
    if (v.temPendentes) {
      h += '<button class="aviso" style="display:block;width:100%;text-align:left;margin-bottom:16px" data-nav="movimentacoes" type="button">' +
             '<b>' + v.qtdPendentes + ' movimentação(ões) do extrato</b> esperando você conferir a categoria. ' +
             'Elas ainda não entraram no saldo. Toque para revisar ›' +
           '</button>';
    }

    h += '<div class="balance-card">' +
           '<div class="balance-label">Saldo atual</div>' +
           '<div class="balance-value mono' + (v.saldoNegativo ? ' negative' : '') + '">' + v.saldoFmt + '</div>' +
           '<div class="balance-split">' +
             '<div><div class="k">Entradas do mês</div><div class="v in mono">' + v.entradasMesFmt + '</div></div>' +
             '<div><div class="k">Saídas do mês</div><div class="v out mono">' + v.saidasMesFmt + '</div></div>' +
           '</div>' +
         '</div>';

    h += '<div class="quick">' +
           '<button data-action="add-out" type="button">' +
             '<div class="bubble out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 19V5M5 12l7 7 7-7"/></svg></div>' +
             '<div><div class="t">Saída</div><div class="s">Registrar gasto</div></div>' +
           '</button>' +
           '<button data-action="add-in" type="button">' +
             '<div class="bubble in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12l7-7 7 7"/></svg></div>' +
             '<div><div class="t">Entrada</div><div class="s">Registrar receita</div></div>' +
           '</button>' +
         '</div>';

    if (v.temParcelas) {
      h += '<button class="card tap" style="margin-top:16px" data-nav="parcelas" type="button">' +
             '<div class="between">' +
               '<div>' +
                 '<div style="font-size:13px;font-weight:700">Parcelas deste mês</div>' +
                 '<div style="font-size:12px;color:var(--muted);margin-top:2px">' + v.qtdParcelas + ' compra(s) parcelada(s)</div>' +
               '</div>' +
               '<div class="mono" style="font-size:17px;font-weight:600;color:var(--red)">' + v.parcelasMesFmt + '</div>' +
             '</div>' +
           '</button>';
    }

    h += '<button class="card lg tap" style="margin-top:16px" data-nav="proj" type="button">' +
           '<div class="between">' +
             '<div style="font-size:13px;font-weight:700">Previsão · 12 meses</div>' +
             '<div style="font-size:11px;color:var(--muted);font-weight:600">ver detalhes ›</div>' +
           '</div>' +
           '<div class="mono" style="font-size:24px;font-weight:600;letter-spacing:-.02em;margin-top:6px;color:' +
             (v.previsao.total < 0 ? 'var(--red)' : 'var(--deep)') + '">' + Fin.fmt(v.previsao.total) + '</div>' +
           '<div class="chart">' +
             v.previsao.barras.map(function (b) {
               return '<i style="height:' + b.alturaPct + '%;background:' + b.suave + '"></i>';
             }).join('') +
           '</div>' +
         '</button>';

    h += '<div class="section-bar">' +
           '<div style="font-size:15px;font-weight:800">Últimos lançamentos</div>' +
           (v.temTx ? '<button class="link" data-nav="hist" type="button">Ver tudo</button>' : '') +
         '</div>';

    if (v.temTx) {
      h += '<div class="stack tight">' +
             v.recentes.map(function (t) { return linhaTx(t, false); }).join('') +
           '</div>';
    } else {
      h += vazio('Nada registrado ainda',
        'Toque em <b>Saída</b> ou <b>Entrada</b> acima para começar a controlar seu dinheiro.');
    }

    if (v.temMetas) {
      h += '<div class="section-title">Metas</div><div class="stack">' +
             v.metas.map(function (g) {
               return '<div class="card" style="border-radius:16px;padding:14px 16px">' +
                        '<div class="between">' +
                          '<div style="font-size:14px;font-weight:700">' + esc(g.name) + '</div>' +
                          '<div class="mono" style="font-size:12px;color:var(--muted)">' + g.savedFmt + ' / ' + g.targetFmt + '</div>' +
                        '</div>' + barra(g.pct) +
                      '</div>';
             }).join('') +
           '</div>';
    }

    return h + '</div>';
  };

  /* =========================================================
     Novo lançamento
     ========================================================= */

  Fin.telas.add = function (v, estado) {
    var tipo = estado.addType;              // 'out' ou 'in'
    var f = estado.forms[tipo];
    var entrada = tipo === 'in';

    var h = '<div class="screen">';

    h += '<div class="head">' +
           '<div class="head-title sm">Novo lançamento</div>' + fechar('dash') +
         '</div>';

    h += '<div class="segmented">' +
           '<button type="button" data-action="set-type" data-type="out" class="' + (!entrada ? 'on' : '') + '">Saída</button>' +
           '<button type="button" data-action="set-type" data-type="in" class="' + (entrada ? 'on' : '') + '">Entrada</button>' +
         '</div>';

    h += '<div class="amount-field">' +
           '<div class="cap">Valor</div>' +
           '<div class="wrap">' +
             '<span class="cur mono">R$</span>' +
             '<input class="mono' + (entrada ? ' in' : '') + '" inputmode="decimal" placeholder="0,00" ' +
               'value="' + esc(f.amount) + '" data-form="' + tipo + '" data-field="amount">' +
           '</div>' +
         '</div>';

    h += '<div class="label">Categoria</div>' +
         chips(Fin.catsDe(tipo), tipo, f.category);

    h += '<div class="label">Descrição (opcional)</div>' +
         campo({ form: tipo, field: 'note', value: f.note, placeholder: 'Ex: Almoço com a equipe' });

    h += '<div class="label">Data</div>' +
         campo({ form: tipo, field: 'date', value: f.date, type: 'date' });

    h += '<button class="switch-row" data-action="toggle-fixed" type="button">' +
           '<div>' +
             '<div class="t">Repete todo mês</div>' +
             '<div class="s">Salário, aluguel, assinaturas…</div>' +
           '</div>' +
           '<span class="switch' + (f.fixed ? ' on' : '') + '"><i></i></span>' +
         '</button>';

    h += '<button class="btn-primary" data-action="save-tx" type="button">Salvar ' +
           (entrada ? 'entrada' : 'saída') + '</button>';

    return h + '</div>';
  };

  /* =========================================================
     Parcelas
     ========================================================= */

  Fin.telas.parcelas = function (v) {
    var h = '<div class="screen">';

    h += '<div class="head"><div>' +
           '<div class="head-title">Compras parceladas</div>' +
           '<div class="head-sub">Acompanhe o que ainda falta pagar</div>' +
         '</div></div>';

    h += '<button class="btn-ghost" data-nav="parcelaAdd" type="button">+ Nova compra parcelada</button>';

    if (!v.temParcelas) {
      return h + vazio('Nenhuma compra parcelada',
        'Cadastre uma compra no cartão para ver quanto sobra dela nos próximos meses.') + '</div>';
    }

    h += '<div class="stack loose">' + v.parcelas.map(function (p) {
      return '<div class="card" style="border-radius:20px;padding:17px">' +
               '<div class="between top">' +
                 '<div style="display:flex;gap:11px;align-items:center">' +
                   '<div class="avatar" style="width:40px;height:40px;background:' + p.tint + '"><i style="width:12px;height:12px;border-radius:50%;background:' + p.dot + '"></i></div>' +
                   '<div>' +
                     '<div style="font-size:15px;font-weight:700">' + esc(p.description) + '</div>' +
                     '<div style="font-size:11px;color:var(--muted);margin-top:1px">' + esc(p.card) + ' · vence dia ' + p.dueDay + '</div>' +
                   '</div>' +
                 '</div>' +
                 '<button class="del" data-action="del-parcela" data-id="' + p.id + '" type="button" aria-label="Apagar">✕</button>' +
               '</div>' +
               '<div class="between" style="margin-top:14px">' +
                 '<div><div style="font-size:11px;color:var(--muted);font-weight:600">Parcela</div>' +
                      '<div class="mono" style="font-size:17px;font-weight:600">' + p.perFmt + '</div></div>' +
                 '<div style="text-align:right"><div style="font-size:11px;color:var(--muted);font-weight:600">Falta pagar</div>' +
                      '<div class="mono" style="font-size:15px;font-weight:600;color:var(--red)">' + p.remainFmt + '</div></div>' +
               '</div>' +
               barra(p.pct, 'var(--deep)') +
               '<div class="between" style="margin-top:7px;font-size:11px;color:var(--muted);font-weight:600">' +
                 '<span>' + p.paid + ' de ' + p.parcels + ' pagas</span>' +
                 '<span>total ' + p.totalFmt + '</span>' +
               '</div>' +
             '</div>';
    }).join('') + '</div>';

    return h + '</div>';
  };

  /* =========================================================
     Nova compra parcelada
     ========================================================= */

  Fin.telas.parcelaAdd = function (v, estado) {
    var f = estado.forms.parcela;
    var n = parseInt(f.parcels, 10) || 0;
    var total = Fin.parse(f.total);

    var h = '<div class="screen">';

    h += '<div class="head"><div class="head-title sm">Nova compra parcelada</div>' + fechar('parcelas') + '</div>';

    h += '<div class="label">Descrição</div>' +
         campo({ form: 'parcela', field: 'description', value: f.description, placeholder: 'Ex: Notebook novo' });

    h += '<div class="pair">' +
           '<div><div class="label">Valor total</div>' +
             campo({ form: 'parcela', field: 'total', value: f.total, placeholder: '0,00', inputmode: 'decimal', mono: true }) +
           '</div>' +
           '<div><div class="label">Nº parcelas</div>' +
             campo({ form: 'parcela', field: 'parcels', value: f.parcels, placeholder: '12', inputmode: 'numeric', mono: true }) +
           '</div>' +
         '</div>';

    h += '<div class="preview">' +
           '<span>Valor de cada parcela</span>' +
           '<span class="mono" id="preview-parcela">' + (n > 0 ? Fin.fmt(total / n) : '—') + '</span>' +
         '</div>';

    h += '<div class="pair">' +
           '<div><div class="label">1ª parcela em</div>' +
             campo({ form: 'parcela', field: 'firstDue', value: f.firstDue, type: 'month' }) +
           '</div>' +
           '<div><div class="label">Dia venc.</div>' +
             campo({ form: 'parcela', field: 'dueDay', value: f.dueDay, placeholder: '10', inputmode: 'numeric', mono: true }) +
           '</div>' +
         '</div>';

    h += '<div class="label">Cartão</div>' +
         campo({ form: 'parcela', field: 'card', value: f.card, placeholder: 'Ex: Nubank' });

    h += '<div class="label">Categoria</div>' + chips(Fin.catsDe('out'), 'parcela', f.category);

    h += '<button class="btn-primary" data-action="save-parcela" type="button">Cadastrar compra</button>';

    return h + '</div>';
  };

  /* =========================================================
     Previsão
     ========================================================= */

  Fin.telas.proj = function (v) {
    var p = v.previsao;
    var h = '<div class="screen">';

    h += '<div class="head"><div>' +
           '<div class="head-title">Previsão</div>' +
           '<div class="head-sub">Projeção do seu saldo nos próximos 12 meses</div>' +
         '</div></div>';

    h += '<div class="balance-card" style="border-radius:22px;padding:20px">' +
           '<div class="balance-label">Saldo estimado em 12 meses</div>' +
           '<div class="balance-value mono' + (p.total < 0 ? ' negative' : '') + '" style="font-size:30px">' + Fin.fmt(p.total) + '</div>' +
           '<div class="chart chart-lg">' +
             p.barras.map(function (b) {
               return '<div class="col"><i style="height:' + b.alturaPct + '%;background:' + b.cor + '"></i>' +
                      '<span>' + b.label + '</span></div>';
             }).join('') +
           '</div>' +
         '</div>';

    h += '<div class="proj-note">Cálculo por mês: <b>entradas fixas</b> − gastos fixos − parcelas do mês − ' +
         'média de gastos variáveis (' + Fin.fmt(p.mediaVar) + '/mês).</div>';

    h += '<div class="section-title">Mês a mês</div><div class="stack">' +
      p.detalhe.map(function (d) {
        return '<div class="card proj-row" style="border-radius:16px;padding:14px 16px">' +
                 '<div class="between">' +
                   '<div class="l">' + d.label + '</div>' +
                   '<div class="v mono' + (d.negative ? ' negative' : '') + '">' + d.balanceFmt + '</div>' +
                 '</div>' +
                 '<div class="proj-tags">' +
                   '<span class="in">' + d.incomeFmt + ' entra</span>' +
                   '<span class="out">' + d.fixedFmt + ' fixo</span>' +
                   '<span class="out">' + d.instFmt + ' parcelas</span>' +
                   '<span class="out">' + d.varFmt + ' variável</span>' +
                 '</div>' +
               '</div>';
      }).join('') + '</div>';

    if (p.semDados) {
      h += '<div class="card dashed" style="margin-top:12px;padding:20px">' +
             '<div class="empty-text" style="margin:0">Cadastre entradas fixas (marque <b>“repete todo mês”</b>) ' +
             'e gastos para a previsão ganhar precisão.</div>' +
           '</div>';
    }

    return h + '</div>';
  };

  /* =========================================================
     Histórico
     ========================================================= */

  Fin.telas.hist = function (v) {
    var h = '<div class="screen">';

    h += '<div class="head"><div>' +
           '<div class="head-title">Histórico</div>' +
           '<div class="head-sub">Tudo o que entrou e saiu</div>' +
         '</div></div>';

    if (!v.temTx) {
      return h + vazio('Nenhum lançamento ainda', 'Registre uma saída ou entrada para começar.') + '</div>';
    }

    h += v.historico.map(function (g) {
      return '<div class="group-head">' +
               '<div class="l">' + g.label + '</div>' +
               '<div class="v mono ' + g.totalClass + '">' + g.totalFmt + '</div>' +
             '</div>' +
             '<div class="stack tight">' +
               g.items.map(function (t) { return linhaTx(t, true); }).join('') +
             '</div>';
    }).join('');

    return h + '</div>';
  };

  /* =========================================================
     Categorias
     ========================================================= */

  Fin.telas.categorias = function (v) {
    // Uma linha da lista. As criadas por você ganham o ✕ para apagar.
    function linha(c) {
      return '<div class="card" style="border-radius:16px;padding:13px 16px">' +
               '<div class="between" style="align-items:center">' +
                 '<div style="display:flex;align-items:center;gap:10px;min-width:0">' +
                   '<i style="width:12px;height:12px;border-radius:50%;background:' + c.color + ';display:block;flex:none"></i>' +
                   '<span style="font-size:14px;font-weight:700">' + esc(c.name) + '</span>' +
                   (c.custom ? '<span class="tag-sua">sua</span>' : '') +
                 '</div>' +
                 '<div style="display:flex;align-items:center">' +
                   '<span class="mono" style="font-size:14px;font-weight:600;color:' +
                     (c.emUso ? 'var(--ink)' : '#c9ccc0') + '">' + c.totalFmt + '</span>' +
                   (c.custom
                     ? '<button class="del" data-action="del-categoria" data-id="' + c.id + '" type="button" aria-label="Apagar categoria">✕</button>'
                     : '') +
                 '</div>' +
               '</div>' +
               barra(c.pct, c.color, 'thin') +
             '</div>';
    }

    var h = '<div class="screen">';

    h += '<div class="head"><div>' +
           '<div class="head-title">Categorias</div>' +
           '<div class="head-sub">Quanto entrou e saiu em cada uma</div>' +
         '</div></div>';

    h += '<button class="btn-ghost" data-nav="categoriaAdd" type="button">+ Nova categoria</button>';

    h += '<div class="section-title" style="margin-top:6px">Saídas</div>' +
         '<div class="stack">' + v.catsSaida.map(linha).join('') + '</div>';

    h += '<div class="section-title">Entradas</div>' +
         '<div class="stack">' + v.catsEntrada.map(linha).join('') + '</div>';

    return h + '</div>';
  };

  /* =========================================================
     Nova categoria
     ========================================================= */

  Fin.telas.categoriaAdd = function (v, estado) {
    var f = estado.forms.categoria;
    var h = '<div class="screen">';

    h += '<div class="head"><div class="head-title sm">Nova categoria</div>' + fechar('categorias') + '</div>';

    h += '<div class="segmented">' +
           '<button type="button" data-action="set-cat-type" data-type="out" class="' + (f.type === 'out' ? 'on' : '') + '">Saída</button>' +
           '<button type="button" data-action="set-cat-type" data-type="in" class="' + (f.type === 'in' ? 'on' : '') + '">Entrada</button>' +
         '</div>';

    h += '<div class="label">Nome</div>' +
         campo({ form: 'categoria', field: 'name',  value: f.name,
                 placeholder: f.type === 'in' ? 'Ex: Aluguel recebido' : 'Ex: Pet, Academia' });

    h += '<div class="label">Cor</div>' +
         '<div class="swatches" data-swatches>' +
           Fin.PALETA.map(function (cor) {
             return '<button type="button" class="swatch' + (cor === f.color ? ' on' : '') + '" ' +
                    'style="background:' + cor + '" data-action="pick-color" data-color="' + cor + '" ' +
                    'aria-label="Cor ' + cor + '"></button>';
           }).join('') +
         '</div>';

    h += '<button class="btn-primary" data-action="save-categoria" type="button">Criar categoria</button>';

    h += '<div class="hint" style="margin-top:14px;line-height:1.5">Ela vai aparecer na hora de registrar ' +
         (f.type === 'in' ? 'uma entrada' : 'uma saída ou uma compra parcelada') + '.</div>';

    return h + '</div>';
  };

  /* =========================================================
     Metas
     ========================================================= */

  Fin.telas.metas = function (v) {
    var h = '<div class="screen">';

    h += '<div class="head"><div>' +
           '<div class="head-title">Metas de economia</div>' +
           '<div class="head-sub">Guarde para seus objetivos</div>' +
         '</div></div>';

    h += '<button class="btn-ghost" data-nav="metaAdd" type="button">+ Nova meta</button>';

    if (!v.temMetas) {
      return h + vazio('Nenhuma meta ainda', 'Crie uma para juntar dinheiro com objetivo.') + '</div>';
    }

    h += '<div class="stack loose">' + v.metas.map(function (g) {
      return '<div class="card" style="border-radius:20px;padding:17px">' +
               '<div class="between top">' +
                 '<div>' +
                   '<div style="font-size:16px;font-weight:800">' + esc(g.name) + '</div>' +
                   '<div style="font-size:12px;color:var(--muted);margin-top:2px">Faltam ' + g.remainFmt + '</div>' +
                 '</div>' +
                 '<button class="del" data-action="del-meta" data-id="' + g.id + '" type="button" aria-label="Apagar">✕</button>' +
               '</div>' +
               barra(g.pct, null, 'thick') +
               '<div class="between" style="margin-top:8px">' +
                 '<span class="mono" style="font-size:13px;font-weight:600;color:var(--green)">' + g.savedFmt + '</span>' +
                 '<span class="mono" style="font-size:13px;color:var(--muted)">' + g.targetFmt + '</span>' +
               '</div>' +
               '<div class="goal-adds">' +
                 [50, 100, 200].map(function (n) {
                   return '<button type="button" data-action="goal-add" data-id="' + g.id + '" data-amount="' + n + '">+ R$' + n + '</button>';
                 }).join('') +
               '</div>' +
             '</div>';
    }).join('') + '</div>';

    return h + '</div>';
  };

  /* =========================================================
     Nova meta
     ========================================================= */

  Fin.telas.metaAdd = function (v, estado) {
    var f = estado.forms.goal;
    var h = '<div class="screen">';

    h += '<div class="head"><div class="head-title sm">Nova meta</div>' + fechar('metas') + '</div>';

    h += '<div class="label">Nome da meta</div>' +
         campo({ form: 'goal', field: 'name', value: f.name, placeholder: 'Ex: Viagem, Reserva de emergência' });

    h += '<div class="pair" style="margin-bottom:10px">' +
           '<div><div class="label">Objetivo (R$)</div>' +
             campo({ form: 'goal', field: 'target', value: f.target, placeholder: '5000,00', inputmode: 'decimal', mono: true }) +
           '</div>' +
           '<div><div class="label">Já guardado</div>' +
             campo({ form: 'goal', field: 'saved', value: f.saved, placeholder: '0,00', inputmode: 'decimal', mono: true }) +
           '</div>' +
         '</div>';

    h += '<button class="btn-primary" data-action="save-goal" type="button">Criar meta</button>';

    return h + '</div>';
  };

  /* =========================================================
     Importar extrato
     ========================================================= */

  Fin.telas.importar = function () {
    var formatos = [
      { tag: 'OFX', ok: true, t: 'OFX / Money',
        s: 'O melhor formato. Traz um código único por transação, então dá para reimportar o mesmo extrato sem duplicar nada.' },
      { tag: 'CSV', ok: true, t: 'CSV / planilha',
        s: 'Reconhece as colunas de data, descrição e valor sozinho, inclusive quando crédito e débito vêm separados.' },
      { tag: 'PDF', ok: true, t: 'PDF do Banco do Brasil',
        s: 'Extrato de conta corrente do BB, já ignorando as transferências internas do Rende Fácil. ' +
           'PDF de outros bancos é tentado no modo genérico, que pode errar — confira antes de confirmar.' }
    ];

    return '<div class="screen">' +
             '<div class="head"><div>' +
               '<div class="head-title">Importar extrato</div>' +
               '<div class="head-sub">Traga as movimentações do seu banco</div>' +
             '</div></div>' +

             '<button class="dropzone" data-action="escolher-extrato" type="button">' +
               '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 20h16"/></svg></div>' +
               '<div class="t">Escolher arquivo</div>' +
               '<div class="s">OFX, CSV ou PDF — baixe no app do banco e selecione aqui</div>' +
             '</button>' +

             '<div class="formatos">' +
               formatos.map(function (f) {
                 return '<div class="formato">' +
                          '<span class="tag' + (f.ok ? ' ok' : '') + '">' + f.tag + '</span>' +
                          '<div><div class="t">' + f.t + '</div><div class="s">' + f.s + '</div></div>' +
                        '</div>';
               }).join('') +
             '</div>' +

             '<div class="hint" style="margin-top:18px;line-height:1.6">O arquivo é lido aqui mesmo, no seu celular.<br>Nada é enviado para a internet.</div>' +
           '</div>';
  };

  /* =========================================================
     Movimentações
     ========================================================= */

  Fin.telas.movimentacoes = function (v, estado) {
    var m = v.movimentos;
    var h = '<div class="screen">';

    h += '<div class="head"><div>' +
           '<div class="head-title">Movimentações</div>' +
           '<div class="head-sub">O que veio do extrato do banco</div>' +
         '</div></div>';

    /* ---- fila de revisão ---- */
    if (v.temPendentes) {
      h += '<div class="aviso">' +
             '<b>' + v.qtdPendentes + ' movimentação(ões) para revisar.</b> ' +
             'Confira a categoria sugerida e confirme — só então elas entram no saldo, ' +
             'no histórico e na previsão.' +
           '</div>';

      h += '<div class="acoes-pend">' +
             '<button class="btn-primary" data-action="confirmar-pendentes" type="button">' +
               'Confirmar ' + v.qtdPendentes +
             '</button>' +
             '<button class="btn-secundario" data-action="descartar-pendentes" type="button">Descartar</button>' +
           '</div>';

      if (v.faltaCategoria) {
        h += '<div class="hint" style="margin:-8px 0 14px">' +
               v.faltaCategoria + ' sem categoria — vão entrar como <b>Outros</b> se você confirmar assim.' +
             '</div>';
      }

      h += '<div class="stack tight" style="margin-bottom:26px">' +
        v.pendentes.map(function (p) {
          var opcoes = Fin.catsDe(p.type).map(function (c) {
            return '<option value="' + esc(c.name) + '"' +
                   (c.name === p.category ? ' selected' : '') + '>' + esc(c.name) + '</option>';
          }).join('');

          return '<div class="pend">' +
                   '<div class="pend-topo">' +
                     '<div class="body">' +
                       '<div class="title">' + esc(p.memo) + '</div>' +
                       '<div class="meta">' + esc(p.meta) + '</div>' +
                     '</div>' +
                     '<div class="amount mono ' + p.amountClass + '">' + p.amountFmt + '</div>' +
                     '<button class="del" data-action="del-pendente" data-id="' + p.id + '" type="button" aria-label="Descartar">✕</button>' +
                   '</div>' +
                   '<select data-pendente="' + p.id + '" class="' + (p.category ? '' : 'vazio') + '">' +
                     '<option value="">Escolher categoria…</option>' + opcoes +
                   '</select>' +
                 '</div>';
        }).join('') +
      '</div>';
    }

    /* ---- nada importado ainda ---- */
    if (!m.temImportados) {
      if (!v.temPendentes) {
        h += '<div class="card dashed" style="margin-bottom:16px">' +
               '<div class="empty-title">Nenhum extrato importado</div>' +
               '<div class="empty-text">Traga o extrato do seu banco em OFX ou CSV e as movimentações aparecem aqui, prontas para categorizar.</div>' +
             '</div>';
      }
      h += '<button class="btn-primary" data-nav="importar" type="button">Importar extrato</button>';
      return h + '</div>';
    }

    /* ---- resumo do que já foi importado ---- */
    h += '<div class="resumo-import">' +
           '<div class="t">' + m.total + ' movimentação(ões) importada(s)</div>' +
           '<div class="n mono">' + m.saldoFmt + '</div>' +
           '<div class="s">' + m.entradasFmt + ' entrou · ' + m.saidasFmt + ' saiu</div>' +
         '</div>';

    if (m.contas.length > 1) {
      h += '<div class="contas">' +
             '<button class="conta-chip' + (estado.contaFiltro ? '' : ' on') + '" data-action="filtrar-conta" data-conta="" type="button">Todas</button>' +
             m.contas.map(function (c) {
               return '<button class="conta-chip' + (estado.contaFiltro === c ? ' on' : '') + '" ' +
                      'data-action="filtrar-conta" data-conta="' + esc(c) + '" type="button">' + esc(c) + '</button>';
             }).join('') +
           '</div>';
    }

    h += m.grupos.map(function (g) {
      return '<div class="group-head">' +
               '<div class="l">' + g.label + '</div>' +
               '<div class="v mono ' + g.totalClass + '">' + g.totalFmt + '</div>' +
             '</div>' +
             '<div class="stack tight">' +
               g.items.map(function (t) { return linhaTx(t, true); }).join('') +
             '</div>';
    }).join('');

    h += '<button class="btn-ghost" style="margin-top:22px;margin-bottom:0" data-nav="importar" type="button">Importar outro extrato</button>';

    return h + '</div>';
  };

})(window.Fin);
