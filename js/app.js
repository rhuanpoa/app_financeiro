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
  Fin.usarRegras(dados.regras);

  var estado = {
    screen: 'dash',
    addType: 'out',
    contaFiltro: '',
    // Mês que o painel inicial mostra. null = o mês corrente.
    mesRef: null,
    // Mês aberto na tela de Previsão (índice absoluto), ou null.
    mesAberto: null,
    // Mês aberto no Histórico. Começa fechado: a lista inteira aberta
    // fica enorme depois de importar um extrato.
    mesHist: null,
    // Meta sendo editada
    metaEditId: null,
    // Resultado da conferencia da ultima fatura importada, mostrado na
    // tela de revisao. Some junto com os pendentes.
    conferencia: null,
    // Conversa do chat. `mensagens` é o que aparece na tela; `input` é a
    // mesma conversa no formato que a IA entende, incluindo as consultas
    // que ela pediu. Some ao fechar o app: não é histórico, é conversa.
    chat: { mensagens: [], input: [], pendente: false, erro: '', rascunho: '' },
    forms: Fin.formsEmBranco()
  };

  // Qual item do menu lateral acende em cada tela.
  var ITEM_DO_MENU = {
    dash: 'dash',
    chat: 'chat',
    movimentacoes: 'movimentacoes', importar: 'importar',
    proj: 'proj',
    hist: 'hist',
    categorias: 'categorias', categoriaAdd: 'categorias',
    metas: 'metas', metaAdd: 'metas', metaEdit: 'metas',
    parcelas: 'parcelas', parcelaAdd: 'parcelas'
  };

  // Qual aba da barra de baixo acende. As telas que não têm aba própria
  // (Análise, Parcelas, Histórico, Metas…) ficam sem nenhuma acesa — elas
  // moram no menu. São cinco colunas: mais que isso tira o + do centro.
  var ABA_DA_TELA = {
    dash: 'dash',
    chat: 'chat',
    proj: 'proj'
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
     Sincronização
     --------------------------------------------------------- */

  // Depois de mexer em algo, esperar um pouco antes de enviar. Sem isso,
  // confirmar 40 lançamentos de um extrato dispararia 40 sincronizações.
  var ESPERA_MS = 2500;
  var timerSync = null;

  function mostrarSync() {
    var el = document.getElementById('sync-estado');
    var botao = document.getElementById('btn-sync');
    if (!el) return;

    var e = Fin.sync.estado;
    var classe = 'sync-estado';
    var texto;

    if (e.rodando) {
      texto = 'Sincronizando…';
      classe += ' indo';
    } else if (e.erro) {
      texto = e.erro;
      classe += ' ruim';
    } else if (e.ultimoOk) {
      texto = 'Sincronizado ' + faz(e.ultimoOk);
      classe += ' bom';
    } else if (Fin.sync.temPendente(dados)) {
      texto = 'Ainda não sincronizado';
    } else {
      texto = 'Sincronizado';
      classe += ' bom';
    }

    el.textContent = texto;
    el.className = classe;
    if (botao) botao.disabled = e.rodando;
  }

  function faz(iso) {
    var seg = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (seg < 60) return 'agora';
    var min = Math.round(seg / 60);
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'há ' + h + 'h';
    return 'há ' + Math.round(h / 24) + ' dias';
  }

  /* Uma rodada. `aviso` faz falhar em voz alta — só quando a pessoa
     pediu, clicando. No automático o erro fica calado: perder a rede é
     comum, os dados estão salvos aqui, e um alerta a cada tentativa
     seria só barulho. */
  function sincronizar(aviso) {
    if (!Fin.auth.usuario()) return Promise.resolve();

    mostrarSync();
    return Fin.sync.agora(dados)
      .then(function (r) {
        // Ja havia uma rodada em andamento. Nao da para simplesmente
        // desistir: aquela rodada comecou ANTES desta alteracao e nao vai
        // leva-la. Desistir calado deixaria a mudanca parada ate um
        // proximo evento qualquer -- que pode nao vir tao cedo.
        // Com varias origens disparando sincronizacao (o aviso do
        // servidor, voltar a ter rede, reabrir o app), isso deixou de ser
        // raro.
        if (r && r.jaRodando) { agendarSync(); return; }

        // Se veio coisa de outro aparelho, gravar e redesenhar: a tela
        // atual pode estar mostrando números que acabaram de mudar.
        if (r && (r.baixados || r.enviados)) {
          Fin.usarCategorias(dados.cats);
          Fin.usarRegras(dados.regras);
          Fin.salvar(dados);
        }
        if (r && r.baixados) render(true);

        mostrarSync();
        if (aviso) {
          toast(r && r.baixados
            ? r.baixados + (r.baixados === 1 ? ' novidade recebida' : ' novidades recebidas')
            : 'Tudo sincronizado');
        }
      })
      .catch(function (erro) {
        mostrarSync();
        if (aviso) toast(erro.message || 'Não consegui sincronizar');
      });
  }

  /* Sair mudou de significado. Antes os lançamentos eram deste aparelho
     e ficavam aqui. Agora eles são da CONTA — e deixá-los para trás faria
     a próxima pessoa que entrasse neste aparelho enviá-los como se
     fossem dela. Então: envia o que falta, e só depois limpa. */
  function sairDaConta() {
    var pendente = Fin.sync.temPendente(dados);

    function terminar() {
      fecharMenu();
      Fin.sync.parar();
      dados = Fin.vazio();
      Fin.usarCategorias(dados.cats);
      Fin.usarRegras(dados.regras);
      Fin.salvar(dados);
      Fin.sync.esquecerMarcador();
      Fin.auth.sair().catch(function (e) { toast(e.message); });
    }

    if (!pendente) {
      if (!confirm('Sair da conta? Seus lançamentos ficam guardados na conta ' +
                   'e voltam quando você entrar de novo.')) return;
      return terminar();
    }

    // Há coisa não enviada: tentar antes de descartar.
    toast('Salvando na sua conta…');
    sincronizar(false).then(function () {
      if (Fin.sync.temPendente(dados)) {
        if (!confirm('Não consegui salvar as últimas mudanças na sua conta. ' +
                     'Se sair agora, elas se perdem. Sair mesmo assim?')) return;
      } else if (!confirm('Sair da conta? Tudo já está salvo na sua conta.')) {
        return;
      }
      terminar();
    });
  }

  function agendarSync() {
    if (!Fin.auth.usuario()) return;
    clearTimeout(timerSync);
    timerSync = setTimeout(function () { sincronizar(false); }, ESPERA_MS);
    mostrarSync();
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
    // As categorias próprias e as regras aprendidas precisam estar
    // visíveis para Fin.cor() e Fin.regraPara() antes de qualquer render.
    Fin.usarCategorias(dados.cats);
    Fin.usarRegras(dados.regras);
    if (!Fin.salvar(dados)) {
      toast('Não consegui salvar neste navegador');
    }
    agendarSync();
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
     Chat
     --------------------------------------------------------- */

  function enviarPergunta(texto) {
    var c = estado.chat;
    var pergunta = String(texto || c.rascunho || '').trim();
    if (!pergunta || c.pendente) return;

    c.mensagens.push({ de: 'voce', texto: pergunta });
    c.input = c.input.concat([Fin.chat.itemPergunta(pergunta)]);
    c.rascunho = '';
    c.erro = '';
    c.pendente = true;
    render();
    rolarChat();

    Fin.chat.perguntar(dados, c.input)
      .then(function (r) {
        c.pendente = false;
        c.input = r.input;
        c.mensagens.push({ de: 'app', texto: r.texto });
      })
      .catch(function (erro) {
        c.pendente = false;
        c.erro = erro.message || 'Nao consegui responder agora.';
        // A pergunta sai da conversa da IA: mante-la faria a proxima
        // tentativa reenviar uma conversa pela metade.
        c.input = c.input.slice(0, -1);
      })
      .then(function () {
        render();
        rolarChat();
      });
  }

  // A ultima mensagem tem de ficar visivel sozinha, como em qualquer
  // aplicativo de conversa.
  function rolarChat() {
    var linha = view.querySelector('.chat-linha');
    if (linha) window.scrollTo(0, document.body.scrollHeight);
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
      id: Fin.novoId(),
      atualizado_em: Fin.agora(),
      _sujo: 1,
      type: tipo,
      amount: valor,
      category: f.category,
      note: (f.note || '').trim(),
      date: f.date || Fin.hojeISO(),
      fixed: !!f.fixed,
      // Duração da repetição em meses (0 = sem data para acabar).
      // Só faz sentido quando `fixed` está ligado.
      repete: f.fixed ? Math.max(0, parseInt(f.repete, 10) || 0) : 0
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
      id: Fin.novoId(),
      atualizado_em: Fin.agora(),
      _sujo: 1,
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
      id: Fin.novoId(),
      atualizado_em: Fin.agora(),
      _sujo: 1,
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
      id: Fin.novoId(),
      atualizado_em: Fin.agora(),
      _sujo: 1,
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

    Fin.remover(dados, 'cats', id);
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
        ? Object.assign({}, g, { name: nome, target: alvo, saved: guardado,
                                 atualizado_em: Fin.agora(), _sujo: 1 })
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
      return x.id === g.id
        ? Object.assign({}, x, { saved: novo, atualizado_em: Fin.agora(), _sujo: 1 })
        : x;
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
      return g.id === id
        ? Object.assign({}, g, { saved: Math.min(g.target, g.saved + valor),
                                 atualizado_em: Fin.agora(), _sujo: 1 })
        : g;
    });
    persistir();
    render();
    toast('R$ ' + valor + ' guardado ✓');
  }

  function apagar(lista, id, msg) {
    // Fin.remover tira da lista E deixa a marca de apagado. Sem a marca,
    // o outro aparelho reenviaria o registro e ele voltaria do nada.
    var saiu = Fin.remover(dados, lista, id);

    // Nao anunciar sucesso sem conferir. Quando os ids viraram texto e o
    // app ainda os convertia para numero, nada era apagado e mesmo assim
    // aparecia "Removido" -- o defeito ficou escondido atras do aviso.
    if (!saiu) { toast('Não consegui remover'); return; }

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
            pendentes: Array.isArray(d.pendentes) ? d.pendentes : [],
            regras: Array.isArray(d.regras) ? d.regras : [],
            apagados: Array.isArray(d.apagados) ? d.apagados : []
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

            // A conferencia da fatura acompanha a revisao: e na tela de
            // confirmacao que ela precisa aparecer, nao num aviso que some.
            estado.conferencia = lido.conferencia || null;
            if (estado.conferencia && /nao reconhecido/i.test(lido.formato || '')) {
              estado.conferencia.naoReconhecido = true;
            }
            if (!estado.conferencia && /nao reconhecido/i.test(lido.formato || '')) {
              estado.conferencia = { temTotal: false, naoReconhecido: true };
            }

            dados.pendentes = dados.pendentes.concat(res.novos);
            persistir();
            irPara('movimentacoes');
            toast(res.novos.length + ' nova(s) do ' + lido.formato +
                  (res.aprendidos ? ' · ' + res.aprendidos + ' já categorizada(s)' : '') +
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
    estado.conferencia = null;
    if (!dados.pendentes.length) return;

    var semCategoria = dados.pendentes.filter(function (p) { return !p.category; }).length;
    if (semCategoria &&
        !confirm(semCategoria + ' movimentação(ões) sem categoria vão entrar como "Outros". Continuar?')) {
      return;
    }

    var qtd = dados.pendentes.length;

    // Aprende antes de esvaziar a fila: a categoria que você confirmou
    // aqui é a que vai vir pronta na próxima importação.
    var antes = dados.regras.length;
    dados.regras = Fin.aprender(dados.regras, dados.pendentes);
    var novasRegras = dados.regras.length - antes;

    dados.pendentes.forEach(function (p) {
      dados.tx.push({
        // Reaproveita o id do pendente: sao colecoes diferentes, entao
        // nao conflitam, e a lapide do pendente nao afeta o lancamento.
        id: p.id,
        atualizado_em: Fin.agora(),
        _sujo: 1,
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
    toast(qtd + ' no caixa ✓' +
          (novasRegras ? ' · aprendi ' + novasRegras + ' destinatário(s)' : ''));
  }

  function esquecerRegras() {
    if (!dados.regras.length) { toast('Nada aprendido ainda'); return; }
    if (!confirm('Esquecer as ' + dados.regras.length +
                 ' categorias aprendidas? Os lançamentos já feitos não mudam.')) return;
    dados.regras.forEach(function (r) { Fin.apagou(dados, 'regras', r.id); });
    dados.regras = [];
    persistir();
    render();
    toast('Aprendizado apagado');
  }

  function descartarPendentes() {
    estado.conferencia = null;
    if (!dados.pendentes.length) return;
    if (!confirm('Descartar as ' + dados.pendentes.length + ' movimentações não confirmadas?')) return;
    dados.pendentes = [];
    persistir();
    render();
    toast('Movimentações descartadas');   // aqui é o dado, não o nome da tela
  }

  /* ---------------------------------------------------------
     Versão e atualização

     O app guarda offline, então o celular pode continuar rodando uma
     versão antiga sem avisar. Aqui ele compara a versão que está
     carregada com a que está publicada no GitHub Pages.
     --------------------------------------------------------- */

  function mostrarStatusVersao(classe, texto, botao) {
    var el = document.getElementById('versao-status');
    el.className = 'versao-status ' + classe;
    el.innerHTML = texto + (botao
      ? '<button data-action="aplicar-atualizacao" type="button">' + botao + '</button>'
      : '');
    el.hidden = false;
  }

  function buscarAtualizacao() {
    var btn = document.getElementById('btn-atualizar');
    btn.disabled = true;
    btn.textContent = 'Verificando…';

    var terminar = function () {
      btn.disabled = false;
      btn.textContent = 'Buscar atualização';
    };

    // Cache-buster na URL além do no-store: alguns proxies ignoram o
    // cabeçalho, mas nenhum ignora uma URL diferente.
    fetch('./version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (info) {
        var publicada = String(info.versao || '').trim();
        var instalada = Fin.VERSAO;

        if (!publicada) throw new Error('resposta sem versão');

        if (publicada === instalada) {
          mostrarStatusVersao('ok',
            'Você está na versão mais recente (<b>' + Fin.esc(publicada) + '</b>).');
        } else {
          mostrarStatusVersao('nova',
            'Há uma versão nova no servidor: <b>' + Fin.esc(publicada) + '</b>.<br>' +
            'Você está na <b>' + Fin.esc(instalada) + '</b>.',
            'Atualizar agora');
        }
        terminar();
      })
      .catch(function (e) {
        mostrarStatusVersao('erro',
          'Não consegui verificar. Sem internet? (' + Fin.esc(e.message) + ')');
        terminar();
      });
  }

  // Limpa o cache do service worker e recarrega, para o aparelho pegar
  // os arquivos novos. Os dados ficam no localStorage e não são tocados.
  function aplicarAtualizacao() {
    mostrarStatusVersao('nova', 'Baixando a versão nova…');

    var tarefas = [];

    if (window.caches) {
      tarefas.push(caches.keys().then(function (chaves) {
        return Promise.all(chaves.map(function (k) { return caches.delete(k); }));
      }));
    }

    if (navigator.serviceWorker) {
      tarefas.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (r) { return r.unregister(); }));
      }));
    }

    Promise.all(tarefas)
      .catch(function () { /* mesmo falhando, vale tentar recarregar */ })
      .then(function () {
        // A query nova evita que o próprio navegador sirva o HTML do cache.
        location.replace(location.pathname + '?atualizado=' + Date.now());
      });
  }

  /* ---------------------------------------------------------
     Eventos — um só ouvinte para tudo (delegação)
     --------------------------------------------------------- */

  document.addEventListener('click', function (ev) {
    var alvo = ev.target.closest('[data-nav],[data-action]');
    if (!alvo) return;

    var acao = alvo.dataset.action;
    // TEXTO, nao numero. Os ids deixaram de ser Date.now() e viraram
    // identificadores unicos com letras e tracos. Converter para numero
    // dava NaN: o filtro nao casava com nada, e apagar deixou de
    // funcionar em silencio -- o aviso "Removido" aparecia do mesmo
    // jeito, porque ninguem conferia se algo saiu mesmo.
    var id = alvo.dataset.id || null;

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

      // Redesenha porque as opções de prazo aparecem e somem junto.
      case 'toggle-fixed': {
        var f = estado.forms[estado.addType];
        f.fixed = !f.fixed;
        render(true);
        break;
      }

      case 'set-repete': {
        var ff = estado.forms[estado.addType];
        if (alvo.dataset.meses === 'outro') {
          ff.repeteOutro = true;
          // um valor de partida que não seja nenhum dos atalhos
          if (!Number(ff.repete) || [3, 6, 12].indexOf(Number(ff.repete)) !== -1) ff.repete = 2;
        } else {
          ff.repeteOutro = false;
          ff.repete = Number(alvo.dataset.meses) || 0;
        }
        render(true);
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
        Fin.remover(dados, 'goals', id);
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

      case 'chat-enviar':   enviarPergunta(); break;
      case 'chat-sugestao': enviarPergunta(alvo.dataset.texto); break;

      case 'abrir-menu': abrirMenu(); break;
      case 'fechar-menu': fecharMenu(); break;

      case 'sair': sairDaConta(); break;

      case 'sincronizar':         sincronizar(true); break;
      case 'buscar-atualizacao':  buscarAtualizacao(); break;
      case 'aplicar-atualizacao': aplicarAtualizacao(); break;

      case 'escolher-extrato':     escolherExtrato(); break;
      case 'esquecer-regras':      esquecerRegras(); break;
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

      // O mesmo no Histórico, com estado próprio: abrir um mês lá não
      // pode mexer no que está aberto na Previsão.
      case 'abrir-mes-hist': {
        var ymh = Number(alvo.dataset.ym);
        estado.mesHist = estado.mesHist === ymh ? null : ymh;
        render(true);
        break;
      }

      case 'exportar': exportar(); break;
      case 'importar-backup': importar(); break;

      case 'clear-all':
        if (confirm('Apagar TODOS os dados? Isso não pode ser desfeito.')) {
          // As marcas de exclusao sobrevivem ao "apagar tudo" de proposito:
          // sem elas, o outro aparelho devolveria tudo na sincronizacao.
          Fin.removerTudo(dados);
          var lapides = dados.apagados;
          dados = Fin.vazio();
          dados.apagados = lapides;
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
    if (el.dataset && el.dataset.chat === 'pergunta') {
      estado.chat.rascunho = el.value;
      return;
    }

    if (!el.dataset || !el.dataset.form || !el.dataset.field) return;

    estado.forms[el.dataset.form][el.dataset.field] = el.value;

    // Exceção 1: a prévia do valor da parcela.
    if (el.dataset.form === 'parcela' &&
        (el.dataset.field === 'total' || el.dataset.field === 'parcels')) {
      var pv = document.getElementById('preview-parcela');
      if (pv) {
        var n = parseInt(estado.forms.parcela.parcels, 10) || 0;
        pv.textContent = n > 0 ? Fin.fmt(Fin.parse(estado.forms.parcela.total) / n) : '—';
      }
    }

    // Exceção 2: até quando a repetição vale. Digitar "5" tem de mudar a
    // data de fim na hora, senão o texto fica mentindo enquanto se digita.
    if ((el.dataset.field === 'repete' || el.dataset.field === 'date') &&
        (el.dataset.form === 'out' || el.dataset.form === 'in')) {
      atualizarResumoPrazo(estado.forms[el.dataset.form]);
    }
  });

  function atualizarResumoPrazo(f) {
    var el = view.querySelector('.prazo-resumo');
    if (!el) return;

    var meses = Number(f.repete) || 0;
    var data = f.date || Fin.hojeISO();

    el.innerHTML = meses > 0
      ? 'Vale de <b>' + Fin.rotuloMes(Fin.indiceMes(Fin.paraData(data))) +
        '</b> até <b>' + (Fin.fimDaRepeticao(data, meses) || '—') + '</b>.'
      : 'Sem data para acabar — vale em todos os meses da previsão.';
  }

  // Categoria de uma movimentação do extrato: grava sem redesenhar a lista,
  // para não perder a rolagem no meio da revisão.
  // O <form> existe so para o Enter do teclado do celular funcionar.
  // Sem preventDefault, enviar recarregaria a pagina e a conversa sumiria.
  view.addEventListener('submit', function (ev) {
    if (!ev.target.dataset || !ev.target.dataset.chatForm) return;
    ev.preventDefault();
    enviarPergunta();
  });

  view.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el.dataset || !el.dataset.pendente) return;

    var id = el.dataset.pendente;   // texto, pelo mesmo motivo
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
     Tela de entrada

     O app só existe depois que há sessão. Enquanto não houver,
     o que aparece é o formulário — e nada de barra, menu ou
     botão flutuante por trás dele.
     --------------------------------------------------------- */

  function mostrarLogin() {
    appIniciado = false;
    document.body.classList.add('deslogado');
    view.innerHTML = Fin.login.html();
    var primeiro = view.querySelector('input');
    if (primeiro) primeiro.focus();
  }

  function redesenharLogin() {
    var ativo = document.activeElement;
    var focado = ativo && ativo.dataset ? ativo.dataset.login : null;
    view.innerHTML = Fin.login.html();
    // devolve o foco ao campo que estava sendo usado
    var alvo = focado ? view.querySelector('[data-login="' + focado + '"]') : null;
    if (alvo) {
      alvo.focus();
      // setSelectionRange so existe em alguns tipos de campo: em
      // type="email" ele lanca InvalidStateError. Como esta funcao roda
      // logo depois de marcar o botao como ocupado, a excecao interrompia
      // o envio no meio e o botao ficava preso em "Aguarde" para sempre.
      try { alvo.setSelectionRange(alvo.value.length, alvo.value.length); } catch (err) {}
    }
  }

  function enviarLogin() {
    var e = Fin.login.estado;
    if (e.ocupado) return;

    var email = (e.email || '').trim();
    var nome = (e.nome || '').trim();

    if (e.modo === 'nova-senha') {
      if ((e.senha || '').length < 6) {
        e.erro = 'A senha precisa de pelo menos 6 caracteres.'; redesenharLogin(); return;
      }
      e.ocupado = true; e.erro = ''; e.aviso = '';
      redesenharLogin();

      Fin.auth.trocarSenha(e.senha)
        .then(function () {
          Fin.auth.fimDaRecuperacao();
          e.ocupado = false; e.senha = '';
          // A sessao do link ja e valida, entao entra direto no app.
          iniciarApp();
          toast('Senha alterada');
        })
        .catch(function (erro) {
          e.ocupado = false;
          e.erro = erro.message || 'Nao consegui trocar a senha.';
          redesenharLogin();
        });
      return;
    }

    if (e.modo === 'criar') {
      // Conferir aqui evita criar uma conta com CPF errado, que depois
      // ninguém consegue corrigir sozinho.
      if (nome.split(/\s+/).filter(Boolean).length < 2) {
        e.erro = 'Informe o nome completo, com sobrenome.'; redesenharLogin(); return;
      }
      if (!email) { e.erro = 'Informe o e-mail.'; redesenharLogin(); return; }
      if (!Fin.cpfValido(e.cpf)) {
        e.erro = 'CPF inválido. Confira os números.'; redesenharLogin(); return;
      }
      if ((e.senha || '').length < 6) {
        e.erro = 'A senha precisa de pelo menos 6 caracteres.'; redesenharLogin(); return;
      }
    }

    if (!email) { e.erro = 'Informe o e-mail.'; redesenharLogin(); return; }

    if (e.modo !== 'recuperar' && !e.senha) {
      e.erro = 'Informe a senha.'; redesenharLogin(); return;
    }

    e.ocupado = true; e.erro = ''; e.aviso = '';
    redesenharLogin();

    var terminou = function () { e.ocupado = false; };

    // Promise.resolve().then() em volta da chamada: assim um erro lancado
    // de forma sincrona vira uma rejeicao normal e cai no .catch abaixo.
    // Sem isso a excecao escaparia antes do .catch existir e o botao
    // ficaria travado em "Aguarde" para sempre, sem dizer o motivo.
    var acao = Promise.resolve().then(function () {
      if (e.modo === 'criar')     return Fin.auth.criarConta(email, e.senha, nome, Fin.soDigitos(e.cpf));
      if (e.modo === 'recuperar') return Fin.auth.recuperarSenha(email);
      return Fin.auth.entrar(email, e.senha);
    });

    acao.then(function (r) {
      terminou();
      if (e.modo === 'recuperar') {
        Fin.login.trocarModo('entrar');
        e.email = email;
        e.aviso = 'Enviamos um link para ' + email + '. Confira sua caixa de entrada.';
        redesenharLogin();
      } else if (e.modo === 'criar' && r && r.precisaConfirmar) {
        Fin.login.trocarModo('entrar');
        e.email = email;
        e.senha = ''; e.nome = ''; e.cpf = '';
        e.aviso = 'Conta criada. Confirme o e-mail enviado para ' + email + ' e depois entre.';
        redesenharLogin();
      }
      // Entrou de verdade: quem troca de tela é o aoMudar, abaixo.
    }).catch(function (erro) {
      terminou();
      e.erro = erro.message || 'Não consegui completar a operação.';
      redesenharLogin();
    });
  }

  // O formulário tem os próprios ouvintes: ele existe antes do app,
  // quando data-action e data-nav ainda não significam nada.
  document.addEventListener('input', function (ev) {
    var campo = ev.target.dataset && ev.target.dataset.login;
    if (!campo) return;

    // O CPF ganha pontos e traço enquanto se digita. Como só se escreve
    // no fim do campo, devolver o cursor ao fim não atrapalha.
    if (campo === 'cpf') {
      ev.target.value = Fin.formatarCPF(ev.target.value);
    }

    Fin.login.estado[campo] = ev.target.value;
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    if (!ev.target.dataset || !ev.target.dataset.login) return;
    ev.preventDefault();
    enviarLogin();
  });

  document.addEventListener('click', function (ev) {
    var alvo = ev.target.closest('[data-login-acao]');
    if (!alvo) return;
    var acao = alvo.dataset.loginAcao;

    if (acao === 'enviar') { enviarLogin(); return; }
    if (acao === 'modo-entrar')    Fin.login.trocarModo('entrar');
    if (acao === 'modo-criar')     Fin.login.trocarModo('criar');
    if (acao === 'modo-recuperar') Fin.login.trocarModo('recuperar');
    redesenharLogin();
  });

  /* ---------------------------------------------------------
     Início
     --------------------------------------------------------- */

  var appIniciado = false;

  function iniciarApp() {
    if (appIniciado) return;
    appIniciado = true;
    document.body.classList.remove('deslogado');

    document.getElementById('versao-app').textContent = Fin.VERSAO;
    var contaEl = document.getElementById('drawer-conta');
    if (contaEl) contaEl.textContent = Fin.auth.email();

    var telaInicial = (location.hash || '').replace('#', '');
    // "mais" era a tela antiga de atalhos, hoje substituída pelo menu lateral.
    if (telaInicial === 'mais') telaInicial = 'dash';
    estado.screen = Fin.telas[telaInicial] ? telaInicial : 'dash';
    history.replaceState({ screen: estado.screen }, '', '#' + estado.screen);
    render();

    // Os dados aqui podem ser de outra conta que usou este aparelho.
    // Nesse caso NAO da para fundir: seria misturar o dinheiro de duas
    // pessoas. Comeca limpo e baixa o que e desta conta.
    var eu = Fin.auth.usuario() && Fin.auth.usuario().id;
    var dono = Fin.sync.dono();
    if (dono && eu && dono !== eu) {
      dados = Fin.vazio();
      Fin.sync.esquecerMarcador();
      Fin.salvar(dados);
      render();
    }

    mostrarSync();
    sincronizar(false).then(escutarOutrosAparelhos);
  }

  /* O servidor avisa assim que algo muda em outro aparelho, e o
     lancamento aparece sozinho na tela -- sem esperar a proxima rodada. */
  function escutarOutrosAparelhos() {
    Fin.sync.ouvir(
      dados,
      function () {
        // Chegou coisa de outro aparelho: gravar e redesenhar. A tela
        // aberta pode estar mostrando numeros que acabaram de mudar.
        Fin.usarCategorias(dados.cats);
        Fin.usarRegras(dados.regras);
        Fin.salvar(dados);
        render(true);
        mostrarSync();
      },
      function () {
        // A escuta (re)conectou. O que aconteceu enquanto ela estava fora
        // nao foi avisado -- e justamente aqui que pode ter ficado buraco.
        sincronizar(false);
      }
    );
  }

  /* Voltar a ter rede, ou voltar para o app, sao os dois momentos em que
     e mais provavel existir novidade esperando. */
  window.addEventListener('online', function () { sincronizar(false); });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) sincronizar(false);
  });

  // Uma sessão guardada vale offline: o app abre sem internet para
  // quem já entrou alguma vez neste aparelho.
  // Chegou pelo link de "esqueci a senha": nao entra no app ainda.
  // Trocar a senha e o unico caminho daqui, senao a pessoa segue com a
  // senha antiga e volta a ficar trancada.
  Fin.auth.aoRecuperar(function () {
    mostrarLogin();
    Fin.login.trocarModo('nova-senha');
    Fin.login.estado.aviso = 'Escolha uma senha nova para sua conta.';
    redesenharLogin();
  });

  Fin.auth.aoMudar(function (usuario) {
    if (Fin.auth.estaRecuperando()) return;
    if (usuario) iniciarApp(); else mostrarLogin();
  });

  Fin.auth.iniciar()
    .then(function (usuario) {
      if (Fin.auth.estaRecuperando()) return;
      if (usuario) iniciarApp(); else mostrarLogin();
    })
    .catch(function () { mostrarLogin(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* sem offline, tudo bem */ });
    });
  }

})(window.Fin);
