#!/usr/bin/env node
// check-ln-links: reprova se algum link de node_modules/@ln/* aponta para FORA do worktree (ex.: para o worktree de outro agente).
// Por quê: com node_modules compartilhado (ou copiado) por um `npm install`/`npm ci` em outro checkout, os pacotes `@ln/*` do workspace passam a resolver
// para as pastas packages/ de OUTRA branch; o tsc e os testes rodam contra o código errado e dão falha falsa ou aprovação falsa (visto em 23/11, wt do ft/portal-polish-fe).
// SEM dependências: o mesmo arquivo roda em qualquer worktree, mesmo de um commit antigo, sem precisar do ft/infra.
// Uso: node check-ln-links.mjs [--root <worktree>]      (padrão: a pasta atual)  |  node check-ln-links.mjs --all <pasta com vários worktrees>
// Saída: uma linha JSON por worktree. Código 0 = tudo aponta para dentro do worktree; 1 = algum link aponta para fora (ou node_modules/@ln ausente com --exigir); 2 = uso errado.
// Só lê (lstat/realpath); não escreve nada. Conserto: apagar a pasta node_modules do worktree e rodar `npm ci` (ou `npm install`) DENTRO dele.
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Pura: `alvo` está dentro de `raiz`? (compara caminhos reais; no Windows ignora maiúsculas). */
export function dentro(raiz, alvo) {
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const r = relative(fold(raiz), fold(alvo));
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

export function checarWorktree(root, { exigir = false } = {}) {
  const raiz = resolve(root);
  const out = { root: raiz, ok: true, links: 0, fora: [], avisos: [] };
  const nm = join(raiz, 'node_modules');
  if (!existsSync(nm)) { out.avisos.push('sem node_modules (rode npm ci neste worktree)'); out.ok = !exigir; return out; }
  let raizReal;
  try { raizReal = realpathSync(raiz); } catch { out.ok = false; out.avisos.push('worktree ilegível'); return out; }
  // O próprio node_modules não pode ser um link para outro worktree.
  try {
    if (lstatSync(nm).isSymbolicLink()) {
      const real = realpathSync(nm);
      if (!dentro(raizReal, real)) { out.ok = false; out.fora.push({ pacote: '(node_modules inteiro)', destino: relative(raizReal, real) || real }); }
    }
  } catch { /* segue */ }
  const dirLn = join(nm, '@ln');
  if (!existsSync(dirLn)) { out.avisos.push('node_modules/@ln ausente'); if (exigir) out.ok = false; return out; }
  for (const nome of readdirSync(dirLn)) {
    const p = join(dirLn, nome);
    let st; try { st = lstatSync(p); } catch { continue; }
    out.links++;
    let real;
    try { real = realpathSync(p); } catch { out.ok = false; out.fora.push({ pacote: `@ln/${nome}`, destino: '(link quebrado)' }); continue; }
    // Pacote do workspace: tem de resolver para <worktree>/packages/... (ou dentro do worktree). Uma cópia real (não link) dentro de node_modules também fica dentro e é aceita.
    if (!dentro(raizReal, real)) { out.ok = false; out.fora.push({ pacote: `@ln/${nome}`, destino: real.split(sep).slice(-4).join('/') }); }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const val = (k) => { const i = a.indexOf(k); return i >= 0 && a[i + 1] && !a[i + 1].startsWith('--') ? a[i + 1] : undefined; };
  const exigir = a.includes('--exigir');
  if (a.includes('--all')) {
    const pasta = val('--all');
    if (!pasta || !existsSync(pasta)) { console.error('use --all <pasta com worktrees>'); process.exit(2); }
    let ruim = 0;
    for (const d of readdirSync(pasta).sort()) {
      const w = join(pasta, d);
      try { if (!lstatSync(w).isDirectory() || !existsSync(join(w, 'package.json'))) continue; } catch { continue; }
      const r = checarWorktree(w, { exigir });
      if (!r.ok) ruim++;
      if (!r.ok || a.includes('--verbose')) console.log(JSON.stringify({ worktree: d, ok: r.ok, links: r.links, fora: r.fora, avisos: r.avisos }));
    }
    console.log(JSON.stringify({ resumo: true, comProblema: ruim }));
    process.exit(ruim ? 1 : 0);
  }
  const r = checarWorktree(val('--root') ?? process.cwd(), { exigir });
  console.log(JSON.stringify({ ok: r.ok, links: r.links, fora: r.fora, avisos: r.avisos }));
  if (!r.ok) console.error('check-ln-links REPROVADO: apague node_modules neste worktree e rode npm ci DENTRO dele (cada worktree tem o seu node_modules).');
  process.exit(r.ok ? 0 : 1);
}
