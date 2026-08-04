/* =========================================================
   store.js — categorias, persistência e formatação
   Tudo fica em localStorage: nada sai do aparelho.
   ========================================================= */

window.Fin = window.Fin || {};

(function (Fin) {
  'use strict';

  var CHAVE = 'fin_v1';

  Fin.CATS = [
    { name: 'Alimentação',    color: '#d9822b' },
    { name: 'Mercado',        color: '#2f9e6f' },
    { name: 'Gasolina',       color: '#c0492f' },
    { name: 'Uber',           color: '#6b57c9' },
    { name: 'Lazer',          color: '#c94f97' },
    { name: 'Compra virtual', color: '#3b76c9' },
    { name: 'Moradia',        color: '#b08427' },
    { name: 'Contas',         color: '#7a9a2e' },
    { name: 'Saúde',          color: '#2b9a9e' },
    { name: 'Assinaturas',    color: '#8b5cc9' },
    { name: 'Educação',       color: '#4a7dc9' },
    { name: 'Outros',         color: '#8a8c80' }
  ];

  Fin.INCOME_CATS = [
    { name: 'Salário',       color: '#1f8a5b' },
    { name: 'Freelance',     color: '#2b9a9e' },
    { name: 'Investimentos', color: '#3b76c9' },
    { name: 'Vendas',        color: '#d9822b' },
    { name: 'Reembolso',     color: '#6b57c9' },
    { name: 'Outros',        color: '#8a8c80' }
  ];

  Fin.MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
               'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  /* ---------- persistência ---------- */

  Fin.carregar = function () {
    var vazio = { tx: [], parcelas: [], goals: [] };
    try {
      var bruto = localStorage.getItem(CHAVE);
      if (!bruto) return vazio;
      var d = JSON.parse(bruto);
      return {
        tx:       Array.isArray(d.tx) ? d.tx : [],
        parcelas: Array.isArray(d.parcelas) ? d.parcelas : [],
        goals:    Array.isArray(d.goals) ? d.goals : []
      };
    } catch (e) {
      return vazio;
    }
  };

  Fin.salvar = function (dados) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify({
        tx: dados.tx, parcelas: dados.parcelas, goals: dados.goals
      }));
      return true;
    } catch (e) {
      // Cota estourada ou modo privado do navegador.
      return false;
    }
  };

  /* ---------- formulários em branco ---------- */

  Fin.formsEmBranco = function () {
    var hoje = Fin.hojeISO();
    return {
      out:     { amount: '', category: '', note: '', date: hoje, fixed: false },
      in:      { amount: '', category: '', note: '', date: hoje, fixed: false },
      parcela: { description: '', total: '', parcels: '', dueDay: '',
                 firstDue: hoje.slice(0, 7), card: '', category: '' },
      goal:    { name: '', target: '', saved: '' }
    };
  };

  /* ---------- datas ---------- */

  // Data local (não UTC) no formato AAAA-MM-DD, para o <input type="date">.
  Fin.hojeISO = function () {
    var d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  };

  // "2026-08-04" -> Date local. Evita o deslocamento de fuso do new Date(string).
  Fin.paraData = function (iso) {
    var p = String(iso || '').split('-');
    return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
  };

  // Índice absoluto de mês, para comparar ano+mês com uma conta só.
  Fin.indiceMes = function (data) {
    return data.getFullYear() * 12 + data.getMonth();
  };

  Fin.rotuloMes = function (indice) {
    return Fin.MESES[indice % 12] + '/' + String(Math.floor(indice / 12)).slice(2);
  };

  /* ---------- formatação ---------- */

  Fin.fmt = function (n) {
    return 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  };

  // Sem centavos — usado nos resumos de previsão.
  Fin.fmt0 = function (n) {
    return 'R$ ' + Math.round(Number(n) || 0).toLocaleString('pt-BR');
  };

  // Aceita "1.234,56", "1234,56" e "1234.56".
  Fin.parse = function (v) {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    var s = String(v).replace(/\s/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.');
    return parseFloat(s) || 0;
  };

  Fin.cor = function (nomeCategoria) {
    var achou = Fin.CATS.concat(Fin.INCOME_CATS).find(function (c) {
      return c.name === nomeCategoria;
    });
    return achou ? achou.color : '#8a8c80';
  };

  // Mesma cor em 11% de opacidade, para o fundo do ícone.
  Fin.tint = function (hex) { return hex + '1c'; };

  // Escapa texto do usuário antes de injetar no HTML.
  Fin.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

})(window.Fin);
