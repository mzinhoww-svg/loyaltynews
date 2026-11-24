#!/usr/bin/env node
// Baixa o `.next` JÁ CONSTRUÍDO NA VERTRA (Linux, caminhos /app/...) de um app pela API de arquivos, para montar o pacote PRÉ-CONSTRUÍDO (package-prebuilt.mjs). SÓ LEITURA na Vertra (GET).
// A chave vem SÓ do ambiente do processo (VERTRA_API_KEY, escopo apps:files): não é argumento, nunca é impressa nem gravada, nem em erro. Rode pelo script do PM (credenciais-sem-expor.md).
// Uso: VERTRA_API_KEY=… node infra/scripts/baixar-next-vertra.mjs --app <id> --dest <pasta nova> [--path apps/web/.next] [--api https://api.vertracloud.app]
//        [--rpm 240] [--concorrencia 4] [--progresso <arquivo.json>] [--incluir-tudo] [--somente a/b,c/d] [--timeout-pedido 30] [--retomar] [--sonda | --medir [--sem-carga-real]]
//   --sonda    uma listagem + a leitura do BUILD_ID, imprime só o FORMATO (chaves/tipos) e sai; não grava nada. Rode antes do download completo.
//   --progresso grava, a cada 100 arquivos, um JSON pequeno (baixados, descobertos, erros, fila) para olhar uma execução destacada; não tem limite de tempo próprio.
//   --medir    mede a latência por pedido e a vazão com 1, 2, 4, 8 e 16 em paralelo lendo o BUILD_ID (~100 pedidos, ~1 min com --rpm 280; não grava nada), recomenda a concorrência e avisa se a API colapsa; depois mede a CARGA REAL (listagens das pastas grandes e arquivos distintos com 1, 2 e 4 em paralelo; `--sem-carga-real` pula).
//   --timeout-pedido <s>  tempo máximo de CADA pedido (padrão 30 s; antes 60 s fixos); estourou = nova tentativa. O relatório traz diagnostico (histograma de latência, pedidos >= 8 s, timeouts, 429, 5xx).
//   --somente <a/b,c/d>  baixa SÓ essas subpastas da raiz (caminhos relativos à raiz, separados por vírgula; ex.: server/app/api/auth,server/app/api/studio/social), sem relistar o resto: serve para COMPLETAR um download que perdeu pastas (use com --retomar, no mesmo --dest). Depois rode o package-prebuilt: ele confere a completude pelos manifestos do Next.
//   --incluir-tudo  baixa também *.map e *.nft.json (por padrão ficam de fora: o next start não os usa; ~36% dos arquivos).
//   --retomar  pula arquivo já baixado com o tamanho certo (cai a conexão ou o limite da API: repita o comando).
// Fica de fora (não serve ao pacote): cache, diagnostics, trace, trace-build. Em node_modules grava só PASTAS VAZIAS com os nomes dos externos (a restauração recria os links).
// Binários chegam em base64 (encoding "base64") e são gravados como bytes. Nomes vêm de terceiros: só entram nomes simples (sem /, barra invertida, .., :, controle).
// Limite da API (pro-8): 300 req/min; o padrão aqui é 240/min com **4 em paralelo**: MEDIDO no staging real em 24/11 (`--medir`): 4 em voo = 281 pedidos/min, 16 = 24/min, 32 = 32/min; a API de arquivos COLAPSA acima de ~4 pedidos simultâneos, então NÃO suba a concorrência sem rodar `--medir` de novo. Respeita 429 (retry_after). Relatório em <dest>.relatorio.json (contagens e nomes de erro; nenhum conteúdo, nenhuma chave).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/util.mjs';

export const FORA_DA_RAIZ = new Set(['cache', 'diagnostics', 'trace', 'trace-build']);
// Arquivos que o `next start` NÃO usa e que são ~36% dos do .next (24/11: 1109 de 3076): source maps do servidor (*.map) e os rastros de build (*.nft.json). Provado com `next start` num .next sem eles:
// 11 rotas 200, cache 19/0, segurança 8/0, nenhum erro no log, home idêntica à do .next completo. `--incluir-tudo` os baixa.
export const PADRAO_EXCLUIDO = /\.(?:map|nft\.json)$/;

/** Estatística simples de uma lista de tempos em ms (função pura). */
export function estatistica(ms) {
  if (!ms.length) return { n: 0, p50: null, p95: null, max: null, media: null };
  const o = [...ms].sort((a, b) => a - b);
  const q = (p) => o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))];
  return { n: o.length, p50: q(50), p95: q(95), max: o[o.length - 1], media: Math.round(o.reduce((s, x) => s + x, 0) / o.length) };
}

/** Só nomes simples de arquivo/pasta (os nomes vêm de terceiros). Função pura. */
export function nomeSeguro(nome) {
  const n = String(nome ?? '');
  const barra = String.fromCharCode(92);
  if (!n || n.length > 255) return false;
  // Nome só de pontos ('.', '..', '...'): no Windows os pontos finais somem e o nome vira a pasta pai. Ponto ou espaço NO FIM também some no Windows e apelida outro arquivo.
  if (/^\.+$/.test(n) || /[. ]$/.test(n)) return false;
  // Nunca separador de caminho nem ':' (unidade/fluxo do Windows). `..` DENTRO de um único segmento é legítimo e inofensivo (sem separador não há como sair da pasta):
  // pastas catch-all do App Router ([...all], [[...slug]]) e rotas interceptadas ((..)foto, (...)foto, (..)(..)foto). O erro de 24/11 foi recusar qualquer nome com '..'.
  if (n.includes('/') || n.includes(barra) || n.includes(':')) return false;
  for (let i = 0; i < n.length; i += 1) if (n.charCodeAt(i) < 32 || n.charCodeAt(i) === 127) return false;
  return true;
}

const LISTAS = ['files', 'entries', 'items', 'data', 'children', 'contents', 'nodes'];
const ehDir = (e) => e?.type === 'dir' || e?.type === 'directory' || e?.type === 'folder' || e?.is_dir === true || e?.isDir === true || e?.isDirectory === true || e?.directory === true || e?.kind === 'directory';
const nomeDe = (e) => String(e?.name ?? e?.nome ?? String(e?.path ?? '').split('/').filter(Boolean).pop() ?? '');

const ENVELOPES = ['response', 'result', 'untrusted_content', 'payload', 'body'];
const META_DO_ENVELOPE = /^(status|ok|success|message|meta|request_id)$/;

/**
 * Desembrulha o envelope da API (`{ response: ... }` e parentes), até 4 níveis, só quando o envelope é a ÚNICA chave de dados (metadados como status/ok/meta podem ficar ao lado).
 * Com `texto: true` (só listagem) um envelope cujo valor é TEXTO JSON também é aberto; em conteúdo de arquivo isso nunca vale (um arquivo .json seria reescrito). Função pura.
 */
export function desembrulhar(j, { texto = false } = {}) {
  let x = j;
  for (let i = 0; i < 4; i += 1) {
    if (texto && typeof x === 'string' && /^\s*[[{]/.test(x)) { try { x = JSON.parse(x); continue; } catch { break; } }
    if (!x || typeof x !== 'object' || Array.isArray(x)) break;
    const env = ENVELOPES.find((k) => k in x && Object.keys(x).every((k2) => k2 === k || META_DO_ENVELOPE.test(k2)));
    if (!env) break;
    x = x[env];
  }
  return x;
}

/** A FORMA de uma resposta: só nomes de chaves e tipos, nunca valores (para a mensagem de erro e a sonda). Função pura. */
export function formaDe(j, nivel = 4) {
  if (Array.isArray(j)) return nivel <= 0 || j.length === 0 ? '[]' : `[${formaDe(j[0], nivel - 1)}]`;
  if (j && typeof j === 'object') return nivel <= 0 ? '{…}' : `{${Object.keys(j).slice(0, 12).map((k) => `${k}:${formaDe(j[k], nivel - 1)}`).join(',')}}`;
  return j === null ? 'null' : typeof j;
}

const pareceEntrada = (e) => typeof e === 'string' || (e && typeof e === 'object' && ('name' in e || 'nome' in e || 'path' in e));
function acharLista(x, nivel) {
  if (Array.isArray(x)) return x;
  if (!x || typeof x !== 'object' || nivel < 0) return null;
  for (const k of LISTAS) if (Array.isArray(x[k])) return x[k];
  for (const k of Object.keys(x)) {
    const v = desembrulhar(x[k], { texto: true });
    if (Array.isArray(v) && v.length && v.every(pareceEntrada)) return v;
    if (v && typeof v === 'object' && !Array.isArray(v)) { const r = acharLista(v, nivel - 1); if (r) return r; }
  }
  return null;
}

/** Normaliza a resposta de listagem em [{ nome, dir, tamanho }]. Desembrulha `response`. Formato desconhecido: lança com a FORMA (nomes e tipos, nunca valores). Função pura. */
export function normalizarListagem(json) {
  const lista = acharLista(desembrulhar(json, { texto: true }), 3);
  if (!lista) throw new Error(`formato de listagem não reconhecido (forma: ${formaDe(json)})`);
  return lista.map((e) => {
    if (typeof e === 'string') return { nome: e.replace(/\/+$/, ''), dir: e.endsWith('/'), tamanho: null };
    // size vem como TEXTO na API real ("size: string"): "21" ou "21 B" conferem; tamanho "humano" ("1.2 KB") ou vazio = null (a leitura traz o size em número e confere)
    return { nome: nomeDe(e), dir: ehDir(e), tamanho: tamanhoDe(e?.size ?? e?.bytes ?? e?.length) };
  });
}

/** Tamanho em bytes de um valor da API: número, "123" ou "123 B". Tamanho "humano" ("1.2 KB"), vazio ou lixo = null (não serve para conferir). Função pura. */
export function tamanhoDe(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  const m = /^\s*(\d+)\s*(?:B|bytes?)?\s*$/i.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
}

const TIPOS_TEXTO = ['text', 'utf8', 'utf-8', 'string', 'plain'];

/**
 * Decodifica o `data` de uma leitura pelo `type` declarado e CONFERE o `size` declarado (a leitura não pode sair corrompida em silêncio): base64 -> bytes; texto -> utf-8
 * (o size pode contar bytes ou caracteres); tipo desconhecido só passa se o size resolver a dúvida. Lança sem eco do conteúdo. Função pura.
 */
export function decodificarLeitura(data, tipo, size) {
  const t = String(tipo ?? '').toLowerCase();
  const tamanho = tamanhoDe(size);
  const rotulo = `type ${t.replace(/[^a-z0-9_-]/g, '').slice(0, 20) || '(vazio)'}, size ${tamanho ?? '(ausente)'}`;
  const b64 = () => Buffer.from(data, 'base64');
  const txt = () => Buffer.from(data, 'utf8');
  if (t === 'base64') { const b = b64(); if (tamanho === null || b.length === tamanho) return b; throw new Error(`conteúdo com tamanho diferente do declarado (${rotulo}, veio ${b.length})`); }
  if (TIPOS_TEXTO.includes(t)) { const b = txt(); if (tamanho === null || b.length === tamanho || data.length === tamanho) return b; throw new Error(`conteúdo com tamanho diferente do declarado (${rotulo}, veio ${b.length})`); }
  if (tamanho === null) throw new Error(`tipo de conteúdo desconhecido sem size para conferir (${rotulo})`);
  for (const f of [b64, txt]) { const b = f(); if (b.length === tamanho) return b; }
  throw new Error(`tipo de conteúdo desconhecido e o size não confere (${rotulo})`);
}

/**
 * Resposta de leitura -> Buffer. Formato REAL da Vertra (sonda de 24/11): { response: { type, data, size, last_modified } } (type "base64" em geral; data = bytes em base64).
 * Também aceita o envelope antigo { content, encoding } e { response: "texto" }; qualquer outra coisa = os bytes como vieram. Função pura.
 */
export function normalizarConteudo(corpo, contentType = '') {
  const ehJson = /json/i.test(contentType) || (corpo.length > 1 && corpo[0] === 0x7b);
  if (!ehJson) return corpo;
  let bruto;
  try { bruto = JSON.parse(corpo.toString('utf8')); } catch { return corpo; }
  const j = desembrulhar(bruto); // { response: ... } e parentes
  if (typeof j === 'string' && j !== bruto && bruto && typeof bruto === 'object') return Buffer.from(j, 'utf8'); // { response: "texto do arquivo" }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return corpo;
  if (typeof j.data === 'string' && 'type' in j) return decodificarLeitura(j.data, j.type, j.size); // a decodificação lança (tamanho/tipo): erro do arquivo, nunca bytes errados
  const c = j.content ?? j.data?.content;
  if (typeof c === 'string') {
    const enc = String(j.encoding ?? j.data?.encoding ?? 'utf-8').toLowerCase();
    return enc === 'base64' ? Buffer.from(c, 'base64') : Buffer.from(c, 'utf8');
  }
  return corpo;
}

class Limite {
  constructor(rpm) { this.base = 60000 / Math.max(1, rpm); this.intervalo = this.base; this.proximo = 0; this.boas = 0; }
  /** 429: a taxa cai 1,5x (no mínimo 10/min); a espera comum fica mais longa. */
  reduzir() { this.boas = 0; this.intervalo = Math.min(this.intervalo * 1.5, 6000); }
  /** Cada 25 respostas boas seguidas: a taxa volta 10% em direção à configurada. */
  aliviar() { this.boas += 1; if (this.boas >= 25) { this.boas = 0; this.intervalo = Math.max(this.base, this.intervalo * 0.9); } }
  rpmAtual() { return Math.round(60000 / this.intervalo); }
  async esperar() { const agora = Date.now(); const t = Math.max(agora, this.proximo); this.proximo = t + this.intervalo; if (t > agora) await new Promise((r) => setTimeout(r, t - agora)); }
}

function cliente({ api, chave, app, rpm, parametro = 'path', timeoutPedidoMs = 30000, espera429MinMs = 2000, espera429MaxMs = 120000 }) {
  const limite = new Limite(rpm);
  let pedidos = 0;
  const lat = []; // tempo (ms) de cada pedido bem-sucedido, DEPOIS da espera do limitador: é a latência da API
  // Diagnóstico (24/11: o download real fez ~22 pedidos/min contra 281/min do --medir): histograma de latência, pedidos lentos (>= 8 s), timeouts e 429/5xx
  const diag = { timeouts: 0, http429: 0, http5xx: 0, pausasPorCabecalho: 0 };
  const esperas429 = []; // segundos de espera mandados pela API em cada 429
  let rateLimit = null; // último x-ratelimit-limit/remaining/reset visto (só números)
  let pausaAte = 0; // PAUSA GLOBAL: um 429 (ou o aviso dos cabeçalhos) para TODOS os pedidos até este instante; antes cada trabalhador dormia sozinho e voltava a bater junto (24/11: ~248 falhas x ~55 s)
  const faixas = { 'ate1s': 0, '1a5s': 0, '5a15s': 0, '15a60s': 0, 'mais60s': 0 };
  const lentos = [];
  const get = async (rota, caminho) => {
    let vezes429 = 0;
    for (let tentativa = 0; tentativa < 6; tentativa += 1) {
      const pausa = pausaAte - Date.now();
      if (pausa > 0) await new Promise((s) => setTimeout(s, pausa));
      await limite.esperar();
      pedidos += 1;
      const t0 = Date.now();
      let r;
      try {
        r = await fetch(`${api}/v1/apps/${encodeURIComponent(app)}/${rota}?${parametro}=${encodeURIComponent(caminho)}`, { headers: { authorization: `Bearer ${chave}`, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutPedidoMs) });
      } catch (e) { if (e?.name === 'TimeoutError' || e?.cause?.name === 'TimeoutError') diag.timeouts += 1; if (tentativa === 5) throw new Error(`rede: ${e?.cause?.code ?? e?.name}`, { cause: e }); await new Promise((s) => setTimeout(s, 1000 * (tentativa + 1))); continue; }
      // cabeçalhos de limite (docs: x-ratelimit-limit/remaining/reset em chamadas com chave): registra o limite REAL informado e, com quase nada sobrando, espera a janela virar em vez de tomar 429
      const hl = r.headers.get('x-ratelimit-limit'); const hr = r.headers.get('x-ratelimit-remaining'); const hs = r.headers.get('x-ratelimit-reset');
      if (hl !== null && Number.isFinite(Number(hl))) {
        rateLimit = { limit: Number(hl), remaining: Number(hr), reset: Number(hs) };
        if (Number.isFinite(rateLimit.remaining) && rateLimit.remaining <= 2 && Number.isFinite(rateLimit.reset) && rateLimit.reset > 0) {
          const resetMs = rateLimit.reset > 1e9 ? rateLimit.reset * 1000 - Date.now() : rateLimit.reset * 1000; // época em segundos ou segundos até a janela virar
          const ate = Date.now() + Math.min(Math.max(resetMs, 0), 65000);
          if (ate > pausaAte) { pausaAte = ate; diag.pausasPorCabecalho += 1; }
        }
      }
      if (r.status === 429) {
        diag.http429 += 1;
        let espera = Number(r.headers.get('retry-after')) || 0;
        try { const j = await r.clone().json(); espera = Number(j?.details?.retry_after ?? j?.retry_after ?? espera) || espera; } catch { /* sem corpo */ }
        const esperaMs = Math.min(espera429MaxMs, Math.max(espera429MinMs, espera * 1000));
        esperas429.push(Math.round(esperaMs / 100) / 10);
        pausaAte = Math.max(pausaAte, Date.now() + esperaMs); // TODOS esperam o mesmo retry_after
        limite.reduzir();
        vezes429 += 1;
        if (vezes429 > 20) throw new Error('429 persistente (20 respostas seguidas)');
        tentativa -= 1; // 429 não gasta uma das 6 tentativas de falha de rede/5xx
        continue;
      }
      if (r.status >= 500) diag.http5xx += 1;
      if (r.status >= 500 && tentativa < 5) { await new Promise((s) => setTimeout(s, 1000 * (tentativa + 1))); continue; }
      const corpo = Buffer.from(await r.arrayBuffer());
      if (!r.ok) {
        let codigo = '';
        try { codigo = String(JSON.parse(corpo.toString('utf8'))?.code ?? ''); } catch { /* sem json */ }
        throw new Error(`HTTP ${r.status}${codigo ? ` ${codigo.replace(/[^A-Z0-9_]/g, '').slice(0, 40)}` : ''}`);
      }
      const ms = Date.now() - t0;
      lat.push(ms);
      limite.aliviar();
      faixas[ms < 1000 ? 'ate1s' : ms < 5000 ? '1a5s' : ms < 15000 ? '5a15s' : ms < 60000 ? '15a60s' : 'mais60s'] += 1;
      if (ms >= 8000) lentos.push({ rota, caminho: String(caminho).slice(-110), ms });
      return { corpo, tipo: r.headers.get('content-type') ?? '' };
    }
    throw new Error('limite de tentativas');
  };
  const formas = {};
  return {
    listar: async (c) => { const bruto = JSON.parse((await get('files', c)).corpo.toString('utf8')); formas.listagem = formaDe(bruto); return normalizarListagem(bruto); },
    ler: async (c) => { const x = await get('files/content', c); try { formas.leitura = formaDe(JSON.parse(x.corpo.toString('utf8'))); } catch { formas.leitura = 'texto ou binário cru'; } return normalizarConteudo(x.corpo, x.tipo); },
    formas: () => ({ ...formas }),
    pedidos: () => pedidos,
    latencias: () => estatistica(lat),
    diag: () => ({ ...diag, esperas429: { ...estatistica(esperas429.map((x) => x * 1000)), unidade: 'ms' }, rateLimit, rpmAtual: limite.rpmAtual(), faixas: { ...faixas }, lentos: [...lentos].sort((a, b) => b.ms - a.ms).slice(0, 25) }),
  };
}

/**
 * Mede a API de arquivos (só leitura de UM arquivo pequeno, o BUILD_ID): latência por pedido em sequência e a vazão (pedidos/min) com mais pedidos em paralelo, para escolher
 * a concorrência. Se a vazão não cresce com a concorrência, a API serializa e subir não adianta. Não grava nada. Respeita o limitador (`rpm`): use --rpm alto (<= 280) para medir.
 */
/**
 * PURA (testada com números fixos): dado [{ concorrencia, pedidosPorMin }] devolve a concorrência recomendada (só vale subir se ganhar mais de 15% sobre a melhor até ali) e, se algum nível
 * ACIMA da recomendada render menos da METADE dela, o aviso de colapso da API (medido no staging real em 24/11: 4 em voo = 281/min, 16 = 24/min, 32 = 32/min).
 */
export function analisarNiveis(niveis) {
  let melhor = niveis[0];
  for (const r of niveis) if (r.pedidosPorMin > melhor.pedidosPorMin * 1.15) melhor = r;
  const colapso = niveis.find((r) => r.concorrencia > melhor.concorrencia && r.pedidosPorMin < melhor.pedidosPorMin / 2);
  return {
    recomendada: melhor.concorrencia,
    ...(colapso ? { colapsoAPartirDe: colapso.concorrencia, avisoColapso: `a API COLAPSA com ${colapso.concorrencia} pedidos em voo (${colapso.pedidosPorMin}/min contra ${melhor.pedidosPorMin}/min com ${melhor.concorrencia}): use --concorrencia ${melhor.concorrencia}` } : {}),
  };
}

export async function medir({ app, raiz = 'apps/web/.next', api = 'https://api.vertracloud.app', rpm = 280, chave, niveis = [1, 2, 4, 8, 16], por = 3, sequenciais = 6, real = true, timeoutPedidoMs = 30000 }) {
  const c = cliente({ api, chave, app, rpm, timeoutPedidoMs });
  const alvo = `${raiz}/BUILD_ID`;
  const seq = [];
  for (let i = 0; i < sequenciais; i += 1) { const t = Date.now(); await c.ler(alvo); seq.push(Date.now() - t); }
  const resultado = [];
  for (const n of niveis) {
    const total = n * por;
    const t = Date.now();
    await Promise.all(Array.from({ length: n }, async () => { for (let i = 0; i < por; i += 1) await c.ler(alvo); }));
    const ms = Date.now() - t;
    resultado.push({ concorrencia: n, pedidos: total, ms, pedidosPorMin: Math.round((total / Math.max(1, ms)) * 60000) });
  }
  const analise = analisarNiveis(resultado);
  const cargaReal = real ? await medirCargaReal(c, raiz) : undefined;
  return { sequencial: estatistica(seq), niveis: resultado, ...analise, ...(cargaReal ? { cargaReal } : {}), diagnostico: c.diag(), limiteRpmUsado: rpm, aviso: 'a vazão máxima possível é o rpm configurado; se pedidosPorMin ficar perto do rpm, o limitador é o gargalo, não a API' };
}

/**
 * Carga REAL (24/11: o --medir lendo sempre o BUILD_ID deu 281 pedidos/min e o download real só ~22/min): o mesmo BUILD_ID pode vir de cache do servidor, enquanto o download lê arquivos
 * DISTINTOS e lista pastas com ~1000 entradas. Aqui: lista as pastas grandes conhecidas do Turbopack (server/chunks/ssr, server/chunks, server/app, static/chunks) e a raiz, medindo o tempo
 * de cada listagem e o número de entradas; depois lê ARQUIVOS DISTINTOS (nunca o mesmo duas vezes) com 1, 2 e 4 em paralelo. Só leitura; nada é gravado.
 */
export async function medirCargaReal(c, raiz, { niveis = [1, 2, 4], por = 12, maxListagens = 12 } = {}) {
  const listagens = [];
  const arquivos = [];
  const precisa = por * niveis.length;
  const fila = ['server/chunks/ssr', 'server/chunks', 'server/app', 'static/chunks', ''];
  const vistos = new Set();
  while (fila.length && listagens.length < maxListagens && arquivos.length < precisa) {
    const rel = fila.shift();
    if (vistos.has(rel)) continue;
    vistos.add(rel);
    const caminho = rel ? `${raiz}/${rel}` : raiz;
    const t = Date.now();
    let itens;
    try { itens = await c.listar(caminho); } catch { listagens.push({ pasta: rel || '(raiz)', erro: true, ms: Date.now() - t }); continue; }
    listagens.push({ pasta: rel || '(raiz)', entradas: itens.length, ms: Date.now() - t });
    for (const it of itens) {
      if (!nomeSeguro(it.nome)) continue;
      if (it.dir) { if (!rel && !FORA_DA_RAIZ.has(it.nome) && it.nome !== 'node_modules') fila.push(it.nome); } else if (!PADRAO_EXCLUIDO.test(it.nome)) arquivos.push(rel ? `${rel}/${it.nome}` : it.nome);
    }
  }
  const resultado = [];
  let ponteiro = 0;
  for (const n of niveis) {
    const lote = arquivos.slice(ponteiro, ponteiro + por);
    ponteiro += por;
    if (lote.length < por) { resultado.push({ concorrencia: n, aviso: `só ${lote.length} arquivo(s) distintos disponíveis` }); continue; }
    let i = 0;
    let bytes = 0;
    const t = Date.now();
    await Promise.all(Array.from({ length: n }, async () => { while (i < lote.length) { const a = lote[i]; i += 1; try { bytes += (await c.ler(`${raiz}/${a}`)).length; } catch { /* conta como lento/erro no diagnóstico */ } } }));
    const ms = Date.now() - t;
    resultado.push({ concorrencia: n, pedidos: lote.length, ms, bytes, pedidosPorMin: Math.round((lote.length / Math.max(1, ms)) * 60000), kbPorSeg: Math.round(bytes / 1024 / Math.max(0.001, ms / 1000)) });
  }
  return { listagens, niveis: resultado, arquivosDistintosAmostrados: Math.min(arquivos.length, ponteiro) };
}

export async function baixar({ app, destino, raiz = 'apps/web/.next', api = 'https://api.vertracloud.app', rpm = 240, concorrencia = 4, retomar = false, incluirTudo = false, somente = [], chave, log = () => {}, progresso = null, timeoutPedidoMs = 30000, espera429MinMs = 2000 }) {
  const c = cliente({ api, chave, app, rpm, timeoutPedidoMs, espera429MinMs });
  const rel = { app, raiz, arquivos: 0, bytes: 0, binarios: 0, pulados: 0, excluidosPorPadrao: 0, externos: [], ignorados: [], erros: [], inicio: new Date().toISOString() };
  const dest = resolve(destino);
  const dentro = (p) => { const r = resolve(p); return r === dest || r.startsWith(dest + sep); };
  mkdirSync(dest, { recursive: true });
  // Fila ÚNICA de tarefas (pasta ou arquivo): a listagem das pastas e o download dos arquivos andam JUNTOS e em paralelo. Antes a travessia era sequencial (uma pasta por vez) e só
  // depois baixava (24/11: 1590 arquivos em 1 h com 4 em paralelo = ~26/min, muito abaixo dos 300/min do plano: o gargalo era a latência, não o limite).
  // --somente: só estas subpastas da raiz (caminhos relativos, ex.: server/app/api/auth), sem relistar o resto: para completar um download que perdeu pastas.
  const partes = somente.map((p) => String(p).split('/').filter(Boolean));
  for (const seg of partes) if (!seg.length || !seg.every(nomeSeguro)) throw new Error(`--somente com caminho inválido: ${JSON.stringify(seg.join('/')).slice(0, 80)}`);
  const fila = partes.length ? partes.map((seg) => ({ tipo: 'dir', remoto: `${raiz}/${seg.join('/')}`, local: join(dest, ...seg), nivel: seg.length })) : [{ tipo: 'dir', remoto: raiz, local: dest, nivel: 0 }];
  for (const t of fila) mkdirSync(t.local, { recursive: true });
  let ativos = 0;
  let descobertos = 0;
  const gravarProgresso = () => {
    if (!progresso) return;
    try { writeFileSync(progresso, JSON.stringify({ app, raiz, baixados: rel.arquivos, descobertos, pulados: rel.pulados, bytes: rel.bytes, erros: rel.erros.length, naFila: fila.length, ativos, pedidos: c.pedidos(), atualizadoEm: new Date().toISOString() }) + '\n'); } catch { /* progresso é só para olhar */ }
  };
  const listarPasta = async (d) => {
    let itens;
    try { itens = await c.listar(d.remoto); } catch (e) { rel.erros.push(`listar ${d.remoto}: ${e.message}`); return; }
    for (const it of itens) {
      if (!nomeSeguro(it.nome)) { rel.erros.push(`nome recusado em ${d.remoto}: ${JSON.stringify(String(it.nome)).slice(0, 80)}`); continue; }
      const remoto = `${d.remoto}/${it.nome}`;
      const local = join(d.local, it.nome);
      if (!dentro(local)) { rel.erros.push(`caminho fora do destino em ${d.remoto}`); continue; }
      if (d.nivel === 0 && FORA_DA_RAIZ.has(it.nome)) { rel.ignorados.push(it.nome); continue; }
      if (d.nivel === 0 && it.nome === 'node_modules' && it.dir) { fila.push({ tipo: 'dir', remoto, local, nivel: -1 }); mkdirSync(local, { recursive: true }); continue; }
      if (d.nivel === -1) { // dentro de .next/node_modules: só NOMES (pastas vazias); @escopo entra um nível
        mkdirSync(local, { recursive: true });
        if (it.nome.startsWith('@')) fila.push({ tipo: 'dir', remoto, local, nivel: -1 }); else rel.externos.push(it.nome);
        continue;
      }
      if (!it.dir && !incluirTudo && PADRAO_EXCLUIDO.test(it.nome)) { rel.excluidosPorPadrao += 1; continue; } // *.map e *.nft.json: o next start não usa (ver PADRAO_EXCLUIDO)
      if (it.dir) { mkdirSync(local, { recursive: true }); fila.push({ tipo: 'dir', remoto, local, nivel: d.nivel + 1 }); } else { descobertos += 1; fila.push({ tipo: 'arq', remoto, local, tamanho: it.tamanho }); }
    }
  };
  const baixarArquivo = async (a) => {
    try {
      if (retomar && existsSync(a.local) && a.tamanho !== null && statSync(a.local).size === a.tamanho) { rel.pulados += 1; return; }
      const buf = await c.ler(a.remoto);
      if (a.tamanho !== null && buf.length !== a.tamanho) { rel.erros.push(`tamanho de ${a.remoto.slice(raiz.length)}: esperado ${a.tamanho}, veio ${buf.length}`); return; }
      mkdirSync(dirname(a.local), { recursive: true });
      writeFileSync(a.local, buf);
      rel.arquivos += 1; rel.bytes += buf.length;
      if (buf.includes(0)) rel.binarios += 1;
      if (rel.arquivos % 100 === 0) { log(`${rel.arquivos}/${descobertos} arquivos`); gravarProgresso(); }
    } catch (e) { rel.erros.push(`ler ${a.remoto.slice(raiz.length)}: ${e.message}`); }
  };
  const trabalhador = async () => {
    for (;;) {
      const t = fila.shift();
      if (!t) { if (ativos === 0) return; await new Promise((r) => setTimeout(r, 20)); continue; }
      ativos += 1;
      try { await (t.tipo === 'dir' ? listarPasta(t) : baixarArquivo(t)); } finally { ativos -= 1; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concorrencia) }, trabalhador));
  gravarProgresso();
  rel.pedidos = c.pedidos(); rel.latenciaMs = c.latencias(); rel.diagnostico = c.diag(); rel.fim = new Date().toISOString();
  rel.buildId = existsSync(join(dest, 'BUILD_ID')) ? readFileSync(join(dest, 'BUILD_ID'), 'utf8').trim() : null;
  return rel;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chave = process.env.VERTRA_API_KEY;
  if (!chave) { console.error('VERTRA_API_KEY ausente no ambiente do processo (escopo apps:files). Não passe a chave como argumento.'); process.exit(2); }
  if (!args.app || args.app === true) { console.error('use --app <id do app>'); process.exit(2); }
  const api = String(args.api && args.api !== true ? args.api : 'https://api.vertracloud.app').replace(/\/+$/, '');
  if (!/^https:\/\//.test(api) && !/^http:\/\/127\.0\.0\.1[:/]/.test(api)) { console.error('--api só aceita https (ou 127.0.0.1 em teste)'); process.exit(2); }
  const raiz = String(args.path && args.path !== true ? args.path : 'apps/web/.next').replace(/^\/+|\/+$/g, '');
  const rpm = Number(args.rpm ?? 240) || 240;
  const tPedido = (Number(args['timeout-pedido']) > 0 ? Number(args['timeout-pedido']) : 30) * 1000;
  if (args.medir) {
    const m = await medir({ app: String(args.app), raiz, api, rpm: Number(args.rpm ?? 280) || 280, chave, real: !args['sem-carga-real'], timeoutPedidoMs: tPedido });
    console.log(JSON.stringify({ medir: true, raiz, ...m }, null, 2));
    return;
  }
  if (args.sonda) {
    const c = cliente({ api, chave, app: String(args.app), rpm, timeoutPedidoMs: tPedido });
    const itens = await c.listar(raiz);
    console.log(JSON.stringify({ sonda: true, raiz, entradas: itens.length, amostra: itens.slice(0, 6).map((x) => ({ nome: x.nome, dir: x.dir, tamanho: x.tamanho })), tipos: { dirs: itens.filter((x) => x.dir).length, arquivos: itens.filter((x) => !x.dir).length } }, null, 2));
    const b = await c.ler(`${raiz}/BUILD_ID`);
    console.log(JSON.stringify({ BUILD_ID: { bytes: b.length, texto: b.toString('utf8').trim().slice(0, 40) }, formas: c.formas() }));
    return;
  }
  if (!args.dest || args.dest === true) { console.error('use --dest <pasta nova>'); process.exit(2); }
  const destino = resolve(String(args.dest));
  if (existsSync(destino) && !args.retomar) { console.error('--dest já existe (use --retomar para continuar um download)'); process.exit(2); }
  const rel = await baixar({ app: String(args.app), destino, raiz, api, rpm, concorrencia: Number(args.concorrencia ?? 4) || 4, retomar: Boolean(args.retomar), incluirTudo: Boolean(args['incluir-tudo']), somente: args.somente && args.somente !== true ? String(args.somente).split(',').map((x) => x.trim()).filter(Boolean) : [], timeoutPedidoMs: tPedido, progresso: args.progresso && args.progresso !== true ? resolve(String(args.progresso)) : null, chave, log: (m) => console.error(`[baixar] ${m}`) });
  writeFileSync(`${destino}.relatorio.json`, JSON.stringify(rel, null, 2) + '\n');
  console.log(JSON.stringify({ ok: rel.erros.length === 0, arquivos: rel.arquivos, bytes: rel.bytes, binarios: rel.binarios, pulados: rel.pulados, excluidosPorPadrao: rel.excluidosPorPadrao, latenciaMs: rel.latenciaMs, externos: rel.externos, ignorados: rel.ignorados, pedidos: rel.pedidos, buildId: rel.buildId, erros: rel.erros.slice(0, 10), relatorio: `${destino}.relatorio.json` }, null, 2));
  process.exit(rel.erros.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch((e) => { console.error(`[baixar] falhou: ${e.message}`); process.exit(1); });
