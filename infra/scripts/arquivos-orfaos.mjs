#!/usr/bin/env node
// Lista os arquivos que ficaram no app da Vertra (sobras de uploads antigos) e NÃO existem no pacote que se vai enviar.
// Motivo (23/11/2026): `deploy_app` só acrescenta/sobrescreve; não apaga arquivos de pacotes anteriores. Sobras de código-fonte
// (ex.: ArticleForm.tsx, test-seam.*) quebraram o `tsc` do `next build` ("Failed to type check") e o deploy foi revertido.
// Só lê: não escreve na Vertra. Entrada: a saída do `get_file_tree` do app (JSON em qualquer formato razoável, ou uma lista de caminhos
// por linha) e a PASTA do pacote. Saída: JSON com a lista e os argumentos exatos de `delete_file` (um por arquivo).
// Uso: node infra/scripts/arquivos-orfaos.mjs --tree <arquivo> --pasta <pasta do pacote> [--app <id>]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, fail } from './lib/util.mjs';

// Pastas geradas ou do ambiente (não são código enviado): nunca entram na lista de remoção.
const IGNORAR = [/^node_modules\//, /(^|\/)node_modules\//, /^\.next\//, /(^|\/)\.next\//, /^\.cache\//, /^\.npm\//, /^\.git\//, /^\.turbo\//, /(^|\/)\.next-e2e\//, /(^|\/)tsconfig\.tsbuildinfo$/, /(^|\/)next-env\.d\.ts$/]; // next-env.d.ts é gerado pelo Next
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');

/** Caminhos de ARQUIVO contidos numa árvore em JSON (children/entries/files, name/path) ou em texto (um caminho por linha). */
export function arquivosDaArvore(entrada) {
  let dado = entrada;
  if (typeof entrada === 'string') {
    entrada = entrada.replace(/^﻿/, ''); // PowerShell 5.1 grava UTF-8 com BOM (e UTF-16 com `>`: ver readTexto)
    try { dado = JSON.parse(entrada); } catch { return entrada.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.endsWith('/')).map(norm); }
  }
  const out = new Set();
  const filhosDe = (o) => o.children ?? o.entries ?? o.files ?? o.items ?? o.contents ?? o.tree;
  const visita = (o, prefixo) => {
    if (typeof o === 'string') { out.add(norm(prefixo ? `${prefixo}/${o}` : o)); return; }
    if (Array.isArray(o)) { for (const x of o) visita(x, prefixo); return; }
    if (!o || typeof o !== 'object') return;
    const filhos = filhosDe(o);
    const nome = typeof o.path === 'string' ? o.path : typeof o.name === 'string' ? o.name : null;
    const ehPasta = o.type === 'directory' || o.type === 'dir' || o.type === 'folder' || o.is_dir === true || o.isDirectory === true || (filhos && typeof filhos === 'object');
    const caminho = nome == null ? prefixo : (typeof o.path === 'string' ? nome : (prefixo ? `${prefixo}/${nome}` : nome));
    if (filhos && typeof filhos === 'object') { visita(filhos, caminho); return; }
    if (nome != null && !ehPasta) { out.add(norm(caminho)); return; }
    if (nome == null) for (const v of Object.values(o)) visita(v, prefixo);
  };
  visita(dado, '');
  return [...out].filter(Boolean);
}

/** Lê texto tolerando BOM UTF-8 e UTF-16 LE/BE (saídas de `>`/Out-File do PowerShell 5.1). */
export function readTexto(arquivo) {
  const b = readFileSync(arquivo);
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b[0] === 0xfe && b[1] === 0xff) { const s = Buffer.from(b.subarray(2)); s.swap16(); return s.toString('utf16le'); }
  return b.toString('utf8').replace(/^﻿/, '');
}

function arquivosDaPasta(dir) {
  const out = [];
  const anda = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? anda(p) : out.push(relative(dir, p).split(sep).join('/')); } };
  anda(dir);
  return out;
}

/** Arquivos da árvore do app que não estão no pacote (ignorando pastas geradas). */
export function orfaos(arvore, pacote) {
  const noPacote = new Set(pacote.map(norm));
  return arvore.map(norm).filter((f) => !IGNORAR.some((r) => r.test(f)) && !noPacote.has(f)).sort();
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tree || args.tree === true || !args.pasta || args.pasta === true) fail('use --tree <arquivo do get_file_tree> --pasta <pasta do pacote> [--app <id>]', 2);
  const arvore = arquivosDaArvore(readTexto(String(args.tree)));
  if (arvore.length === 0) fail('nenhum arquivo reconhecido na árvore: formato inesperado', 2);
  const pacote = arquivosDaPasta(String(args.pasta));
  const lista = orfaos(arvore, pacote);
  const id = args.app && args.app !== true ? String(args.app) : '<id do app>';
  console.log(JSON.stringify({ arquivosNaArvore: arvore.length, arquivosNoPacote: pacote.length, orfaos: lista, delete_file: lista.map((path) => ({ id, path })) }, null, 2));
}
