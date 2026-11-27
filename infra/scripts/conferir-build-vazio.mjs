#!/usr/bin/env node
// PASSO 0 do go-live, como trava e não como lembrete: pacote PRÉ-CONSTRUÍDO só sobe (e só é dado como no ar) com o build_command do app NULO na Vertra
// e o BUILD= do vertracloud.config do pacote vazio. Com build_command preenchido a Vertra recompila no upload: o código no ar deixa de ser o
// artefato testado e, no worker de produção (128 MB), o build pode estourar a memória (auditorias de 26/11/2026). SÓ LEITURA na Vertra (GET).
// A chave vem SÓ do ambiente (VERTRA_API_KEY, escopo de leitura): não é argumento, nunca é impressa nem gravada, nem em erro.
// Uso: VERTRA_API_KEY=… node infra/scripts/conferir-build-vazio.mjs --app <id> [--pacote <pasta do pacote pré-construído>] [--api https://api.vertracloud.app]
// Rode ANTES do upload (recusa publicar) e DE NOVO DEPOIS (o upload pode reaplicar o config do pacote). Saída: uma linha JSON, sem segredo.
// Código 0 = tudo vazio; 1 = build_command preenchido, BUILD= não vazio ou resposta sem o campo (falha fechada); 2 = uso/ambiente recusado.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/util.mjs';

/** Exatamente uma linha BUILD= e vazia (LF ou CRLF). Mesma regra do buildVazio do package-prebuilt.mjs (PR #71); trocar pelo import quando ele entrar. Pura. */
export function buildVazio(texto) {
  const linhas = String(texto).split(/\r?\n/).filter((l) => l.startsWith('BUILD='));
  return linhas.length === 1 && linhas[0] === 'BUILD=';
}

/** Extrai build_command da resposta da API (objeto direto ou envelope `data`). `undefined` = campo ausente. Pura. */
export function buildCommandDe(resposta) {
  for (const o of [resposta, resposta?.data, resposta?.app]) {
    if (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, 'build_command')) return o.build_command;
  }
  return undefined;
}

/** Decide (pura, testada). `config` é o texto do vertracloud.config do pacote, ou null quando não foi pedido. */
export function avaliar({ resposta, config = null }) {
  const bc = buildCommandDe(resposta);
  const provas = [];
  if (bc === undefined) provas.push({ nome: 'resposta da Vertra traz build_command', ok: false });
  else provas.push({ nome: 'build_command do app nulo/vazio', ok: bc === null || (typeof bc === 'string' && bc.trim() === '') });
  if (config !== null) provas.push({ nome: 'BUILD= vazio no vertracloud.config do pacote', ok: buildVazio(config) });
  return { ok: provas.every((p) => p.ok), provas };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chave = process.env.VERTRA_API_KEY;
  if (!chave) { console.error('VERTRA_API_KEY ausente no ambiente do processo. Não passe a chave como argumento.'); process.exit(2); }
  if (!args.app || args.app === true || !/^[A-Za-z0-9-]{8,64}$/.test(String(args.app))) { console.error('use --app <id do app>'); process.exit(2); }
  const api = String(args.api && args.api !== true ? args.api : 'https://api.vertracloud.app').replace(/\/+$/, '');
  if (!/^https:\/\//.test(api) && !/^http:\/\/127\.0\.0\.1[:/]/.test(api)) { console.error('--api só aceita https (ou 127.0.0.1 em teste)'); process.exit(2); }
  let config = null;
  if (args.pacote !== undefined) {
    const f = join(resolve(String(args.pacote)), 'vertracloud.config');
    if (args.pacote === true || !existsSync(f)) { console.error('--pacote sem vertracloud.config'); process.exit(2); }
    config = readFileSync(f, 'utf8');
  }
  let resposta;
  try {
    const r = await fetch(`${api}/v1/apps/${encodeURIComponent(String(args.app))}`, { headers: { authorization: `Bearer ${chave}`, accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) { console.log(JSON.stringify({ ok: false, erro: `HTTP ${r.status}` })); process.exit(1); }
    resposta = await r.json();
  } catch (e) {
    console.log(JSON.stringify({ ok: false, erro: e?.name ?? 'erro' })); // só a classe: a mensagem pode trazer URL
    process.exit(1);
  }
  const res = avaliar({ resposta, config });
  console.log(JSON.stringify({ app: String(args.app), ...res }));
  process.exit(res.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
