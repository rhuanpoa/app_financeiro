/* =========================================================
   calc.js — tudo que é derivado dos dados brutos.
   Recebe {tx, parcelas, goals} e devolve os números prontos
   para a tela. Não mexe em DOM nem em localStorage.
   ========================================================= */

window.Fin = window.Fin || {};

(function (Fin) {
  'use strict';

  /* ---------- saldo e mês corrente ---------- */

  function saldo(tx) {
    return tx.reduce(function (a, t) {
      return a + (t.type === 'in' ? t.amount : -t.amount);
    }, 0);
  }

  function totaisDoMes(tx, mesAtual) {
    var r = { entradas: 0, saidas: 0 };
    tx.forEach(function (t) {
      if (Fin.indiceMes(Fin.paraData(t.date)) !== mesAtual) return;
      if (t.type === 'in') r.entradas += t.amount; else r.saidas += t.amount;
    });
    return r;
  }

  /* ---------- parcelas ---------- */

  // Quanto as compras parceladas pesam em um dado mês.
  function parcelasNoMes(parcelas, mes) {
    return parcelas.reduce(function (a, p) {
      var partes = String(p.firstDue).split('-').map(Number);
      var primeiro = partes[0] * 12 + (partes[1] - 1);
      var i = mes - primeiro;
      return a + (i >= 0 && i < p.parcels ? p.total / p.parcels : 0);
    }, 0);
  }

  function verParcelas(parcelas, mesAtual) {
    return parcelas.map(function (p) {
      var partes = String(p.firstDue).split('-').map(Number);
      var primeiro = partes[0] * 12 + (partes[1] - 1);
      var pagas = Math.min(p.parcels, Math.max(0, mesAtual - primeiro + 1));
      var faltam = p.parcels - pagas;
      var valorParcela = p.total / p.parcels;
      return {
        id: p.id,
        description: p.description,
        card: p.card || 'Cartão',
        dueDay: p.dueDay,
        parcels: p.parcels,
        paid: pagas,
        dot: Fin.cor(p.category),
        tint: Fin.tint(Fin.cor(p.category)),
        perFmt: Fin.fmt(valorParcela),
        totalFmt: Fin.fmt(p.total),
        remainFmt: Fin.fmt(valorParcela * faltam),
        pct: Math.round(pagas / p.parcels * 100)
      };
    });
  }

  /* ---------- lançamentos ---------- */

  function verTx(t) {
    var d = Fin.paraData(t.date);
    var entrada = t.type === 'in';
    return {
      id: t.id,
      note: t.note || t.category,
      meta: t.category + ' · ' + d.getDate() + ' ' + Fin.MESES[d.getMonth()] +
            (t.fixed ? ' · fixo' : ''),
      amountFmt: (entrada ? '+ ' : '− ') + Fin.fmt(t.amount),
      amountClass: entrada ? 'in' : 'out',
      dot: Fin.cor(t.category),
      tint: Fin.tint(Fin.cor(t.category))
    };
  }

  function agruparPorMes(txOrdenado) {
    var mapa = {};
    txOrdenado.forEach(function (t) {
      var d = Fin.paraData(t.date);
      var chave = Fin.indiceMes(d);
      if (!mapa[chave]) {
        mapa[chave] = {
          ym: chave,
          label: Fin.MESES[d.getMonth()] + ' de ' + d.getFullYear(),
          items: [], total: 0
        };
      }
      mapa[chave].items.push(verTx(t));
      mapa[chave].total += t.type === 'in' ? t.amount : -t.amount;
    });
    return Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return b.ym - a.ym; })
      .map(function (g) {
        return {
          label: g.label,
          items: g.items,
          totalFmt: (g.total >= 0 ? '+ ' : '− ') + Fin.fmt(Math.abs(g.total)),
          totalClass: g.total >= 0 ? 'in' : 'out'
        };
      });
  }

  /* ---------- previsão de 12 meses ---------- */

  function previsao(dados, saldoAtual, mesAtual) {
    var tx = dados.tx;

    var fixasEntram = tx.filter(function (t) { return t.fixed && t.type === 'in'; })
                        .reduce(function (a, t) { return a + t.amount; }, 0);
    var fixasSaem   = tx.filter(function (t) { return t.fixed && t.type === 'out'; })
                        .reduce(function (a, t) { return a + t.amount; }, 0);

    // Média de gastos variáveis por mês: total variável ÷ meses com movimento.
    var variaveis = tx.filter(function (t) { return !t.fixed && t.type === 'out'; });
    var mesesComDados = new Set(tx.map(function (t) {
      return Fin.indiceMes(Fin.paraData(t.date));
    })).size;
    var mediaVar = variaveis.reduce(function (a, t) { return a + t.amount; }, 0) /
                   Math.max(1, mesesComDados);

    var acumulado = saldoAtual;
    var pontos = [{ label: 'Hoje', v: saldoAtual }];
    var detalhe = [];

    for (var i = 0; i < 12; i++) {
      var mes = mesAtual + 1 + i;
      var inst = parcelasNoMes(dados.parcelas, mes);
      acumulado += fixasEntram - fixasSaem - inst - mediaVar;
      var rotulo = Fin.rotuloMes(mes);
      pontos.push({ label: rotulo, v: acumulado });
      detalhe.push({
        label: rotulo,
        incomeFmt: '+ ' + Fin.fmt0(fixasEntram),
        fixedFmt:  '− ' + Fin.fmt0(fixasSaem),
        instFmt:   '− ' + Fin.fmt0(inst),
        varFmt:    '− ' + Fin.fmt0(mediaVar),
        balanceFmt: Fin.fmt(acumulado),
        negative: acumulado < 0
      });
    }

    var valores = pontos.map(function (p) { return p.v; });
    var min = Math.min.apply(null, valores.concat([0]));
    var max = Math.max.apply(null, valores.concat([0]));
    var faixa = (max - min) || 1;

    var barras = pontos.map(function (p) {
      return {
        label: p.label,
        // 10% de altura mínima para a barra nunca sumir.
        alturaPct: 10 + Math.round((p.v - min) / faixa * 88),
        cor:  p.v < 0 ? '#e07a5f' : '#7fd6a6',
        suave: p.v < 0 ? '#f0cfc4' : '#cfe9da'
      };
    });

    return {
      barras: barras,
      detalhe: detalhe,
      total: acumulado,
      mediaVar: mediaVar,
      semDados: fixasEntram === 0 && fixasSaem === 0 && mediaVar === 0 &&
                dados.parcelas.length === 0
    };
  }

  /* ---------- categorias ---------- */

  function verCategorias(tx) {
    var soma = {};
    tx.filter(function (t) { return t.type === 'out'; }).forEach(function (t) {
      soma[t.category] = (soma[t.category] || 0) + t.amount;
    });
    var maior = Math.max.apply(null, [1].concat(Object.keys(soma).map(function (k) {
      return soma[k];
    })));
    return Fin.CATS.map(function (c) {
      var v = soma[c.name] || 0;
      return {
        name: c.name,
        color: c.color,
        totalFmt: Fin.fmt(v),
        usada: v > 0,
        pct: Math.round(v / maior * 100),
        _v: v
      };
    }).sort(function (a, b) { return b._v - a._v; });
  }

  /* ---------- metas ---------- */

  function verMetas(goals) {
    return goals.map(function (g) {
      return {
        id: g.id,
        name: g.name,
        targetFmt: Fin.fmt(g.target),
        savedFmt: Fin.fmt(g.saved),
        remainFmt: Fin.fmt(Math.max(0, g.target - g.saved)),
        pct: g.target ? Math.min(100, Math.round(g.saved / g.target * 100)) : 0
      };
    });
  }

  /* ---------- entrada única ---------- */

  Fin.calcular = function (dados) {
    var agora = new Date();
    var mesAtual = Fin.indiceMes(agora);
    var hora = agora.getHours();

    var s = saldo(dados.tx);
    var mes = totaisDoMes(dados.tx, mesAtual);
    var ordenado = dados.tx.slice().sort(function (a, b) { return b.id - a.id; });
    var proj = previsao(dados, s, mesAtual);

    return {
      saudacao: hora < 12 ? 'Bom dia 👋' : hora < 18 ? 'Boa tarde 👋' : 'Boa noite 👋',

      saldo: s,
      saldoFmt: Fin.fmt(s),
      saldoNegativo: s < 0,
      entradasMesFmt: '+ ' + Fin.fmt(mes.entradas),
      saidasMesFmt: '− ' + Fin.fmt(mes.saidas),

      temTx: dados.tx.length > 0,
      recentes: ordenado.slice(0, 6).map(verTx),
      historico: agruparPorMes(ordenado),

      temParcelas: dados.parcelas.length > 0,
      qtdParcelas: dados.parcelas.length,
      parcelas: verParcelas(dados.parcelas, mesAtual),
      parcelasMesFmt: Fin.fmt(parcelasNoMes(dados.parcelas, mesAtual)),

      temMetas: dados.goals.length > 0,
      metas: verMetas(dados.goals),

      categorias: verCategorias(dados.tx),
      previsao: proj
    };
  };

})(window.Fin);
