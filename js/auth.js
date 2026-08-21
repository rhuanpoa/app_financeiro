/* =========================================================
   auth.js — contas e sessão.

   O navegador fala direto com o Supabase; não há servidor
   próprio. Quem valida a senha, emite o token e mantém a
   sessão é ele.
   ========================================================= */

window.Fin = window.Fin || {};

(function (Fin) {
  'use strict';

  var cliente = null;
  var usuarioAtual = null;
  var ouvintes = [];

  function configurado() {
    var c = Fin.CONFIG || {};
    return !!(c.SUPABASE_URL && c.SUPABASE_ANON_KEY);
  }

  /* ---------- mensagens ----------
     O Supabase responde em inglês. Traduzir aqui evita que o
     usuário leia "Invalid login credentials" no meio do app. */

  var TRADUCOES = [
    [/invalid login credentials/i,        'E-mail ou senha incorretos.'],
    [/email not confirmed/i,              'Confirme seu e-mail antes de entrar. Procure a mensagem que enviamos.'],
    [/user already registered|already been registered/i,
                                          'Este e-mail já tem conta. Tente entrar.'],
    [/password should be at least (\d+)/i,'A senha precisa de pelo menos $1 caracteres.'],
    [/unable to validate email|invalid format/i,
                                          'E-mail inválido.'],
    // o Supabase recusa domínios reservados (example.com, test.com…)
    [/email address .* is invalid|email_address_invalid/i,
                                          'Este e-mail não é aceito. Use um endereço real.'],
    [/email rate limit|over_email_send_rate_limit/i,
                                          'Muitas tentativas seguidas. Espere alguns minutos.'],
    // Sem SMTP próprio, o Supabase só entrega para membros do projeto.
    [/email address not authorized|email_address_not_authorized/i,
                                          'O envio de e-mails ainda não está liberado para este endereço. Avise o suporte.'],
    [/for security purposes.*(\d+) seconds/i,
                                          'Aguarde alguns segundos antes de tentar de novo.'],
    [/failed to fetch|networkerror|load failed/i,
                                          'Sem conexão com a internet.'],
    // 504 do gateway do Supabase. Hoje quer dizer que o envio de e-mail
    // travou: o cadastro fica esperando o SMTP e estoura.
    [/upstream request timeout|gateway ?timeout/i,
                                          'O servidor demorou demais para responder. Tente de novo em instantes.'],

    // Vêm do gatilho criar_perfil(), no banco. A unicidade do CPF é
    // garantida lá, não aqui: assim não existe consulta pública que
    // permita descobrir quais CPFs já são clientes.
    [/cpf_ja_cadastrado/i,                'Este CPF já tem conta.'],
    [/cpf_invalido/i,                     'CPF inválido.'],
    [/nome_invalido/i,                    'Informe seu nome completo.'],

    // O Supabase às vezes engole a mensagem do gatilho e devolve só isto.
    // No cadastro, o único erro de banco possível vem de lá.
    [/database error saving new user/i,   'Este CPF já tem conta, ou os dados não foram aceitos.']
  ];

  function traduzir(erro) {
    var msg = (erro && (erro.message || erro.msg)) || 'Não consegui completar a operação.';

    for (var i = 0; i < TRADUCOES.length; i++) {
      var achou = msg.match(TRADUCOES[i][0]);
      if (!achou) continue;

      // Devolve SÓ a tradução. Usar msg.replace() deixaria o resto do
      // inglês grudado: "Muitas tentativas seguidas. exceeded".
      // O $1 recebe o que a expressão capturou, como o mínimo de caracteres.
      return TRADUCOES[i][1].replace('$1', achou[1] || '');
    }

    return msg;
  }

  /* Rede ruim não pode deixar o botão preso em "Aguarde…" para sempre.
     O supabase-js não impõe limite de tempo, então o limite é aqui. */
  var LIMITE_MS = 20000;

  function comLimite(promessa) {
    return new Promise(function (resolve, reject) {
      var caiu = false;
      var t = setTimeout(function () {
        caiu = true;
        // Estourar o tempo tem duas causas bem diferentes, e dizer a
        // errada manda a pessoa reiniciar o roteador por um problema
        // que e do servidor. navigator.onLine separa as duas.
        var offline = (typeof navigator !== 'undefined') && navigator.onLine === false;
        reject(new Error(offline
          ? 'Sem conexão com a internet. Tente de novo.'
          : 'O servidor demorou demais para responder. Tente de novo em instantes.'));
      }, LIMITE_MS);

      promessa.then(function (r) {
        if (caiu) return;
        clearTimeout(t); resolve(r);
      }, function (e) {
        if (caiu) return;
        clearTimeout(t); reject(e);
      });
    });
  }

  // Se iniciar() falhou (a biblioteca de contas nao carregou, por exemplo),
  // 'cliente' fica indefinido. Sem esta porteira, cliente.auth.signUp()
  // lancaria um TypeError de forma sincrona e a tela travaria calada.
  function exigirCliente() {
    if (!cliente) {
      return Promise.reject(new Error(
        'O sistema de contas não carregou. Verifique a conexão e recarregue o app.'));
    }
    return null;
  }

  function avisar() {
    ouvintes.forEach(function (fn) {
      try { fn(usuarioAtual); } catch (e) {}
    });
  }

  /* ---------- ciclo de vida ---------- */

  var ouvintesRecuperacao = [];
  var recuperando = false;

  Fin.auth = {
    configurado: configurado,

    // exposta para poder ser testada isoladamente
    traduzirErro: function (msg) { return traduzir({ message: msg }); },

    // Sobe o cliente e recupera a sessão guardada.
    // Funciona sem internet: a sessão fica no armazenamento local,
    // então o app abre offline para quem já entrou.
    iniciar: function () {
      if (!configurado()) return Promise.resolve(null);
      if (typeof supabase === 'undefined' || !supabase.createClient) {
        return Promise.reject(new Error('Biblioteca de contas não carregou.'));
      }

      cliente = supabase.createClient(
        Fin.CONFIG.SUPABASE_URL,
        Fin.CONFIG.SUPABASE_ANON_KEY,
        { auth: { persistSession: true, autoRefreshToken: true } }
      );

      cliente.auth.onAuthStateChange(function (evento, sessao) {
        usuarioAtual = sessao ? sessao.user : null;

        // Voltar do link de recuperacao TAMBEM cria sessao. Sem separar
        // este caso do login normal, a pessoa cairia direto no app com a
        // senha antiga ainda valendo -- e ficaria trancada de novo depois.
        if (evento === 'PASSWORD_RECOVERY') {
          recuperando = true;
          ouvintesRecuperacao.forEach(function (fn) { try { fn(); } catch (e) {} });
          return;
        }
        avisar();
      });

      return cliente.auth.getSession().then(function (r) {
        usuarioAtual = (r.data && r.data.session) ? r.data.session.user : null;
        return usuarioAtual;
      });
    },

    usuario: function () { return usuarioAtual; },
    email: function () { return usuarioAtual ? usuarioAtual.email : ''; },
    cliente: function () { return cliente; },

    aoMudar: function (fn) { ouvintes.push(fn); },

    // Avisado quando a pessoa chega pelo link de "esqueci a senha".
    aoRecuperar: function (fn) { ouvintesRecuperacao.push(fn); },
    estaRecuperando: function () { return recuperando; },
    fimDaRecuperacao: function () { recuperando = false; },

    /* ---------- operações ---------- */

    // nome e cpf viajam como metadados do usuário; o gatilho no banco
    // os transforma na linha de perfil, dentro da mesma transação.
    criarConta: function (email, senha, nome, cpf) {
      var semCliente = exigirCliente(); if (semCliente) return semCliente;
      return comLimite(cliente.auth.signUp({
        email: email,
        password: senha,
        options: { data: { nome_completo: nome, cpf: cpf } }
      }))
        .then(function (r) {
          if (r.error) throw new Error(traduzir(r.error));

          // Com a confirmação de e-mail ligada, um e-mail já cadastrado NÃO
          // devolve erro: o Supabase responde "sucesso" com um usuário falso,
          // de propósito, para ninguém descobrir quem é cliente testando
          // e-mails. O sinal é a lista de identidades vir vazia.
          var u = r.data.user;
          if (u && u.identities && u.identities.length === 0) {
            throw new Error('Este e-mail já tem conta. Tente entrar.');
          }

          // Sem sessão na resposta = o projeto exige confirmar o e-mail
          return { precisaConfirmar: !r.data.session, usuario: u };
        });
    },

    entrar: function (email, senha) {
      var semCliente = exigirCliente(); if (semCliente) return semCliente;
      return comLimite(cliente.auth.signInWithPassword({ email: email, password: senha }))
        .then(function (r) {
          if (r.error) throw new Error(traduzir(r.error));
          return r.data.user;
        });
    },

    sair: function () {
      var semCliente = exigirCliente(); if (semCliente) return semCliente;
      return cliente.auth.signOut().then(function (r) {
        if (r.error) throw new Error(traduzir(r.error));
        usuarioAtual = null;
      });
    },

    // Vale so logo depois de voltar do link do e-mail: o Supabase abre
    // uma sessao temporaria, e e ela que autoriza a troca.
    trocarSenha: function (nova) {
      var semCliente = exigirCliente(); if (semCliente) return semCliente;
      return comLimite(cliente.auth.updateUser({ password: nova }))
        .then(function (r) {
          if (r.error) throw new Error(traduzir(r.error));
          return r.data.user;
        });
    },

    recuperarSenha: function (email) {
      var semCliente = exigirCliente(); if (semCliente) return semCliente;
      return comLimite(cliente.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname
      })).then(function (r) {
        if (r.error) throw new Error(traduzir(r.error));
      });
    }
  };

})(window.Fin);
