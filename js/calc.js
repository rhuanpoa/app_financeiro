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

  /* ---------- lançamentos que se repetem todo mês ---------- */

  // Dois registros são o mesmo compromisso mensal quando têm o mesmo tipo,
  // a mesma categoria e a mesma descrição.
  function chaveFixo(t) {
    return t.type + '|' + t.category + '|' + String(t.note || '').trim().toLowerCase();
  }

  // Um "repete todo mês" vale UMA vez por mês, não uma vez por registro.
  // Sem isso, marcar o salário como fixo em agosto e de novo em setembro
  // faria o app achar que você passou a ganhar o dobro — e a previsão
  // crescia sozinha a cada mês de uso.
  Fin.fixosMensais = function (tx) {
    var porChave = {};
    tx.forEach(function (t) {
      if (!t.fixed) return;
      var k = chaveFixo(t);
      // fica com a ocorrência mais recente: é ela que reflete o valor atual
      if (!porChave[k] || t.date > porChave[k].date) porChave[k] = t;
    });
    return Object.keys(porChave).map(function (k) { return porChave[k]; });
  };

  /* ---------- resumo de um mês ----------

     Separa o que JÁ aconteceu do que ainda está PROGRAMADO:

     - já feito     → lançamentos do mês com data até hoje
     - programado   → lançamentos com data futura dentro do mês
                    + os "repete todo mês" que ainda não apareceram nele
                    + as parcelas que vencem no mês

     Num mês passado nada fica programado: tudo que ia acontecer já
     aconteceu. Num mês futuro nada está feito.                        */

  function resumoDoMes(dados, mes, mesAtual, hoje) {
    var doMes = dados.tx.filter(function (t) {
      return Fin.indiceMes(Fin.paraData(t.date)) === mes;
    });

    var feitoIn = 0, feitoOut = 0, progIn = 0, progOut = 0;

    doMes.forEach(function (t) {
      var jaAconteceu = t.date <= hoje;
      if (t.type === 'in') {
        if (jaAconteceu) feitoIn += t.amount; else progIn += t.amount;
      } else {
        if (jaAconteceu) feitoOut += t.amount; else progOut += t.amount;
      }
    });

    var parcelasDoMes = 0;

    if (mes >= mesAtual) {
      var jaNoMes = {};
      doMes.forEach(function (t) { jaNoMes[chaveFixo(t)] = true; });

      Fin.fixosMensais(dados.tx).forEach(function (f) {
        if (jaNoMes[chaveFixo(f)]) return;      // já foi lançado neste mês
        if (f.type === 'in') progIn += f.amount; else progOut += f.amount;
      });

      // Parcelas não viram lançamento, então entram sempre como programadas.
      parcelasDoMes = parcelasNoMes(dados.parcelas, mes);
      progOut += parcelasDoMes;
    }

    return {
      feitoIn: feitoIn, feitoOut: feitoOut,
      progIn: progIn, progOut: progOut,
      feitoInFmt: Fin.fmt(feitoIn), feitoOutFmt: Fin.fmt(feitoOut),
      progInFmt: Fin.fmt(progIn), progOutFmt: Fin.fmt(progOut),
      parcelasFmt: Fin.fmt(parcelasDoMes),
      temParcelas: parcelasDoMes > 0,
      // sobra prevista do mês, contando o que ainda vai acontecer
      previstoFmt: Fin.fmt((feitoIn + progIn) - (feitoOut + progOut)),
      previstoNegativo: (feitoIn + progIn) - (feitoOut + progOut) < 0,
      temAlgo: doMes.length > 0 || progIn > 0 || progOut > 0,
      lancamentos: doMes
    };
  }

  /* ---------- previsão de 12 meses ---------- */

  function previsao(dados, saldoAtual, mesAtual) {
    var tx = dados.tx;

    // Uma ocorrência por compromisso, não uma por registro: senão a
    // previsão inflaria a cada mês que você remarcasse o mesmo fixo.
    var fixos = Fin.fixosMensais(tx);
    var fixosIn  = fixos.filter(function (t) { return t.type === 'in'; });
    var fixosOut = fixos.filter(function (t) { return t.type === 'out'; });

    var soma = function (l) { return l.reduce(function (a, t) { return a + t.amount; }, 0); };
    var fixasEntram = soma(fixosIn);
    var fixasSaem   = soma(fixosOut);

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

    // O que compõe cada mês, para a linha poder ser aberta na tela.
    var listaFixos = function (l) {
      return l.map(function (t) {
        return { nome: t.note || t.category, categoria: t.category,
                 cor: Fin.cor(t.category), valorFmt: Fin.fmt(t.amount) };
      }).sort(function (a, b) { return a.nome.localeCompare(b.nome); });
    };

    for (var i = 0; i < 12; i++) {
      var mes = mesAtual + 1 + i;
      var inst = parcelasNoMes(dados.parcelas, mes);
      acumulado += fixasEntram - fixasSaem - inst - mediaVar;
      var rotulo = Fin.rotuloMes(mes);
      pontos.push({ label: rotulo, v: acumulado });

      detalhe.push({
        ym: mes,
        label: rotulo,
        labelLongo: Fin.MESES[mes % 12] + ' de ' + Math.floor(mes / 12),
        incomeFmt: '+ ' + Fin.fmt0(fixasEntram),
        fixedFmt:  '− ' + Fin.fmt0(fixasSaem),
        instFmt:   '− ' + Fin.fmt0(inst),
        varFmt:    '− ' + Fin.fmt0(mediaVar),
        balanceFmt: Fin.fmt(acumulado),
        negative: acumulado < 0,

        entradasFixas: listaFixos(fixosIn),
        saidasFixas: listaFixos(fixosOut),
        parcelas: dados.parcelas.map(function (p) {
          var partes = String(p.firstDue).split('-').map(Number);
          var primeiro = partes[0] * 12 + (partes[1] - 1);
          var n = mes - primeiro;
          if (n < 0 || n >= p.parcels) return null;
          return {
            nome: p.description,
            categoria: p.category,
            cor: Fin.cor(p.category),
            valorFmt: Fin.fmt(p.total / p.parcels),
            posicao: (n + 1) + ' de ' + p.parcels
          };
        }).filter(Boolean),
        mediaVarFmt: Fin.fmt(mediaVar)
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

    // Os gráficos olham TODOS os lançamentos, não só os que vieram de
    // extrato: quem digitou um gasto na mão também quer vê-lo aqui.
    // Com uma conta escolhida, o filtro vale para eles também.
    var baseGraficos = conta ? tx.filter(function (t) { return t.conta === conta; }) : tx;

    var entradas = 0, saidas = 0;
    filtrados.forEach(function (t) {
      if (t.type === 'in') entradas += t.amount; else saidas += t.amount;
    });

    var ordenado = filtrados.slice().sort(function (a, b) { return b.id - a.id; });

    return {
      contas: contas,
      total: filtrados.length,
      // Gráficos da tela de Movimentações: todos os lançamentos.
      catsSaida: porCategoria(baseGraficos, 'out', 9),
      catsEntrada: porCategoria(baseGraficos, 'in', 7),
      escopoGraficos: conta || 'Todos os lançamentos',
      qtdGraficos: baseGraficos.length,
      temImportados: doExtrato.length > 0,
      entradasFmt: '+ ' + Fin.fmt(entradas),
      saidasFmt: '− ' + Fin.fmt(saidas),
      saldoFmt: Fin.fmt(entradas - saidas),
      saldoNegativo: entradas - saidas < 0,
      grupos: agruparPorMes(ordenado)
    };
  }

  /* ---------- entrada única ---------- */

  Fin.calcular = function (dados, contaFiltro, mesRef) {
    var agora = new Date();
    var mesAtual = Fin.indiceMes(agora);
    var hora = agora.getHours();
    var hoje = Fin.hojeISO();

    // Mês que a tela inicial está mostrando (padrão: o corrente).
    // Nome próprio: `mes` já é usado abaixo para os totais do mês.
    var mesSel = (typeof mesRef === 'number') ? mesRef : mesAtual;

    var s = saldo(dados.tx);
    var mes = totaisDoMes(dados.tx, mesAtual);

    var resumoMes = resumoDoMes(dados, mesSel, mesAtual, hoje);
    var doMes = resumoMes.lancamentos;
    var ordenado = dados.tx.slice().sort(function (a, b) { return b.id - a.id; });
    var proj = previsao(dados, s, mesAtual);

    return {
      saudacao: hora < 12 ? 'Bom dia 👋' : hora < 18 ? 'Boa tarde 👋' : 'Boa noite 👋',

      saldo: s,
      saldoFmt: Fin.fmt(s),
      saldoNegativo: s < 0,
      entradasMesFmt: '+ ' + Fin.fmt(mes.entradas),
      saidasMesFmt: '− ' + Fin.fmt(mes.saidas),

      // Painel do Início, sempre referente ao mês escolhido no seletor
      mesRef: mesSel,
      mesLabel: Fin.MESES[((mesSel % 12) + 12) % 12] + ' de ' + Math.floor(mesSel / 12),
      mesCurto: Fin.MESES[((mesSel % 12) + 12) % 12],
      ehMesAtual: mesSel === mesAtual,
      podeAvancar: mesSel < mesAtual + 12,
      resumoMes: resumoMes,
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
