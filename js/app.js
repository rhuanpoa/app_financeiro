/* =========================================================
   app.js — estado, navegação e eventos.
   Único arquivo que toca no DOM de verdade.
   ========================================================= */

(function (Fin) {
  'use strict';

  var view    = document.getElementById('view');
  var toastEl = document.getElementById('toast');
  var drawer  = document.getElementById('drawer');
  var overlay = document.getElementById('overlay');
  var tabbar  = document.querySelector('.tabbar');

  /* ---------------------------------------------------------
     Estado
     --------------------------------------------------------- */

  var dados = Fin.carregar();
  Fin.usarCategorias(dados.cats);

  var estado = {
    screen: 'dash',
    addType: 'out',
    contaFiltro: '',
    // Mês que o painel inicial mostra. null = o mês corrente.
    mesRef: null,
    // Mês aberto na tela de Previsão (índice absoluto), ou null.
    mesAberto: null,
    // Meta sendo editada
    metaEditId: null,
    forms: Fin.formsEmBranco()
  };

  // Qual item do menu lateral acende em cada tela.
  var ITEM_DO_MENU = {
    dash: 'dash',
    movimentacoes: 'movimentacoes', importar: 'importar',
    proj: 'proj',
    hist: 'hist',
    categorias: 'categorias', categoriaAdd: 'categorias',
    metas: 'metas', metaAdd: 'metas', metaEdit: 'metas',
    parcelas: 'parcelas', parcelaAdd: 'parcelas'
  };

  // Qual aba da barra de baixo acende. As telas que não têm aba própria
  // (Parcelas, Histórico, Metas…) ficam sem nenhuma acesa — elas moram no menu.
  var ABA_DA_TELA = {
    dash: 'dash',
    proj: 'proj',
    movimentacoes: 'movimentacoes', importar: 'movimentacoes'
  };

  /* ---------------------------------------------------------
     Renderização
     --------------------------------------------------------- */

  // `preservarScroll` para ações que mudam algo no meio da página (abrir um
  // mês, trocar o filtro): saltar para o topo faria perder o lugar.
  function render(preservarScroll) {
    var posicao = window.scrollY;
    var calculado = Fin.calcular(dados, estado.contaFiltro, estado.mesRef);
    var tela = Fin.telas[estado.screen] || Fin.telas.dash;

    view.innerHTML = tela(calculado, estado);

    if (preservarScroll) {
      window.scrollTo(0, posicao);
    } else {
      view.scrollTop = 0;
      window.scrollTo(0, 0);
    }

    var aba = ABA_DA_TELA[estado.screen];
    tabbar.querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('on', !!b.dataset.nav && b.dataset.nav === aba);
    });

    var ativo = ITEM_DO_MENU[estado.screen];
    drawer.querySelectorAll('.drawer-item').forEach(function (b) {
      b.classList.toggle('on', b.dataset.nav === ativo);
    });

    // Cabeçalho do menu: saldo sempre à mão, e o contador de pendências
    // repetido na barra de baixo.
    var saldoEl = document.getElementById('drawer-saldo');
    saldoEl.textContent = calculado.saldoFmt;
    saldoEl.classList.toggle('negative', calculado.saldoNegativo);

    [document.getElementById('drawer-badge'),
     document.getElementById('tab-badge')].forEach(function (b) {
      b.hidden = !calculado.temPendentes;
      b.textContent = calculado.qtdPendentes;
    });
  }

  /* ---------------------------------------------------------
     Menu lateral
     --------------------------------------------------------- */

  var menuAberto = false;

  function abrirMenu() {
    if (menuAberto) return;
    menuAberto = true;
    drawer.hidden = false;
    overlay.hidden = false;
    // Ler offsetWidth força o navegador a calcular o layout agora, com o
    // menu ainda fora da tela. Sem isso a transição de entrada não roda.
    // (Aqui não serve requestAnimationFrame: se o menu fosse fechado antes
    // do quadro chegar, o callback atrasado reabriria ele sozinho.)
    void drawer.offsetWidth;
    drawer.classList.add('on');
    overlay.classList.add('on');
    document.body.style.overflow = 'hidden';
  }

  function fecharMenu() {
    if (!menuAberto) return;
    menuAberto = false;
    drawer.classList.remove('on');
    overlay.classList.remove('on');
    document.body.style.overflow = '';
    setTimeout(function () {
      if (!menuAberto) { drawer.hidden = true; overlay.hidden = true; }
    }, 240);
  }

  function persistir() {
    // As categorias próprias precisam estar visíveis para Fin.cor()
    // antes de qualquer novo render.
    Fin.usarCategorias(dados.cats);
    if (!Fin.salvar(dados)) {
      toast('Não consegui salvar neste navegador');
    }
  }

  function irPara(tela, push) {
    fecharMenu();
    estado.screen = tela;
    if (push !== false) {
      history.pushState({ screen: tela }, '', '#' + tela);
    }
    render();
  }

  var timerToast;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  /* ---------------------------------------------------------
     Ações de gravação
     --------------------------------------------------------- */

  function salvarLancamento() {
    var tipo = estado.addType;
    var f = estado.forms[tipo];
    var valor = Fin.parse(f.amount);

    if (!valor || !f.category) { toast('Preencha valor e categoria'); return; }

    dados.tx.push({
      id: Date.now(),
      type: tipo,
      amount: valor,
      category: f.category,
      note: (f.note || '').trim(),
      date: f.date || Fin.hojeISO(),
      fixed: !!f.fixed
    });

    estado.forms[tipo] = Fin.formsEmBranco()[tipo];
    persistir();
    irPara('dash');
    toast(tipo === 'out' ? 'Gasto registrado ✓' : 'Entrada registrada ✓');
  }

  function salvarParcela() {
    var f = estado.forms.parcela;
    var total = Fin.parse(f.total);
    var n = parseInt(f.parcels, 10) || 0;

    if (!total || !n || !f.category) { toast('Preencha valor, parcelas e categoria'); return; }

    dados.parcelas.push({
      id: Date.now(),
      description: (f.description || '').trim() || 'Compra parcelada',
      total: total,
      parcels: n,
      dueDay: Math.min(31, Math.max(1, parseInt(f.dueDay, 10) || 1)),
      firstDue: f.firstDue || Fin.hojeISO().slice(0, 7),
      card: (f.card || '').trim(),
      category: f.category
    });

    estado.forms.parcela = Fin.formsEmBranco().parcela;
    persistir();
    irPara('parcelas');
    toast('Compra parcelada cadastrada ✓');
  }

  function salvarMeta() {
    var f = estado.forms.goal;
    var alvo = Fin.parse(f.target);

    if (!(f.name || '').trim() || !alvo) { toast('Preencha nome e objetivo'); return; }

    dados.goals.push({
      id: Date.now(),
      name: f.name.trim(),
      target: alvo,
      saved: Fin.parse(f.saved)
    });

    estado.forms.goal = Fin.formsEmBranco().goal;
    persistir();
    irPara('metas');
    toast('Meta criada ✓');
  }

  function salvarCategoria() {
    var f = estado.forms.categoria;
    var nome = (f.name || '').trim();

    if (!nome) { toast('Dê um nome à categoria'); return; }
    if (Fin.nomeEmUso(nome, f.type)) { toast('Já existe uma categoria com esse nome'); return; }

    dados.cats.push({
      id: Date.now(),
      name: nome,
      color: f.color || Fin.PALETA[0],
      type: f.type === 'in' ? 'in' : 'out'
    });

    estado.forms.categoria = Fin.formsEmBranco().categoria;
    persistir();
    irPara('categorias');
    toast('Categoria criada ✓');
  }

  function apagarCategoria(id) {
    var cat = dados.cats.find(function (c) { return c.id === id; });
    if (!cat) return;

    // Apagar uma categoria em uso deixaria lançamentos órfãos, sem cor
    // e sem aparecer em lugar nenhum. Melhor barrar e explicar.
    var emUso = dados.tx.some(function (t) { return t.category === cat.name; }) ||
                dados.parcelas.some(function (p) { return p.category === cat.name; });
    if (emUso) { toast('Categoria em uso — não dá para apagar'); return; }

    if (!confirm('Apagar a categoria "' + cat.name + '"?')) return;

    dados.cats = dados.cats.filter(function (c) { return c.id !== id; });
    persistir();
    render();
    toast('Categoria apagada');
  }

  function abrirEdicaoDeMeta(id) {
    var g = dados.goals.find(function (x) { return x.id === id; });
    if (!g) return;

    estado.metaEditId = id;
    // Valores vão para o formulário com vírgula, como o app escreve.
    estado.forms.goalEdit = {
      name: g.name,
      target: String(g.target).replace('.', ','),
      saved: String(g.saved).replace('.', ','),
      valor: ''
    };
    irPara('metaEdit');
  }

  function salvarEdicaoDeMeta() {
    var f = estado.forms.goalEdit;
    var nome = (f.name || '').trim();
    var alvo = Fin.parse(f.target);

    if (!nome) { toast('Dê um nome à meta'); return; }
    if (!alvo) { toast('Informe o objetivo'); return; }

    var guardado = Math.max(0, Fin.parse(f.saved));

    dados.goals = dados.goals.map(function (g) {
      return g.id === estado.metaEditId
        ? Object.assign({}, g, { name: nome, target: alvo, saved: guardado })
        : g;
    });

    persistir();
    irPara('metas');
    toast('Meta atualizada ✓');
  }

  // sinal = +1 para guardar, -1 para retirar
  function movimentarMeta(sinal) {
    var f = estado.forms.goalEdit;
    var valor = Fin.parse(f.valor);

    if (!valor || valor <= 0) { toast('Informe quanto quer movimentar'); return; }

    var g = dados.goals.find(function (x) { return x.id === estado.metaEditId; });
    if (!g) return;

    // Não deixa o guardado ficar negativo nem passar do objetivo.
    var novo = Math.min(g.target, Math.max(0, g.saved + sinal * valor));
    var mudou = novo - g.saved;

    if (!mudou) {
      toast(sinal > 0 ? 'A meta já está completa' : 'Não há saldo para retirar');
      return;
    }

    dados.goals = dados.goals.map(function (x) {
      return x.id === g.id ? Object.assign({}, x, { saved: novo }) : x;
    });

    // O formulário reflete o novo saldo e limpa o campo de movimento.
    estado.forms.goalEdit.saved = String(novo).replace('.', ',');
    estado.forms.goalEdit.valor = '';

    persistir();
    render();
    toast((sinal > 0 ? 'Guardado ' : 'Retirado ') + Fin.fmt(Math.abs(mudou)) + ' ✓');
  }

  function guardarNaMeta(id, valor) {
    dados.goals = dados.goals.map(function (g) {
      return g.id === id ? Object.assign({}, g, { saved: Math.min(g.target, g.saved + valor) }) : g;
    });
    persistir();
    render();
    toast('R$ ' + valor + ' guardado ✓');
  }

  function apagar(lista, id, msg) {
    dados[lista] = dados[lista].filter(function (x) { return x.id !== id; });
    persistir();
    render();
    toast(msg);
  }

  /* ---------------------------------------------------------
     Backup — a única cópia dos dados está neste aparelho
     --------------------------------------------------------- */

  function exportar() {
    var blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'financas-' + Fin.hojeISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup gerado ✓');
  }

  function importar() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', function () {
      var arquivo = input.files && input.files[0];
      if (!arquivo) return;
      var leitor = new FileReader();
      leitor.onload = function () {
        try {
          var d = JSON.parse(leitor.result);
          if (!d || !Array.isArray(d.tx)) throw new Error('formato');
          if (!confirm('Substituir os dados atuais pelo backup?')) return;
          dados = {
            tx: d.tx,
            parcelas: Array.isArray(d.parcelas) ? d.parcelas : [],
            goals: Array.isArray(d.goals) ? d.goals : [],
            cats: Array.isArray(d.cats) ? d.cats : [],
            pendentes: Array.isArray(d.pendentes) ? d.pendentes : []
          };
          persistir();
          irPara('dash');
          toast('Backup restaurado ✓');
        } catch (e) {
          toast('Arquivo inválido');
        }
      };
      leitor.readAsText(arquivo);
    });
    input.click();
  }

  /* ---------------------------------------------------------
     Extrato do banco
     O arquivo é lido no próprio aparelho; nada sai daqui.
     --------------------------------------------------------- */

  function escolherExtrato() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ofx,.qfx,.csv,.txt,.pdf,text/csv,text/plain,application/pdf';

    input.addEventListener('change', function () {
      var arquivo = input.files && input.files[0];
      if (!arquivo) return;

      var leitor = new FileReader();
      leitor.onerror = function () { toast('Não consegui ler o arquivo'); };

      leitor.onload = function () {
        // PDF exige baixar a biblioteca de leitura, o que demora um pouco
        // na primeira vez — avisa para não parecer travado.
        if (Fin.ehPDF(leitor.result)) toast('Lendo o PDF…');

        Fin.lerArquivo(leitor.result, arquivo.name)
          .then(function (lido) {
            if (!lido.itens.length) {
              toast('Não achei movimentações nesse arquivo');
              return;
            }

            var res = Fin.filtrarNovos(lido.itens, dados);

            if (!res.novos.length) {
              toast(res.repetidos + ' movimentação(ões) já importada(s)');
              return;
            }

            dados.pendentes = dados.pendentes.concat(res.novos);
            persistir();
            irPara('movimentacoes');
            toast(res.novos.length + ' nova(s) do ' + lido.formato +
                  (res.repetidos ? ' · ' + res.repetidos + ' repetida(s)' : '') + ' ✓');
          })
          .catch(function (e) {
            toast(e && e.message ? e.message : 'Arquivo não reconhecido');
          });
      };

      // ArrayBuffer, não texto: o formato e o encoding são decididos
      // depois, olhando os bytes.
      leitor.readAsArrayBuffer(arquivo);
    });

    input.click();
  }

  function confirmarPendentes() {
    if (!dados.pendentes.length) return;

    var semCategoria = dados.pendentes.filter(function (p) { return !p.category; }).length;
    if (semCategoria &&
        !confirm(semCategoria + ' movimentação(ões) sem categoria vão entrar como "Outros". Continuar?')) {
      return;
    }

    var qtd = dados.pendentes.length;

    dados.pendentes.forEach(function (p) {
      dados.tx.push({
        id: p.id,
        type: p.type,
        amount: p.amount,
        category: p.category || 'Outros',
        note: p.memo,
        date: p.date,
        fixed: false,
        origem: 'extrato',
        conta: p.conta,
        fitid: p.fitid
      });
    });

    dados.pendentes = [];
    persistir();
    render();
    toast(qtd + ' movimentação(ões) no caixa ✓');
  }

  function descartarPendentes() {
    if (!dados.pendentes.length) return;
    if (!confirm('Descartar as ' + dados.pendentes.length + ' movimentações não confirmadas?')) return;
    dados.pendentes = [];
    persistir();
    render();
    toast('Movimentações descartadas');
  }

  /* ---------------------------------------------------------
     Eventos — um só ouvinte para tudo (delegação)
     --------------------------------------------------------- */

  document.addEventListener('click', function (ev) {
    var alvo = ev.target.closest('[data-nav],[data-action]');
    if (!alvo) return;

    var acao = alvo.dataset.action;
    var id = alvo.dataset.id ? Number(alvo.dataset.id) : null;

    if (!acao && alvo.dataset.nav) { irPara(alvo.dataset.nav); return; }

    switch (acao) {
      case 'add-out':
      case 'add-in':
        estado.addType = acao === 'add-in' ? 'in' : 'out';
        irPara('add');
        break;

      case 'set-type':
        estado.addType = alvo.dataset.type;
        render();
        break;

      // Marca a categoria e redesenha só a faixa de chips, para não
      // perder o que já foi digitado nos outros campos.
      case 'pick-cat': {
        var form = alvo.dataset.form;
        estado.forms[form].category = alvo.dataset.cat;
        var faixa = view.querySelector('[data-chips="' + form + '"]');
        if (faixa) {
          faixa.querySelectorAll('.chip').forEach(function (c) {
            var ligado = c.dataset.cat === alvo.dataset.cat;
            var cor = c.dataset.color;
            c.classList.toggle('on', ligado);
            // Selecionado: borda e texto na cor da categoria, fundo translúcido.
            c.style.cssText = ligado
              ? 'border-color:' + cor + ';background:' + cor + '18;color:' + cor
              : '';
          });
        }
        break;
      }

      case 'toggle-fixed': {
        var f = estado.forms[estado.addType];
        f.fixed = !f.fixed;
        alvo.querySelector('.switch').classList.toggle('on', f.fixed);
        break;
      }

      // Troca o tipo da categoria nova: redesenha porque o texto de
      // exemplo e a dica do rodapé mudam junto.
      case 'set-cat-type':
        estado.forms.categoria.type = alvo.dataset.type;
        render();
        break;

      case 'pick-color': {
        estado.forms.categoria.color = alvo.dataset.color;
        var paleta = view.querySelector('[data-swatches]');
        if (paleta) {
          paleta.querySelectorAll('.swatch').forEach(function (s) {
            s.classList.toggle('on', s === alvo);
          });
        }
        break;
      }

      case 'save-tx':        salvarLancamento(); break;
      case 'save-parcela':   salvarParcela(); break;
      case 'save-goal':      salvarMeta(); break;
      case 'save-categoria': salvarCategoria(); break;
      case 'del-categoria':  apagarCategoria(id); break;

      case 'del-tx':      apagar('tx', id, 'Removido'); break;
      case 'del-parcela': apagar('parcelas', id, 'Compra removida'); break;
      case 'del-meta':
        if (!confirm('Apagar esta meta? O valor guardado nela some do registro.')) break;
        dados.goals = dados.goals.filter(function (g) { return g.id !== id; });
        persistir();
        // Se a meta apagada era a que estava aberta, não dá para ficar nela.
        if (estado.screen === 'metaEdit') irPara('metas'); else render();
        toast('Meta removida');
        break;

      case 'goal-add':
        guardarNaMeta(id, Number(alvo.dataset.amount));
        break;

      case 'editar-meta':      abrirEdicaoDeMeta(id); break;
      case 'salvar-meta-edit': salvarEdicaoDeMeta(); break;
      case 'meta-guardar':     movimentarMeta(1); break;
      case 'meta-retirar':     movimentarMeta(-1); break;

      case 'abrir-menu': abrirMenu(); break;
      case 'fechar-menu': fecharMenu(); break;

      case 'escolher-extrato':     escolherExtrato(); break;
      case 'confirmar-pendentes':  confirmarPendentes(); break;
      case 'descartar-pendentes':  descartarPendentes(); break;
      case 'del-pendente':         apagar('pendentes', id, 'Movimentação descartada'); break;

      case 'filtrar-conta':
        estado.contaFiltro = alvo.dataset.conta || '';
        render(true);
        break;

      // Navegação de mês no painel inicial. Guarda o índice absoluto do
      // mês (ano*12+mês), que faz a virada de dezembro sozinha.
      case 'mes-anterior':
      case 'mes-seguinte': {
        var atual = estado.mesRef === null ? Fin.indiceMes(new Date()) : estado.mesRef;
        estado.mesRef = atual + (acao === 'mes-seguinte' ? 1 : -1);
        render(true);
        break;
      }

      // Abre ou fecha o detalhe de um mês na Previsão
      case 'abrir-mes': {
        var ym = Number(alvo.dataset.ym);
        estado.mesAberto = estado.mesAberto === ym ? null : ym;
        render(true);
        break;
      }

      case 'exportar': exportar(); break;
      case 'importar-backup': importar(); break;

      case 'clear-all':
        if (confirm('Apagar TODOS os dados? Isso não pode ser desfeito.')) {
          dados = Fin.vazio();
          persistir();
          render();
          toast('Dados apagados');
        }
        break;
    }
  });

  // Campos de texto: guardam no estado sem redesenhar a tela,
  // senão o teclado do celular perderia o foco a cada letra.
  view.addEventListener('input', function (ev) {
    var el = ev.target;
    if (!el.dataset || !el.dataset.form || !el.dataset.field) return;

    estado.forms[el.dataset.form][el.dataset.field] = el.value;

    // Única exceção: a prévia do valor da parcela.
    if (el.dataset.form === 'parcela' &&
        (el.dataset.field === 'total' || el.dataset.field === 'parcels')) {
      var pv = document.getElementById('preview-parcela');
      if (pv) {
        var n = parseInt(estado.forms.parcela.parcels, 10) || 0;
        pv.textContent = n > 0 ? Fin.fmt(Fin.parse(estado.forms.parcela.total) / n) : '—';
      }
    }
  });

  // Categoria de uma movimentação do extrato: grava sem redesenhar a lista,
  // para não perder a rolagem no meio da revisão.
  view.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el.dataset || !el.dataset.pendente) return;

    var id = Number(el.dataset.pendente);
    var p = dados.pendentes.find(function (x) { return x.id === id; });
    if (!p) return;

    p.category = el.value;
    el.classList.toggle('vazio', !el.value);
    persistir();
  });

  overlay.addEventListener('click', fecharMenu);

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') fecharMenu();
  });

  // Arrastar da borda esquerda abre o menu; arrastar sobre ele fecha.
  var toqueX = null, toqueY = null;

  document.addEventListener('touchstart', function (ev) {
    var t = ev.touches[0];
    toqueX = t.clientX;
    toqueY = t.clientY;
  }, { passive: true });

  document.addEventListener('touchend', function (ev) {
    if (toqueX === null) return;
    var t = ev.changedTouches[0];
    var dx = t.clientX - toqueX;
    var dy = Math.abs(t.clientY - toqueY);
    var inicioNaBorda = toqueX <= 28;
    toqueX = null;

    if (dy > Math.abs(dx)) return;            // gesto vertical: é rolagem
    if (!menuAberto && inicioNaBorda && dx > 55) abrirMenu();
    else if (menuAberto && dx < -55) fecharMenu();
  }, { passive: true });

  // Botão "voltar" do Android: fecha o menu antes de trocar de tela.
  window.addEventListener('popstate', function (ev) {
    if (menuAberto) { fecharMenu(); }
    var tela = (ev.state && ev.state.screen) || 'dash';
    estado.screen = Fin.telas[tela] ? tela : 'dash';
    render();
  });

  /* ---------------------------------------------------------
     Início
     --------------------------------------------------------- */

  var telaInicial = (location.hash || '').replace('#', '');
  // "mais" era a tela antiga de atalhos, hoje substituída pelo menu lateral.
  if (telaInicial === 'mais') telaInicial = 'dash';
  estado.screen = Fin.telas[telaInicial] ? telaInicial : 'dash';
  history.replaceState({ screen: estado.screen }, '', '#' + estado.screen);
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* sem offline, tudo bem */ });
    });
  }

})(window.Fin);
