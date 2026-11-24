#!/usr/bin/env node
// Soma de integridade de uma pasta, IDÊNTICA à do workflow web-prebuilt (passo "Soma de integridade da árvore"):
//   cd <pasta> && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
// Serve para conferir, no Windows, a pasta baixada do artefato contra a linha `arvore-sha256=` do resumo da execução.
// Uso: node infra/scripts/arvore-sha256.mjs <pasta> [--esperado <64 hex>]   (saída: `arvore-sha256=<hex>`; código 1 se o esperado não bater; 2 = uso errado)
// Só lê; nada é escrito. Ordem por BYTES do caminho (como LC_ALL=C), caminhos com `./` e separador `/`, linhas `<hash><2 espaços><caminho>\n`.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Lista os arquivos regulares de `raiz` como caminhos `./a/b`, em ordem de bytes. Links simbólicos entram como o `find -type f` os trata: ficam de fora. */
export function listarArquivos(raiz) {
  const out = [];
  const andar = (dir, prefixo) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      const l = lstatSync(p);
      if (l.isSymbolicLink()) continue;
      if (l.isDirectory()) andar(p, `${prefixo}/${nome}`);
      else if (statSync(p).isFile()) out.push(`${prefixo}/${nome}`);
    }
  };
  andar(raiz, '.');
  return out.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

export function somaArvore(raiz) {
  const linhas = listarArquivos(raiz).map((rel) => `${createHash('sha256').update(readFileSync(join(raiz, rel))).digest('hex')}  ${rel}\n`);
  return createHash('sha256').update(linhas.join('')).digest('hex');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const pasta = a.find((x) => !x.startsWith('--') && a[a.indexOf(x) - 1] !== '--esperado');
  const i = a.indexOf('--esperado');
  const esperado = i >= 0 ? String(a[i + 1] ?? '').toLowerCase() : null;
  if (!pasta || (i >= 0 && !/^[0-9a-f]{64}$/.test(esperado))) { console.error('use: arvore-sha256.mjs <pasta> [--esperado <64 hex>]'); process.exit(2); }
  const soma = somaArvore(resolve(pasta));
  console.log(`arvore-sha256=${soma}`);
  if (esperado && esperado !== soma) { console.error(`NÃO BATE: esperado ${esperado}`); process.exit(1); }
}
