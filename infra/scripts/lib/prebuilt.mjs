// Web PRÉ-CONSTRUÍDO (opção B da decisão do PM, 24/11/2026): o `next build` NÃO roda na Vertra (o web só constrói a 2048 MB e o regime de produção não comporta o pico).
// O pacote leva o `.next` já construído num Linux (o da própria Vertra, caminhos /app/...) numa pasta com OUTRO nome (prebuilt/web-next): o painel da Vertra remove `.next` e
// `node_modules` dos ZIPs, e os links dos externos do Turbopack (.next/node_modules/pg-<hash> -> node_modules/pg) não sobrevivem a ZIP. Na subida, o start-web restaura:
// copia prebuilt/web-next para apps/web/.next (só se o BUILD_ID mudou) e recria os links dos externos. FALHA FECHADA: recusa subir se o .next é de outro commit, outro ambiente,
// outra URL, outra flag/vitrine/indexação, outro `next`, ou se um externo não foi instalado. Pacote comum (sem prebuilt/prebuilt.json) = nada acontece.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkHome } from '../build-web.mjs';

export const PREBUILT_DIR = join('prebuilt', 'web-next');
export const PREBUILT_MANIFEST = join('prebuilt', 'prebuilt.json');

/** 'pg-587764f78a6c7a9c' -> 'pg'; '@scope/x-0123456789abcdef' -> '@scope/x'; null se não tem o sufixo de 16 hex do Turbopack. Função pura. */
export function pacoteDoExterno(nome) {
  const m = /^(.+)-[0-9a-f]{16}$/.exec(String(nome));
  return m ? m[1] : null;
}

/** Externos de um .next: entradas de .next/node_modules (links, pastas ou arquivos, não importa: só os NOMES contam). [{ nome, pacote }] */
export function listarExternos(nextDir) {
  const base = join(nextDir, 'node_modules');
  if (!existsSync(base)) return [];
  const out = [];
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (e.name.startsWith('@')) {
      for (const f of readdirSync(join(base, e.name))) out.push({ nome: `${e.name}/${f}`, pacote: pacoteDoExterno(`${e.name}/${f}`) });
    } else out.push({ nome: e.name, pacote: pacoteDoExterno(e.name) });
  }
  return out;
}

/** Problemas entre o manifesto do pré-construído e o release.json do pacote. Função pura. */
export function problemasPrebuilt(pb, release, nextInstalado) {
  if (!pb || typeof pb !== 'object' || Array.isArray(pb)) return ['prebuilt.json ilegível'];
  const p = [];
  if (!/^[0-9a-f]{40}$/.test(String(pb.commit ?? ''))) p.push('prebuilt.json sem commit de 40 caracteres');
  else if (pb.commit !== release?.commit) p.push(`o .next pré-construído é do commit ${String(pb.commit).slice(0, 12)} e o pacote é do ${String(release?.commit).slice(0, 12)}: refaça o pré-construído desse commit`);
  for (const k of ['appEnv', 'siteUrl']) if (String(pb[k] ?? '').toLowerCase() !== String(release?.[k] ?? '').toLowerCase()) p.push(`${k} do pré-construído ("${pb[k]}") difere do release.json ("${release?.[k]}"): o .next embute isso no build`);
  if (Boolean(pb.vitrine) !== Boolean(release?.vitrine)) p.push('vitrine do pré-construído difere do release.json');
  if (Boolean(pb.indexavel) !== Boolean(release?.indexavel)) p.push('indexavel do pré-construído difere do release.json (indexação é decidida no build)');
  const fl = (x) => JSON.stringify([...(Array.isArray(x) ? x : [])].map(String).sort());
  if (fl(pb.flagsLigadas) !== fl(release?.flagsLigadas)) p.push('flagsLigadas do pré-construído diferem do release.json');
  if (!/^[A-Za-z0-9_-]{6,}$/.test(String(pb.buildId ?? ''))) p.push('prebuilt.json sem buildId');
  if (pb.nextVersion && nextInstalado && pb.nextVersion !== nextInstalado) p.push(`next ${nextInstalado} instalado difere do next ${pb.nextVersion} que construiu o .next`);
  if (!Array.isArray(pb.externos)) p.push('prebuilt.json sem a lista de externos');
  else for (const x of pb.externos) if (!x?.pacote) p.push(`externo "${x?.nome}" sem nome de pacote reconhecível (sufixo de 16 hex)`);
  return p;
}

function limparLinks(nextDir) {
  const base = join(nextDir, 'node_modules');
  if (!existsSync(base)) return;
  for (const e of readdirSync(base, { withFileTypes: true })) {
    const p = join(base, e.name);
    if (e.name.startsWith('@') && !lstatSync(p).isSymbolicLink()) { for (const f of readdirSync(p)) unlinkSync(join(p, f)); continue; }
    unlinkSync(p); // só o link/arquivo, nunca o conteúdo do alvo
  }
}

/**
 * Restaura o pré-construído, se o pacote tem um. Devolve { ativo, problemas, log }. `root` é a raiz do pacote (onde está o release.json).
 * Não imprime nada: quem chama decide (start-web imprime e sai com 1 se houver problemas).
 */
export function restaurarPrebuilt(root, release) {
  const log = [];
  const man = join(root, PREBUILT_MANIFEST);
  if (!existsSync(man)) return { ativo: false, problemas: [], log };
  let pb;
  try { pb = JSON.parse(readFileSync(man, 'utf8').replace(/^\uFEFF/, '')); } catch { return { ativo: true, problemas: ['prebuilt.json ilegível'], log }; }
  let nextInstalado = null;
  try { nextInstalado = JSON.parse(readFileSync(join(root, 'node_modules', 'next', 'package.json'), 'utf8')).version; } catch { /* sem next instalado: o start falha adiante */ }
  const problemas = problemasPrebuilt(pb, release, nextInstalado);
  if (problemas.length) return { ativo: true, problemas, log };

  const origem = join(root, PREBUILT_DIR);
  const destino = join(root, 'apps', 'web', '.next');
  if (!existsSync(join(origem, 'BUILD_ID'))) return { ativo: true, problemas: [`${PREBUILT_DIR} sem BUILD_ID (pacote incompleto ou o .next foi removido do ZIP)`], log };
  const idOrigem = readFileSync(join(origem, 'BUILD_ID'), 'utf8').trim();
  if (idOrigem !== pb.buildId) return { ativo: true, problemas: [`BUILD_ID da pasta (${idOrigem}) difere do prebuilt.json (${pb.buildId})`], log };
  const idDestino = existsSync(join(destino, 'BUILD_ID')) ? readFileSync(join(destino, 'BUILD_ID'), 'utf8').trim() : null;
  if (idDestino !== idOrigem) {
    if (existsSync(destino)) { limparLinks(destino); rmSync(destino, { recursive: true, force: true }); }
    mkdirSync(dirname(destino), { recursive: true });
    cpSync(origem, destino, { recursive: true });
    log.push(`.next restaurado de ${PREBUILT_DIR} (BUILD_ID ${idOrigem})`);
  } else log.push(`.next já presente (BUILD_ID ${idOrigem})`);

  for (const x of pb.externos) {
    const alvo = join(root, 'node_modules', x.pacote);
    const link = join(destino, 'node_modules', x.nome);
    if (!existsSync(alvo)) { problemas.push(`externo ${x.pacote} não está em node_modules: a instalação da Vertra não o trouxe (está em dependencies?)`); continue; }
    let ok = false;
    try { ok = lstatSync(link).isSymbolicLink() && existsSync(link); } catch { /* ausente */ }
    if (!ok) {
      try { if (existsSync(link) || lstatSync(link).isSymbolicLink()) unlinkSync(link); } catch { /* ausente */ }
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(alvo, link, process.platform === 'win32' ? 'junction' : 'dir');
      log.push(`link ${x.nome} -> node_modules/${x.pacote}`);
    }
  }

  // o mesmo conferido que o build-web faz depois do build: canonical com a URL do ambiente e noindex fora de produção/antes do go-live
  const idx = join(destino, 'server', 'app', 'index.html');
  if (!existsSync(idx)) problemas.push('.next/server/app/index.html ausente: o pré-construído não tem a home estática para conferir');
  else problemas.push(...checkHome(readFileSync(idx, 'utf8'), release.siteUrl, release.appEnv, Boolean(release.vitrine), Boolean(release.indexavel)));
  return { ativo: true, problemas, log };
}

/** Só para teste/diagnóstico: onde o link aponta (ou null). */
export function alvoDoLink(link) { try { return readlinkSync(link); } catch { return null; } }
