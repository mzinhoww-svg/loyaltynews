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

/** Normaliza a resposta de listagem em [{ nome, dir, tamanho }]. Formato desconhecido: lança com os NOMES das chaves (nunca valores). Função pura. */
export function normalizarListagem(json) {
  let lista = Array.isArray(json) ? json : null;
  if (!lista && json && typeof json === 'object') for (const k of LISTAS) if (Array.isArray(json[k])) { lista = json[k]; break; }
  if (!lista && json?.data && typeof json.data === 'object') for (const k of LISTAS) if (Array.isArray(json.data[k])) { lista = json.data[k]; break; }
  if (!lista) throw new Error(`formato de listagem não reconhecido (chaves: ${json && typeof json === 'object' ? Object.keys(json).join(',') : typeof json})`);
  return lista.map((e) => {
    if (typeof e === 'string') return { nome: e.replace(/\/+$/, ''), dir: e.endsWith('/'), tamanho: null };
    const t = e?.size ?? e?.bytes ?? e?.length;
    return { nome: nomeDe(e), dir: ehDir(e), tamanho: Number.isFinite(Number(t)) && t !== null && t !== undefined ? Number(t) : null };
  });
}

/** Resposta de leitura -> Buffer. JSON { content, encoding } (base64 para binário); qualquer outra coisa = os bytes como vieram. Função pura. */
export function normalizarConteudo(corpo, contentType = '') {
  const ehJson = /json/i.test(contentType) || (corpo.length > 1 && corpo[0] === 0x7b);
  if (ehJson) {
    try {
      const j = JSON.parse(corpo.toString('utf8'));
      const c = j?.content ?? j?.data?.content;
      if (typeof c === 'string') {
        const enc = String(j?.encoding ?? j?.data?.encoding ?? 'utf-8').toLowerCase();
        return enc === 'base64' ? Buffer.from(c, 'base64') : Buffer.from(c, 'utf8');
      }
    } catch { /* não era o envelope: devolve como veio */ }
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
  return { listar: async (c) => normalizarListagem(JSON.parse((await get('files', c)).corpo.toString('utf8'))), ler: async (c) => { const x = await get('files/content', c); return normalizarConteudo(x.corpo, x.tipo); }, pedidos: () => pedidos };
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
    console.log(JSON.stringify({ BUILD_ID: { bytes: b.length, texto: b.toString('utf8').trim().slice(0, 40) } }));
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
