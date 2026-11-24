#!/usr/bin/env node
// Baixa o `.next` JÁ CONSTRUÍDO NA VERTRA (Linux, caminhos /app/...) de um app pela API de arquivos, para montar o pacote PRÉ-CONSTRUÍDO (package-prebuilt.mjs). SÓ LEITURA na Vertra (GET).
// A chave vem SÓ do ambiente do processo (VERTRA_API_KEY, escopo apps:files): não é argumento, nunca é impressa nem gravada, nem em erro. Rode pelo script do PM (credenciais-sem-expor.md).
// Uso: VERTRA_API_KEY=… node infra/scripts/baixar-next-vertra.mjs --app <id> --dest <pasta nova> [--path apps/web/.next] [--api https://api.vertracloud.app]
//        [--rpm 150] [--concorrencia 4] [--retomar] [--sonda]
//   --sonda    uma listagem + a leitura do BUILD_ID, imprime só o FORMATO (chaves/tipos) e sai; não grava nada. Rode antes do download completo.
//   --retomar  pula arquivo já baixado com o tamanho certo (cai a conexão ou o limite da API: repita o comando).
// Fica de fora (não serve ao pacote): cache, diagnostics, trace, trace-build. Em node_modules grava só PASTAS VAZIAS com os nomes dos externos (a restauração recria os links).
// Binários chegam em base64 (encoding "base64") e são gravados como bytes. Nomes vêm de terceiros: só entram nomes simples (sem /, barra invertida, .., :, controle).
// Limite da API (pro-8): 300 req/min; o padrão aqui é 150/min e respeita 429 (retry_after). Relatório em <dest>.relatorio.json (contagens e nomes de erro; nenhum conteúdo, nenhuma chave).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/util.mjs';

export const FORA_DA_RAIZ = new Set(['cache', 'diagnostics', 'trace', 'trace-build']);

/** Só nomes simples de arquivo/pasta (os nomes vêm de terceiros). Função pura. */
export function nomeSeguro(nome) {
  const n = String(nome ?? '');
  const barra = String.fromCharCode(92);
  if (!n || n === '.' || n === '..' || n.length > 255) return false;
  if (n.includes('/') || n.includes(barra) || n.includes(':') || n.includes('..')) return false;
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
  constructor(rpm) { this.intervalo = 60000 / Math.max(1, rpm); this.proximo = 0; }
  async esperar() { const agora = Date.now(); const t = Math.max(agora, this.proximo); this.proximo = t + this.intervalo; if (t > agora) await new Promise((r) => setTimeout(r, t - agora)); }
}

function cliente({ api, chave, app, rpm, parametro = 'path' }) {
  const limite = new Limite(rpm);
  let pedidos = 0;
  const get = async (rota, caminho) => {
    for (let tentativa = 0; tentativa < 6; tentativa += 1) {
      await limite.esperar();
      pedidos += 1;
      let r;
      try {
        r = await fetch(`${api}/v1/apps/${encodeURIComponent(app)}/${rota}?${parametro}=${encodeURIComponent(caminho)}`, { headers: { authorization: `Bearer ${chave}`, accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      } catch (e) { if (tentativa === 5) throw new Error(`rede: ${e?.cause?.code ?? e?.name}`, { cause: e }); await new Promise((s) => setTimeout(s, 1000 * (tentativa + 1))); continue; }
      if (r.status === 429) {
        let espera = Number(r.headers.get('retry-after')) || 0;
        try { const j = await r.clone().json(); espera = Number(j?.details?.retry_after ?? j?.retry_after ?? espera) || espera; } catch { /* sem corpo */ }
        await new Promise((s) => setTimeout(s, Math.min(120, Math.max(2, espera)) * 1000));
        continue;
      }
      if (r.status >= 500 && tentativa < 5) { await new Promise((s) => setTimeout(s, 1000 * (tentativa + 1))); continue; }
      const corpo = Buffer.from(await r.arrayBuffer());
      if (!r.ok) {
        let codigo = '';
        try { codigo = String(JSON.parse(corpo.toString('utf8'))?.code ?? ''); } catch { /* sem json */ }
        throw new Error(`HTTP ${r.status}${codigo ? ` ${codigo.replace(/[^A-Z0-9_]/g, '').slice(0, 40)}` : ''}`);
      }
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
  };
}

export async function baixar({ app, destino, raiz = 'apps/web/.next', api = 'https://api.vertracloud.app', rpm = 150, concorrencia = 4, retomar = false, chave, log = () => {} }) {
  const c = cliente({ api, chave, app, rpm });
  const rel = { app, raiz, arquivos: 0, bytes: 0, binarios: 0, pulados: 0, externos: [], ignorados: [], erros: [], inicio: new Date().toISOString() };
  const dest = resolve(destino);
  const dentro = (p) => { const r = resolve(p); return r === dest || r.startsWith(dest + sep); };
  mkdirSync(dest, { recursive: true });
  const fila = [{ remoto: raiz, local: dest, nivel: 0 }];
  const arquivos = [];
  while (fila.length) {
    const d = fila.shift();
    let itens;
    try { itens = await c.listar(d.remoto); } catch (e) { rel.erros.push(`listar ${d.remoto}: ${e.message}`); continue; }
    for (const it of itens) {
      if (!nomeSeguro(it.nome)) { rel.erros.push(`nome recusado em ${d.remoto}`); continue; }
      const remoto = `${d.remoto}/${it.nome}`;
      const local = join(d.local, it.nome);
      if (!dentro(local)) { rel.erros.push(`caminho fora do destino em ${d.remoto}`); continue; }
      if (d.nivel === 0 && FORA_DA_RAIZ.has(it.nome)) { rel.ignorados.push(it.nome); continue; }
      if (d.nivel === 0 && it.nome === 'node_modules' && it.dir) { fila.push({ remoto, local, nivel: -1 }); mkdirSync(local, { recursive: true }); continue; }
      if (d.nivel === -1) { // dentro de .next/node_modules: só NOMES (pastas vazias); @escopo entra um nível
        mkdirSync(local, { recursive: true });
        if (it.nome.startsWith('@')) fila.push({ remoto, local, nivel: -1 }); else rel.externos.push(it.nome);
        continue;
      }
      if (it.dir) { mkdirSync(local, { recursive: true }); fila.push({ remoto, local, nivel: d.nivel + 1 }); } else arquivos.push({ remoto, local, tamanho: it.tamanho });
    }
  }
  log(`listagem pronta: ${arquivos.length} arquivo(s)`);
  let i = 0;
  const trabalho = async () => {
    while (i < arquivos.length) {
      const a = arquivos[i]; i += 1;
      try {
        if (retomar && existsSync(a.local) && a.tamanho !== null && statSync(a.local).size === a.tamanho) { rel.pulados += 1; continue; }
        const buf = await c.ler(a.remoto);
        if (a.tamanho !== null && buf.length !== a.tamanho) { rel.erros.push(`tamanho de ${a.remoto.slice(raiz.length)}: esperado ${a.tamanho}, veio ${buf.length}`); continue; }
        mkdirSync(dirname(a.local), { recursive: true });
        writeFileSync(a.local, buf);
        rel.arquivos += 1; rel.bytes += buf.length;
        if (buf.includes(0)) rel.binarios += 1;
        if (rel.arquivos % 250 === 0) log(`${rel.arquivos}/${arquivos.length} arquivos`);
      } catch (e) { rel.erros.push(`ler ${a.remoto.slice(raiz.length)}: ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concorrencia) }, trabalho));
  rel.pedidos = c.pedidos(); rel.fim = new Date().toISOString();
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
  const rpm = Number(args.rpm ?? 150) || 150;
  if (args.sonda) {
    const c = cliente({ api, chave, app: String(args.app), rpm });
    const itens = await c.listar(raiz);
    console.log(JSON.stringify({ sonda: true, raiz, entradas: itens.length, amostra: itens.slice(0, 6).map((x) => ({ nome: x.nome, dir: x.dir, tamanho: x.tamanho })), tipos: { dirs: itens.filter((x) => x.dir).length, arquivos: itens.filter((x) => !x.dir).length } }, null, 2));
    const b = await c.ler(`${raiz}/BUILD_ID`);
    console.log(JSON.stringify({ BUILD_ID: { bytes: b.length, texto: b.toString('utf8').trim().slice(0, 40) }, formas: c.formas() }));
    return;
  }
  if (!args.dest || args.dest === true) { console.error('use --dest <pasta nova>'); process.exit(2); }
  const destino = resolve(String(args.dest));
  if (existsSync(destino) && !args.retomar) { console.error('--dest já existe (use --retomar para continuar um download)'); process.exit(2); }
  const rel = await baixar({ app: String(args.app), destino, raiz, api, rpm, concorrencia: Number(args.concorrencia ?? 4) || 4, retomar: Boolean(args.retomar), chave, log: (m) => console.error(`[baixar] ${m}`) });
  writeFileSync(`${destino}.relatorio.json`, JSON.stringify(rel, null, 2) + '\n');
  console.log(JSON.stringify({ ok: rel.erros.length === 0, arquivos: rel.arquivos, bytes: rel.bytes, binarios: rel.binarios, pulados: rel.pulados, externos: rel.externos, ignorados: rel.ignorados, pedidos: rel.pedidos, buildId: rel.buildId, erros: rel.erros.slice(0, 10), relatorio: `${destino}.relatorio.json` }, null, 2));
  process.exit(rel.erros.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch((e) => { console.error(`[baixar] falhou: ${e.message}`); process.exit(1); });
