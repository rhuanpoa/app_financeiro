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

  // Totais por categoria de um tipo ('out' = gastos, 'in' = recebido).
  // A barra de cada linha é proporcional à maior categoria do grupo.
  function verCategorias(tx, tipo) {
    var soma = {};
    tx.filter(function (t) { return t.type === tipo; }).forEach(function (t) {
      soma[t.category] = (soma[t.category] || 0) + t.amount;
    });
    var maior = Math.max.apply(null, [1].concat(Object.keys(soma).map(function (k) {
      return soma[k];
    })));
    return Fin.catsDe(tipo).map(function (c) {
      var v = soma[c.name] || 0;
      return {
        name: c.name,
        color: c.color,
        custom: !!c.custom,
        id: c.id,
        emUso: v > 0,
        totalFmt: Fin.fmt(v),
        pct: Math.round(v / maior * 100),
        _v: v
      };
    }).sort(function (a, b) { return b._v - a._v; });
  }

  /* ---------- ranking por categoria (base dos gráficos) ----------

     Barras horizontais ordenadas da maior para a menor: a mesma figura
     responde "onde gastei mais" (topo) e "onde gastei menos" (base).

     A cor da barra é uma só por gráfico, e não uma por categoria: as 12
     cores do app não passam nos testes de daltonismo entre si (duas delas
     ficam com ΔE 1.0 sob deuteranopia). Quem carrega a identidade aqui é
     o nome escrito em toda linha; o pontinho colorido só reforça.        */

  function porCategoria(tx, tipo, limite) {
    var soma = {}, total = 0;

    tx.forEach(function (t) {
      if (t.type !== tipo) return;
      soma[t.category] = (soma[t.category] || 0) + t.amount;
      total += t.amount;
    });

    var linhas = Object.keys(soma).map(function (nome) {
      return { name: nome, valor: soma[nome], color: Fin.cor(nome) };
    }).sort(function (a, b) { return b.valor - a.valor; });

    // Cauda longa vira uma linha só, em vez de virar ruído.
    if (limite && linhas.length > limite) {
      var resto = linhas.slice(limite - 1);
      var somaResto = resto.reduce(function (a, c) { return a + c.valor; }, 0);
      linhas = linhas.slice(0, limite - 1);
      linhas.push({
        name: 'Outras (' + resto.length + ')',
        valor: somaResto,
        color: '#8a8c80',
        agrupada: true
      });
    }

    var maior = linhas.reduce(function (m, l) { return Math.max(m, l.valor); }, 0) || 1;

    return {
      tipo: tipo,
      total: total,
      totalFmt: Fin.fmt(total),
      temDados: linhas.length > 0,
      qtd: linhas.length,
      linhas: linhas.map(function (l) {
        return {
          name: l.name,
          color: l.color,
          agrupada: !!l.agrupada,
          valorFmt: Fin.fmt(l.valor),
          // largura relativa à maior categoria, que é como a tela de
          // Categorias já desenha — mantém a leitura consistente
          larguraPct: Math.max(2, Math.round(l.valor / maior * 100)),
          sharePct: total ? Math.round(l.valor / total * 100) : 0
        };
      })
    };
  }

  Fin.porCategoria = porCategoria;

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

  /* ---------- movimentações vindas de extrato ---------- */

  function verPendentes(pendentes) {
    return pendentes.slice()
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; })
      .map(function (p) {
        var d = Fin.paraData(p.date);
        var entrada = p.type === 'in';
        return {
          id: p.id,
          memo: p.memo,
          category: p.category,
          type: p.type,
          meta: d.getDate() + ' ' + Fin.MESES[d.getMonth()] + ' · ' + p.conta,
          amountFmt: (entrada ? '+ ' : '− ') + Fin.fmt(p.amount),
          amountClass: entrada ? 'in' : 'out'
        };
      });
  }

  // Lançamentos que vieram de extrato, já confirmados.
  function verImportados(tx, conta) {
    var doExtrato = tx.filter(function (t) { return t.origem === 'extrato'; });

    var contas = [];
    doExtrato.forEach(function (t) {
      if (t.conta && contas.indexOf(t.conta) === -1) contas.push(t.conta);
    });

    var filtrados = conta ? doExtrato.filter(function (t) { return t.conta === conta; }) : doExtrato;

    var entradas = 0, saidas = 0;
    filtrados.forEach(function (t) {
      if (t.type === 'in') entradas += t.amount; else saidas += t.amount;
    });

    var ordenado = filtrados.slice().sort(function (a, b) { return b.id - a.id; });

    return {
      contas: contas,
      total: filtrados.length,
      // Gráficos da tela de Movimentações, sobre o que está listado nela
      // (respeitando o filtro de conta).
      catsSaida: porCategoria(filtrados, 'out', 9),
      catsEntrada: porCategoria(filtrados, 'in', 7),
      temImportados: doExtrato.length > 0,
      entradasFmt: '+ ' + Fin.fmt(entradas),
      saidasFmt: '− ' + Fin.fmt(saidas),
      saldoFmt: Fin.fmt(entradas - saidas),
      saldoNegativo: entradas - saidas < 0,
      grupos: agruparPorMes(ordenado)
    };
  }

  /* ---------- entrada única ---------- */

  Fin.calcular = function (dados, contaFiltro) {
    var agora = new Date();
    var mesAtual = Fin.indiceMes(agora);
    var hora = agora.getHours();

    var s = saldo(dados.tx);
    var mes = totaisDoMes(dados.tx, mesAtual);

    var doMes = dados.tx.filter(function (t) {
      return Fin.indiceMes(Fin.paraData(t.date)) === mesAtual;
    });
    var ordenado = dados.tx.slice().sort(function (a, b) { return b.id - a.id; });
    var proj = previsao(dados, s, mesAtual);

    return {
      saudacao: hora < 12 ? 'Bom dia 👋' : hora < 18 ? 'Boa tarde 👋' : 'Boa noite 👋',

      saldo: s,
      saldoFmt: Fin.fmt(s),
      saldoNegativo: s < 0,
      entradasMesFmt: '+ ' + Fin.fmt(mes.entradas),
      saidasMesFmt: '− ' + Fin.fmt(mes.saidas),

      // Gráficos do Início: só o mês corrente, que é o que o painel conta.
      nomeDoMes: Fin.MESES[agora.getMonth()],
      mesSaida: porCategoria(doMes, 'out', 6),
      mesEntrada: porCategoria(doMes, 'in', 4),

      temTx: dados.tx.length > 0,
      recentes: ordenado.slice(0, 6).map(verTx),
      historico: agruparPorMes(ordenado),

      temParcelas: dados.parcelas.length > 0,
      qtdParcelas: dados.parcelas.length,
      parcelas: verParcelas(dados.parcelas, mesAtual),
      parcelasMesFmt: Fin.fmt(parcelasNoMes(dados.parcelas, mesAtual)),

      temMetas: dados.goals.length > 0,
      metas: verMetas(dados.goals),

      catsSaida: verCategorias(dados.tx, 'out'),
      catsEntrada: verCategorias(dados.tx, 'in'),

      pendentes: verPendentes(dados.pendentes),
      qtdPendentes: dados.pendentes.length,
      temPendentes: dados.pendentes.length > 0,
      // Só dá para confirmar quando todas tiverem categoria escolhida.
      faltaCategoria: dados.pendentes.filter(function (p) { return !p.category; }).length,
      movimentos: verImportados(dados.tx, contaFiltro),
      previsao: proj
    };
  };

})(window.Fin);
