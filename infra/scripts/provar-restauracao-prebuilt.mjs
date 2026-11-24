#!/usr/bin/env node
// Prova LOCAL da restauração de um pacote PRÉ-CONSTRUÍDO (a mesma lógica que o start-web roda na Vertra antes do `next start`), sem subir o Next: copia o pacote para uma pasta temporária,
// cria um node_modules MÍNIMO fictício (só o que a restauração confere: a versão do next e os pacotes externos) e roda `restaurarPrebuilt` duas vezes (a 2ª não pode copiar de novo).
// Confere: nenhum problema (commit, ambiente, URL, flags, indexação, next, externos, COMPLETUDE pelos manifestos do Next), BUILD_ID restaurado, links dos externos, marca da restauração.
// NÃO prova que o Next sobe (um .next feito no Linux da Vertra tem caminhos /app; no Windows o `next start` não roda): isso é a prova no staging.
// Uso: node infra/scripts/provar-restauracao-prebuilt.mjs --pacote <pasta do pacote pré-construído>      Código 0 = ok; 1 = problema; 2 = uso errado. Imprime JSON.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, parseArgs } from './lib/util.mjs';
import { restaurarPrebuilt } from './lib/prebuilt.mjs';

export function provar(pasta) {
  const raiz = mkdtempSync(join(tmpdir(), 'ln-prova-restauracao-'));
  try {
    cpSync(pasta, raiz, { recursive: true });
    const release = JSON.parse(readFileSync(join(raiz, 'release.json'), 'utf8'));
    const pb = JSON.parse(readFileSync(join(raiz, 'prebuilt', 'prebuilt.json'), 'utf8'));
    mkdirSync(join(raiz, 'node_modules', 'next'), { recursive: true });
    writeFileSync(join(raiz, 'node_modules', 'next', 'package.json'), JSON.stringify({ version: pb.nextVersion }));
    for (const x of pb.externos) { mkdirSync(join(raiz, 'node_modules', x.pacote), { recursive: true }); writeFileSync(join(raiz, 'node_modules', x.pacote, 'package.json'), '{}'); }
    const t0 = Date.now();
    const a = restaurarPrebuilt(raiz, release);
    const ms = Date.now() - t0;
    const b = restaurarPrebuilt(raiz, release);
    const links = pb.externos.map((x) => { try { return { nome: x.nome, link: lstatSync(join(raiz, 'apps/web/.next/node_modules', x.nome)).isSymbolicLink() }; } catch { return { nome: x.nome, link: false }; } });
    const buildIdRestaurado = existsSync(join(raiz, 'apps/web/.next/BUILD_ID')) ? readFileSync(join(raiz, 'apps/web/.next/BUILD_ID'), 'utf8').trim() : null;
    const resultado = {
      commit: String(release.commit).slice(0, 12), appEnv: release.appEnv, nextVersion: pb.nextVersion, buildId: pb.buildId, buildIdRestaurado,
      primeira: { problemas: a.problemas, log: a.log, ms }, segunda: { problemas: b.problemas, log: b.log }, links,
      marca: existsSync(join(raiz, 'apps/web/.next/.ln-prebuilt.json')),
    };
    resultado.ok = a.ativo && a.problemas.length === 0 && b.problemas.length === 0 && buildIdRestaurado === pb.buildId && links.every((l) => l.link) && resultado.marca && b.log.some((l) => /já presente/.test(l));
    // limpeza segura: desfaz os links antes de apagar a pasta temporária (nunca seguir link)
    const nm = join(raiz, 'apps/web/.next/node_modules');
    if (existsSync(nm)) for (const e of readdirSync(nm)) { try { unlinkSync(join(nm, e)); } catch { /* pasta real */ } }
    return resultado;
  } finally { rmSync(raiz, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pacote || args.pacote === true) fail('use --pacote <pasta do pacote pré-construído>', 2);
  const pasta = resolve(String(args.pacote));
  if (!existsSync(join(pasta, 'prebuilt', 'prebuilt.json'))) fail('--pacote não é um pacote pré-construído (sem prebuilt/prebuilt.json)', 2);
  const r = provar(pasta);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
