/* =========================================================
   login.js — tela de entrada e cadastro.

   Fica fora de screens.js de propósito: ela aparece ANTES do
   app existir, quando ainda não há dados nem navegação.
   ========================================================= */

window.Fin = window.Fin || {};

(function (Fin) {
  'use strict';

  var esc = Fin.esc;

  // modo: 'entrar' | 'criar' | 'recuperar'
  var estado = { modo: 'entrar', nome: '', email: '', cpf: '', senha: '',
               erro: '', aviso: '', ocupado: false };

  function campo(id, tipo, rotulo, valor, extra) {
    return '<div class="login-campo">' +
             '<label for="' + id + '">' + rotulo + '</label>' +
             '<input id="' + id + '" type="' + tipo + '" value="' + esc(valor || '') + '" ' +
               'data-login="' + id + '" ' + (extra || '') + '>' +
           '</div>';
  }

  Fin.login = {
    estado: estado,

    // Volta ao estado limpo, sem arrastar erro de uma tentativa anterior
    trocarModo: function (modo) {
      estado.modo = modo;
      estado.erro = '';
      estado.aviso = '';
    },

    html: function () {
      var e = estado;
      var criando = e.modo === 'criar';
      var recuperando = e.modo === 'recuperar';

      var h = '<div class="login">';

      h += '<div class="login-marca">' +
             '<div class="login-logo">' +
               '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V11M10 20V4M16 20v-6M22 20H2"/></svg>' +
             '</div>' +
             '<div class="login-nome">Minhas Finanças</div>' +
             '<div class="login-sub">' +
               (recuperando ? 'Recuperar a senha'
                            : criando ? 'Criar sua conta' : 'Entre para continuar') +
             '</div>' +
           '</div>';

      /* ---- app ainda não configurado ---- */
      if (!Fin.auth.configurado()) {
        return h +
          '<div class="login-card">' +
            '<div class="login-erro">Contas ainda não configuradas.</div>' +
            '<div class="login-ajuda">Preencha <b>SUPABASE_URL</b> e <b>SUPABASE_ANON_KEY</b> ' +
              'em <b>js/config.js</b>. Os valores estão em Project Settings → API, ' +
              'no painel do Supabase.</div>' +
          '</div>' +
        '</div>';
      }

      h += '<div class="login-card">';

      if (e.erro)  h += '<div class="login-erro">' + esc(e.erro) + '</div>';
      if (e.aviso) h += '<div class="login-aviso">' + esc(e.aviso) + '</div>';

      if (criando) {
        h += campo('nome', 'text', 'Nome completo', e.nome,
                   'autocomplete="name" autocapitalize="words" placeholder="Como no documento"');
      }

      h += campo('email', 'email', 'E-mail', e.email,
                 'inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false"');

      if (criando) {
        h += campo('cpf', 'text', 'CPF', e.cpf,
                   'inputmode="numeric" placeholder="000.000.000-00" maxlength="14"');
      }

      if (!recuperando) {
        h += campo('senha', 'password', 'Senha', e.senha,
                   'autocomplete="' + (criando ? 'new-password' : 'current-password') + '"');
        if (criando) {
          h += '<div class="login-dica">Pelo menos 6 caracteres.</div>';
        }
      }

      var rotuloBotao = recuperando ? 'Enviar link de recuperação'
                      : criando ? 'Criar conta' : 'Entrar';

      h += '<button class="login-botao" data-login-acao="enviar" type="button"' +
             (e.ocupado ? ' disabled' : '') + '>' +
             (e.ocupado ? 'Aguarde…' : rotuloBotao) +
           '</button>';

      /* ---- alternar entre os modos ---- */
      h += '<div class="login-links">';
      if (recuperando) {
        h += '<button data-login-acao="modo-entrar" type="button">Voltar para o login</button>';
      } else if (criando) {
        h += '<button data-login-acao="modo-entrar" type="button">Já tenho conta</button>';
      } else {
        h += '<button data-login-acao="modo-criar" type="button">Criar uma conta</button>' +
             '<button data-login-acao="modo-recuperar" type="button">Esqueci a senha</button>';
      }
      h += '</div>';

      h += '</div>';

      h += '<div class="login-rodape">' +
             'Seus lançamentos ficam no seu aparelho. A conta serve para ' +
             'sincronizar entre celular e computador.' +
           '</div>';

      return h + '</div>';
    }
  };

})(window.Fin);
