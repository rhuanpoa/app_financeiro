/* =========================================================
   sw.js — service worker.
   Deixa o app abrir sem internet depois da primeira visita.
   Suba o número da versão sempre que mexer no HTML/CSS/JS.
   ========================================================= */

var VERSAO = 'financas-v2';

var ARQUIVOS = [
  './',
  './index.html',
  './css/style.css',
  './js/store.js',
  './js/calc.js',
  './js/screens.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(VERSAO)
      .then(function (c) { return c.addAll(ARQUIVOS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys()
      .then(function (chaves) {
        return Promise.all(chaves.map(function (k) {
          return k === VERSAO ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;

  // Navegação: tenta a rede primeiro, para pegar versões novas do app.
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // Demais arquivos: cache primeiro (abre instantâneo e funciona offline).
  ev.respondWith(
    caches.match(req).then(function (achado) {
      if (achado) return achado;
      return fetch(req).then(function (resp) {
        // Guarda só o que é do próprio site; as fontes do Google ficam de fora.
        if (resp.ok && new URL(req.url).origin === location.origin) {
          var copia = resp.clone();
          caches.open(VERSAO).then(function (c) { c.put(req, copia); });
        }
        return resp;
      });
    })
  );
});
