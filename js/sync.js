/* =========================================================
   sync.js — sincronização entre aparelhos.

   Como funciona, em três passos:

     1. BAIXAR  o que mudou no servidor desde a última conversa
     2. FUNDIR  com o que está aqui, registro a registro
     3. ENVIAR  o que mudou aqui desde a última conversa

   Duas datas diferentes convivem aqui, e confundi-las quebra tudo:

     - `atualizado_em` DENTRO do registro é o relógio do aparelho.
       É ele que decide qual das duas versões é a mais nova.

     - `atualizado_em` da COLUNA é o relógio do servidor. Serve só
       de marcador: "me dê o que mudou depois disto". Se viesse do
       aparelho, um celular com a hora adiantada gravaria um
       marcador no futuro e os outros aparelhos parariam de
       enxergar as próprias mudanças.

   O que se perde e o que não: criar e apagar nunca se perdem,
   porque cada registro tem id próprio. Editar o MESMO registro
   nos dois aparelhos ao mesmo tempo, sim — vence a edição mais
   recente pelo relógio de quem editou.
   ========================================================= */

window.Fin = window.Fin || {};

(function (Fin) {
  'use strict';

  var CHAVE_MARCADOR = 'fin_sync_marcador';

  // Ao pedir "o que mudou depois de X", voltamos um pouco no tempo.
  // Dois aparelhos gravando quase juntos podem receber horas muito
  // próximas, e sem essa folga uma das gravações passaria despercebida.
  // Reprocessar é inofensivo: fundir o mesmo registro duas vezes dá no
  // mesmo. Perder um lançamento, não.
  var FOLGA_MS = 5000;

  var LIMITE_MS = 45000;

  Fin.sync = {};

  Fin.sync.estado = {
    rodando: false,
    ultimoOk: null,     // quando terminou bem, pelo relógio daqui
    erro: '',
    baixados: 0,
    enviados: 0
  };

  /* ---------- marcador ---------- */

  function lerMarcador() {
    try { return localStorage.getItem(CHAVE_MARCADOR) || null; }
    catch (e) { return null; }
  }

  function gravarMarcador(v) {
    try { if (v) localStorage.setItem(CHAVE_MARCADOR, v); }
    catch (e) { /* modo privado: sincroniza tudo de novo na proxima */ }
  }

  // Usado ao trocar de conta: os dados do servidor são de outra pessoa.
  Fin.sync.esquecerMarcador = function () {
    try { localStorage.removeItem(CHAVE_MARCADOR); } catch (e) {}
  };

  function comFolga(iso) {
    if (!iso) return '1970-01-01T00:00:00.000Z';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '1970-01-01T00:00:00.000Z';
    return new Date(t - FOLGA_MS).toISOString();
  }

  /* ---------- fusão ---------- */

  function quando(registro) {
    var t = registro && registro.atualizado_em
      ? new Date(registro.atualizado_em).getTime() : 0;
    return isNaN(t) ? 0 : t;
  }

  /* Aplica no que está aqui o que veio de lá. Devolve quantos
     registros realmente mudaram — reaplicar o mesmo dado não conta.

     `linha` = { colecao, id, dados, apagado } */
  function aplicar(dados, linha) {
    var colecao = linha.colecao;
    if (Fin.COLECOES.indexOf(colecao) === -1) return 0;
    if (!Array.isArray(dados[colecao])) dados[colecao] = [];

    var lista = dados[colecao];
    var pos = -1;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === linha.id) { pos = i; break; }
    }

    if (linha.apagado) {
      if (pos === -1) return 0;
      lista.splice(pos, 1);
      // A lápide local sai: quem guarda o apagado agora é o servidor.
      dados.apagados = (dados.apagados || []).filter(function (a) {
        return !(a.colecao === colecao && a.id === linha.id);
      });
      return 1;
    }

    var vindo = linha.dados;
    if (!vindo || !vindo.id) return 0;

    if (pos === -1) {
      // Chegou um registro que apagamos aqui e ainda não contamos ao
      // servidor. Respeitar a exclusão: ela é mais nova que o envio dele.
      var apagadoAqui = (dados.apagados || []).some(function (a) {
        return a.colecao === colecao && a.id === linha.id;
      });
      if (apagadoAqui) return 0;

      lista.push(vindo);
      return 1;
    }

    // Os dois lados têm o registro: vence quem editou por último.
    if (quando(vindo) > quando(lista[pos])) {
      lista[pos] = vindo;
      return 1;
    }
    return 0;
  }

  Fin.sync.aplicar = aplicar;   // exposto para teste

  /* Tudo o que ainda não foi contado ao servidor: os registros marcados
     como sujos, mais as exclusões.

     Marcar é melhor do que deduzir pela data. A primeira versão disto
     comparava a data do registro com a hora da última sincronização —
     e num aparelho com o relógio atrasado as edições nasciam com data
     no passado, ficavam abaixo do corte e NUNCA subiam. Sem erro, sem
     aviso: o registro simplesmente ficava só naquele aparelho. */
  function aEnviar(dados) {
    var linhas = [];

    Fin.COLECOES.forEach(function (colecao) {
      (dados[colecao] || []).forEach(function (r) {
        if (!r.id || !r._sujo) return;
        linhas.push({ colecao: colecao, id: r.id, dados: semMarca(r), apagado: false });
      });
    });

    (dados.apagados || []).forEach(function (a) {
      linhas.push({ colecao: a.colecao, id: a.id, dados: null, apagado: true });
    });

    return linhas;
  }

  // A marca é assunto interno deste aparelho: não vai para o servidor,
  // senão voltaria para os outros e eles reenviariam sem motivo.
  function semMarca(r) {
    var copia = {};
    for (var k in r) {
      if (Object.prototype.hasOwnProperty.call(r, k) && k !== '_sujo') copia[k] = r[k];
    }
    return copia;
  }

  // Depois que o servidor confirmou, a marca sai.
  function limparMarcas(dados) {
    Fin.COLECOES.forEach(function (colecao) {
      (dados[colecao] || []).forEach(function (r) { delete r._sujo; });
    });
  }

  Fin.sync.aEnviar = aEnviar;   // exposto para teste

  function comLimite(promessa) {
    return new Promise(function (resolve, reject) {
      var caiu = false;
      var t = setTimeout(function () {
        caiu = true;
        reject(new Error('A sincronização demorou demais. Tente de novo.'));
      }, LIMITE_MS);
      promessa.then(function (r) { if (!caiu) { clearTimeout(t); resolve(r); } },
                    function (e) { if (!caiu) { clearTimeout(t); reject(e); } });
    });
  }

  /* ---------- a conversa ---------- */

  Fin.sync.agora = function (dados) {
    var e = Fin.sync.estado;
    if (e.rodando) return Promise.resolve({ jaRodando: true });

    var cliente = Fin.auth && Fin.auth.cliente && Fin.auth.cliente();
    if (!cliente || !Fin.auth.usuario()) {
      return Promise.reject(new Error('Entre na sua conta para sincronizar.'));
    }

    e.rodando = true;
    e.erro = '';
    var marcador = lerMarcador();
    var baixados = 0, enviados = 0;

    /* 1. baixar */
    return comLimite(
      cliente.from('registros')
        .select('colecao,id,dados,apagado')
        .gt('atualizado_em', comFolga(marcador))
    )
      .then(function (r) {
        if (r.error) throw new Error(traduzir(r.error));

        (r.data || []).forEach(function (linha) {
          baixados += aplicar(dados, linha);
        });

        /* 2. enviar */
        var linhas = aEnviar(dados);
        enviados = linhas.length;
        if (!linhas.length) return { data: null, error: null };

        // Em lotes: um cliente com anos de extrato manda milhares de
        // registros no primeiro envio, e um pedido gigante estoura.
        return enviarEmLotes(cliente, linhas);
      })
      .then(function (r) {
        if (r && r.error) throw new Error(traduzir(r.error));

        // O servidor devolve a hora DELE da última gravação: é esse o
        // marcador. Se não houve envio, buscamos a maior hora conhecida.
        var novo = r && r.data;
        if (novo) {
          gravarMarcador(novo);
          return null;
        }
        return cliente.from('registros')
          .select('atualizado_em')
          .order('atualizado_em', { ascending: false })
          .limit(1)
          .then(function (u) {
            if (!u.error && u.data && u.data[0]) gravarMarcador(u.data[0].atualizado_em);
          });
      })
      .then(function () {
        // Contado ao servidor: as marcas saem e as lápides também.
        // Guardar as lápides aqui só faria o localStorage crescer sempre.
        limparMarcas(dados);
        dados.apagados = [];

        e.rodando = false;
        e.ultimoOk = new Date().toISOString();
        e.baixados = baixados;
        e.enviados = enviados;
        return { baixados: baixados, enviados: enviados };
      })
      .catch(function (erro) {
        e.rodando = false;
        e.erro = erro.message || 'Não consegui sincronizar.';
        throw erro;
      });
  };

  var TAMANHO_LOTE = 400;

  function enviarEmLotes(cliente, linhas) {
    var ultima = null;

    function proximo(i) {
      if (i >= linhas.length) return Promise.resolve({ data: ultima, error: null });
      var lote = linhas.slice(i, i + TAMANHO_LOTE);
      return comLimite(cliente.rpc('guardar_registros', { p_linhas: lote }))
        .then(function (r) {
          if (r.error) return { data: null, error: r.error };
          ultima = r.data || ultima;
          return proximo(i + TAMANHO_LOTE);
        });
    }
    return proximo(0);
  }

  function traduzir(erro) {
    var m = String((erro && erro.message) || erro || '');
    if (/failed to fetch|networkerror|load failed/i.test(m)) {
      return 'Sem conexão. Seus dados continuam salvos neste aparelho.';
    }
    if (/sem sessao|jwt|not authenticated/i.test(m)) {
      return 'Sua sessão expirou. Entre de novo.';
    }
    if (/does not exist|schema cache|guardar_registros/i.test(m)) {
      return 'A sincronização ainda não foi configurada no servidor.';
    }
    return 'Não consegui sincronizar agora. Tente de novo em instantes.';
  }

  Fin.sync.traduzirErro = traduzir;   // exposto para teste

})(window.Fin);
