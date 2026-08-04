/* =========================================================
   app.js — estado, navegação e eventos.
   Único arquivo que toca no DOM de verdade.
   ========================================================= */

(function (Fin) {
  'use strict';

  var view  = document.getElementById('view');
  var toastEl = document.getElementById('toast');
  var tabbar = document.querySelector('.tabbar');

  /* ---------------------------------------------------------
     Estado
     --------------------------------------------------------- */

  var dados = Fin.carregar();

  var estado = {
    screen: 'dash',
    addType: 'out',
    forms: Fin.formsEmBranco()
  };

  // Qual aba da barra de baixo acende em cada tela.
  var ABA_DA_TELA = {
    dash: 'dash',
    proj: 'proj',
    parcelas: 'parcelas', parcelaAdd: 'parcelas',
    mais: 'mais', hist: 'mais', categorias: 'mais', metas: 'mais', metaAdd: 'mais'
  };

  /* ---------------------------------------------------------
     Renderização
     --------------------------------------------------------- */

  function render() {
    var calculado = Fin.calcular(dados);
    var tela = Fin.telas[estado.screen] || Fin.telas.dash;

    view.innerHTML = tela(calculado, estado);
    view.scrollTop = 0;
    window.scrollTo(0, 0);

    var abaAtiva = ABA_DA_TELA[estado.screen];
    tabbar.querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('on', b.dataset.nav === abaAtiva);
    });
  }

  function persistir() {
    if (!Fin.salvar(dados)) {
      toast('Não consegui salvar neste navegador');
    }
  }

  function irPara(tela, push) {
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
            goals: Array.isArray(d.goals) ? d.goals : []
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

      case 'save-tx':      salvarLancamento(); break;
      case 'save-parcela': salvarParcela(); break;
      case 'save-goal':    salvarMeta(); break;

      case 'del-tx':      apagar('tx', id, 'Removido'); break;
      case 'del-parcela': apagar('parcelas', id, 'Compra removida'); break;
      case 'del-meta':    apagar('goals', id, 'Meta removida'); break;

      case 'goal-add':
        guardarNaMeta(id, Number(alvo.dataset.amount));
        break;

      case 'exportar': exportar(); break;
      case 'importar': importar(); break;

      case 'clear-all':
        if (confirm('Apagar TODOS os dados? Isso não pode ser desfeito.')) {
          dados = { tx: [], parcelas: [], goals: [] };
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

  // Botão "voltar" do Android navega entre as telas do app.
  window.addEventListener('popstate', function (ev) {
    var tela = (ev.state && ev.state.screen) || 'dash';
    estado.screen = Fin.telas[tela] ? tela : 'dash';
    render();
  });

  /* ---------------------------------------------------------
     Início
     --------------------------------------------------------- */

  var telaInicial = (location.hash || '').replace('#', '');
  estado.screen = Fin.telas[telaInicial] ? telaInicial : 'dash';
  history.replaceState({ screen: estado.screen }, '', '#' + estado.screen);
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* sem offline, tudo bem */ });
    });
  }

})(window.Fin);
