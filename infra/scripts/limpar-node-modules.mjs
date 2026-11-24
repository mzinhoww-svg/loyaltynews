#!/usr/bin/env node
// limpar-node-modules: apaga o node_modules de UM worktree SEM atravessar links (symlink/junction). Existe porque `Remove-Item -Recurse`, `rm -rf` e `rmdir /s` podem entrar numa
// junction (ex.: node_modules/@ln/* ou o próprio node_modules apontando para o worktree de OUTRO agente) e apagar o ALVO: em 24/11 isso apagou 722 arquivos do worktree do Frontend.
// Aqui cada entrada é lida com lstat: link => só o link é removido (nunca se lê o que há dentro); diretório real => esvazia e remove; arquivo => remove.
// SEM dependências: o mesmo arquivo roda em qualquer worktree.
// Uso: node limpar-node-modules.mjs --root <worktree>            (mostra o plano, não apaga)
//      node limpar-node-modules.mjs --root <worktree> --confirmar (apaga)
// Só mexe em <worktree>/node_modules; recusa se --root não tem package.json ou se o caminho não termina em node_modules. Depois: `npm ci` DENTRO do worktree e `check-ln-links`.
// Saída: uma linha JSON. Código 0 = ok (plano mostrado ou apagado); 1 = falhou no meio; 2 = uso errado.
import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function removerLink(p) {
  try { unlinkSync(p); return; } catch { /* junction no Windows: rmdir remove só o link */ }
  rmdirSync(p); // não recursivo: falha se for diretório real com conteúdo, nunca apaga o alvo de uma junction
}

/** Conta (plano) ou apaga (confirmar). Nunca entra num link. Devolve contagens. */
export function limpar(alvo, confirmar) {
  const r = { arquivos: 0, diretorios: 0, links: 0 };
  const andar = (p) => {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) { r.links++; if (confirmar) removerLink(p); return; }
    if (st.isDirectory()) {
      for (const n of readdirSync(p)) andar(join(p, n));
      r.diretorios++;
      if (confirmar) rmdirSync(p);
      return;
    }
    r.arquivos++;
    if (confirmar) unlinkSync(p);
  };
  andar(alvo);
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--root');
  const root = i >= 0 && a[i + 1] && !a[i + 1].startsWith('--') ? resolve(a[i + 1]) : null;
  if (!root || !existsSync(join(root, 'package.json'))) { console.error('use --root <worktree> (a pasta precisa ter package.json)'); process.exit(2); }
  const alvo = join(root, 'node_modules');
  if (basename(alvo) !== 'node_modules') process.exit(2);
  if (!existsSync(alvo) && !(() => { try { lstatSync(alvo); return true; } catch { return false; } })()) { console.log(JSON.stringify({ root, nada: 'sem node_modules' })); process.exit(0); }
  const confirmar = a.includes('--confirmar');
  try {
    const r = limpar(alvo, confirmar);
    console.log(JSON.stringify({ root, apagou: confirmar, ...r, dica: confirmar ? 'agora: npm ci dentro do worktree e check-ln-links' : 'nada foi apagado; rode de novo com --confirmar' }));
    process.exit(0);
  } catch (e) { console.error(`falhou: ${e?.code ?? e?.name ?? 'erro'} (nada foi apagado fora de node_modules)`); process.exit(1); }
}
