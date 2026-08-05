# Minhas Finanças

App de controle de finanças pessoais para usar no celular. Roda direto no navegador,
sem servidor e sem cadastro — os dados ficam salvos no próprio aparelho.

## O que tem

- **Saldo** com entradas e saídas do mês
- **Lançamentos** de saída/entrada com categoria, data e a opção "repete todo mês"
- **Importar extrato do banco** em OFX ou CSV, com categoria sugerida
  automaticamente e revisão antes de entrar no caixa
- **Movimentações**: o que veio do extrato, com filtro por conta
- **Compras parceladas** com acompanhamento de quantas parcelas já foram pagas
- **Previsão de 12 meses** (entradas fixas − gastos fixos − parcelas − média de gastos variáveis)
- **Histórico** agrupado por mês
- **Categorias**: totais por categoria (saídas e entradas) e criação de
  categorias próprias, com cor à escolha
- **Metas de economia**
- **Backup**: exportar/restaurar um arquivo `.json`

## Navegação

Barra fixa embaixo com os atalhos do dia a dia — **Início**, **Previsão**, o
botão **+**, **Extrato** e **Menu**. O botão *Menu* (e o botão redondo no canto
do Início) abre o menu lateral, que lista todas as páginas: Movimentações,
Histórico, Categorias, Metas, Parcelas, importar extrato e backup.

A aba *Extrato* mostra um contador vermelho quando há movimentações
importadas esperando revisão.

## Estrutura

```
index.html               estrutura, barra de navegação e menu lateral
css/style.css            todo o visual
js/store.js              categorias, localStorage, formatação (R$, datas)
js/calc.js               cálculos: saldo, previsão, parcelas, categorias, metas
js/importar.js           leitura de extrato (OFX e CSV) e palpite de categoria
js/screens.js            HTML de cada tela
js/app.js                estado, navegação e eventos
manifest.webmanifest     dados para instalar na tela inicial
sw.js                    service worker (faz o app abrir sem internet)
icons/                   ícones do app
Financas.dc.html         design original exportado do Claude Design (referência)
```

## Rodar no computador

Precisa de um servidor local — abrir o arquivo direto (`file://`) desliga o
service worker e o localStorage em alguns navegadores.

```bash
python -m http.server 8000
# depois abra http://localhost:8000
```

## Publicar no GitHub Pages

1. Suba o repositório para o GitHub.
2. Vá em **Settings → Pages**.
3. Em *Source*, escolha **Deploy from a branch**.
4. Branch: **main**, pasta: **/ (root)**. Salve.
5. Em 1–2 minutos o app fica em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

## Instalar no celular

Abra o link do Pages no celular e:

- **Android (Chrome):** menu ⋮ → *Instalar app* / *Adicionar à tela inicial*
- **iPhone (Safari):** botão compartilhar → *Adicionar à Tela de Início*

Depois disso ele abre em tela cheia, sem a barra do navegador, e funciona offline.

## Depois de atualizar o app

O service worker guarda os arquivos em cache. Ao publicar uma mudança, aumente a
versão em `sw.js`:

```js
var VERSAO = 'financas-v2';   // era v1
```

Sem isso o celular pode continuar abrindo a versão antiga.

## Importar extrato

No app do banco, procure por **exportar OFX** (às vezes chamado de "Money",
"MSMoney" ou "OFX") ou **exportar CSV**. Depois, no app: menu → *Importar
extrato* → escolher o arquivo.

- **OFX** é o melhor formato: cada transação vem com um código único (`FITID`),
  então dá para reimportar o mesmo extrato sem duplicar nada.
- **CSV** também funciona. As colunas de data, descrição e valor são
  reconhecidas sozinhas, em português ou inglês, inclusive quando crédito e
  débito vêm em colunas separadas. Sem `FITID`, a repetição é detectada por
  data + valor + descrição.
- **PDF ainda não é suportado**: cada banco usa um layout diferente, então
  não existe leitura genérica confiável.

O que é importado fica numa fila de revisão em *Movimentações* e **não entra no
saldo até você confirmar**. O arquivo é lido dentro do próprio navegador —
nada é enviado para a internet.

## Sobre os dados

Ficam só no `localStorage` deste navegador, neste aparelho. **Não há backup
automático.** Limpar os dados do navegador apaga tudo — use *Mais → Exportar
backup* de vez em quando.
