// Web PRÉ-CONSTRUÍDO (opção B da decisão do PM, 24/11/2026): o `next build` NÃO roda na Vertra (o web só constrói a 2048 MB e o regime de produção não comporta o pico).
// O pacote leva o `.next` já construído num Linux (o da própria Vertra, caminhos /app/...) numa pasta com OUTRO nome (prebuilt/web-next): o painel da Vertra remove `.next` e
// `node_modules` dos ZIPs, e os links dos externos do Turbopack (.next/node_modules/pg-<hash> -> node_modules/pg) não sobrevivem a ZIP. Na subida, o start-web restaura:
// copia prebuilt/web-next para apps/web/.next (só se o BUILD_ID mudou) e recria os links dos externos. FALHA FECHADA: recusa subir se o .next é de outro commit, outro ambiente,
// outra URL, outra flag/vitrine/indexação, outro `next`, ou se um externo não foi instalado. Pacote comum (sem prebuilt/prebuilt.json) = nada acontece.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { TAR } from './tar.mjs';
import { dirname, join, resolve, sep } from 'node:path';
import { checkHome } from '../build-web.mjs';

export const PREBUILT_DIR = join('prebuilt', 'web-next');
export const PREBUILT_MANIFEST = join('prebuilt', 'prebuilt.json');
export const PREBUILT_TAR = join('prebuilt', 'web-next.tar');
const MARCA = '.ln-prebuilt.json';

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

// Arquivos que o next start NÃO usa e que o baixar deixa de fora por padrão: não contam como "faltando".
const OPCIONAIS = /\.(?:map|nft\.json)$/;

/**
 * COMPLETUDE do .next: todo arquivo que os manifestos do PRÓPRIO Next citam tem de existir. Fontes: required-server-files.json (`files`; separadores e o prefixo .next normalizados),
 * server/app-paths-manifest.json (cada rota do App Router -> o .js da rota, inclusive as pastas catch-all como app/api/auth/[...all]/route.js) e server/pages-manifest.json.
 * Existe para pegar um download que perdeu pastas (24/11: 8 pastas de rotas de API foram recusadas por engano e o .next ficou sem login e sem APIs). Devolve as faltas (vazio = completo).
 */
export function arquivosFaltando(nextDir) {
  const faltam = [];
  const barra = String.fromCharCode(92);
  const ler = (rel) => { try { return JSON.parse(readFileSync(join(nextDir, rel), 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
  const existe = (rel) => existsSync(join(nextDir, ...rel.split('/')));
  const rsf = ler('required-server-files.json');
  if (!rsf || !Array.isArray(rsf.files)) faltam.push('required-server-files.json (ausente, ilegível ou sem a lista files)');
  else for (const f of rsf.files) { const rel = String(f).split(barra).join('/').replace(/^\.\//, '').replace(/^\.next\//, ''); if (!OPCIONAIS.test(rel) && !existe(rel)) faltam.push(rel); }
  for (const man of ['server/app-paths-manifest.json', 'server/pages-manifest.json']) {
    const m = ler(man);
    if (m === null) { if (man.includes('app-paths')) faltam.push(`${man} (ausente ou ilegível)`); continue; }
    for (const [rota, arq] of Object.entries(m)) { if (typeof arq !== 'string') continue; const rel = `server/${arq.split(barra).join('/')}`; if (!OPCIONAIS.test(rel) && !existe(rel)) faltam.push(`${rel} (rota ${rota})`); }
  }
  return [...new Set(faltam)];
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
  // GA4: o ID é constante de build (embutida no bundle do cliente); o .next só vale com o MESMO ID que o release.json declara (ausente = null nos dois)
  if ((pb.gaId ?? null) !== (release?.gaId ?? null)) p.push(`gaId do pré-construído ("${pb.gaId ?? 'nenhum'}") difere do release.json ("${release?.gaId ?? 'nenhum'}"): o ID do GA4 é embutido no build`);
  const fl = (x) => JSON.stringify([...(Array.isArray(x) ? x : [])].map(String).sort());
  if (fl(pb.flagsLigadas) !== fl(release?.flagsLigadas)) p.push('flagsLigadas do pré-construído diferem do release.json');
  if (!/^[A-Za-z0-9_-]{6,}$/.test(String(pb.buildId ?? ''))) p.push('prebuilt.json sem buildId');
  if (pb.nextVersion && nextInstalado && pb.nextVersion !== nextInstalado) p.push(`next ${nextInstalado} instalado difere do next ${pb.nextVersion} que construiu o .next`);
  if (!Array.isArray(pb.externos)) p.push('prebuilt.json sem a lista de externos');
  else {
    for (const x of pb.externos) {
      if (!x?.pacote) { p.push(`externo "${String(x?.nome).slice(0, 60)}" sem nome de pacote reconhecível (sufixo de 16 hex)`); continue; }
      if (!NOME_EXTERNO.test(String(x.nome)) || String(x.nome).includes('..')) p.push(`externo com nome fora do formato (nome de pacote + 16 hex): "${String(x.nome).slice(0, 60)}"`);
      else if (!NOME_PACOTE.test(String(x.pacote)) || String(x.pacote).includes('..')) p.push(`externo ${String(x.nome).slice(0, 60)} com pacote fora do formato npm: "${String(x.pacote).slice(0, 60)}"`);
      else if (pacoteDoExterno(x.nome) !== x.pacote) p.push(`externo ${String(x.nome).slice(0, 60)} não corresponde ao pacote "${String(x.pacote).slice(0, 60)}"`);
    }
  }
  return p;
}

/** Remove UMA entrada de .next/node_modules sem seguir links: link/arquivo = unlink (nunca o conteúdo do alvo); pasta de verdade = remoção recursiva (QA 5, P3: antes dava EISDIR/EPERM). */
function removerEntrada(p) {
  const st = lstatSync(p);
  if (st.isSymbolicLink() || !st.isDirectory()) unlinkSync(p);
  else rmSync(p, { recursive: true, force: true });
}

function limparLinks(nextDir) {
  const base = join(nextDir, 'node_modules');
  if (!existsSync(base)) return;
  for (const nome of readdirSync(base)) {
    const p = join(base, nome);
    const st = lstatSync(p);
    if (nome.startsWith('@') && st.isDirectory() && !st.isSymbolicLink()) { for (const f of readdirSync(p)) removerEntrada(join(p, f)); continue; }
    removerEntrada(p);
  }
}

// nomes de externo/pacote vêm do prebuilt.json e viram CAMINHOS (link dentro de .next/node_modules e alvo em node_modules): só nomes de pacote npm simples (QA 5, P3)
const NOME_EXTERNO = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*-[0-9a-f]{16}$/;
const NOME_PACOTE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const dentroDe = (base, alvo) => { const b = resolve(base); const a = resolve(alvo); return a === b || a.startsWith(b + sep); };

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
  // Formato RESERVA (--tar): o .next vai num ÚNICO prebuilt/web-next.tar (~1470 entradas no pacote em vez de ~3400, para o caso de o upload recusar por número de entradas); extrai-se com o tar do sistema.
  const arqTar = join(root, PREBUILT_TAR);
  const usaTar = !existsSync(origem) && existsSync(arqTar);
  if (!usaTar && !existsSync(join(origem, 'BUILD_ID'))) return { ativo: true, problemas: [`${PREBUILT_DIR} sem BUILD_ID (pacote incompleto ou o .next foi removido do ZIP)`], log };
  const idOrigem = usaTar ? pb.buildId : readFileSync(join(origem, 'BUILD_ID'), 'utf8').trim();
  if (idOrigem !== pb.buildId) return { ativo: true, problemas: [`BUILD_ID da pasta (${idOrigem}) difere do prebuilt.json (${pb.buildId})`], log };
  // "já presente" só vale com a MARCA gravada por esta restauração: um .next com o mesmo BUILD_ID deixado por um build da Vertra (ou de outra origem) NÃO conta e é substituído;
  // assim a prova no staging não depende de o volume ter ou não sobras do build anterior.
  const marca = join(destino, MARCA);
  let marcaOk = false;
  try { const m = JSON.parse(readFileSync(marca, 'utf8')); marcaOk = m.buildId === idOrigem && m.geradoEm === pb.geradoEm; } catch { /* sem marca */ }
  const idDestino = existsSync(join(destino, 'BUILD_ID')) ? readFileSync(join(destino, 'BUILD_ID'), 'utf8').trim() : null;
  if (idDestino !== idOrigem || !marcaOk) {
    if (existsSync(destino)) { limparLinks(destino); rmSync(destino, { recursive: true, force: true }); }
    mkdirSync(dirname(destino), { recursive: true });
    if (usaTar) {
      mkdirSync(destino, { recursive: true });
      const x = spawnSync(TAR, ['-xf', arqTar, '-C', destino], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (x.error || x.status !== 0) return { ativo: true, problemas: [`falha ao extrair ${PREBUILT_TAR}: ${String(x.stderr || x.error?.message || 'tar indisponível').slice(0, 200)}`], log };
      const idExtraido = existsSync(join(destino, 'BUILD_ID')) ? readFileSync(join(destino, 'BUILD_ID'), 'utf8').trim() : null;
      if (idExtraido !== pb.buildId) return { ativo: true, problemas: [`BUILD_ID extraído do tar (${idExtraido}) difere do prebuilt.json (${pb.buildId})`], log };
    } else cpSync(origem, destino, { recursive: true });
    writeFileSync(marca, JSON.stringify({ buildId: idOrigem, geradoEm: pb.geradoEm, commit: pb.commit }) + '\n');
    log.push(`.next restaurado de ${usaTar ? PREBUILT_TAR : PREBUILT_DIR} (BUILD_ID ${idOrigem}${idDestino === idOrigem ? '; havia um .next igual sem a marca da restauração: substituído' : ''})`);
  } else log.push(`.next já presente (BUILD_ID ${idOrigem}, marca da restauração ok)`);

  for (const x of pb.externos) {
    const alvo = join(root, 'node_modules', x.pacote);
    const link = join(destino, 'node_modules', x.nome);
    // defesa em profundidade (os nomes já foram validados em problemasPrebuilt): link só dentro de .next/node_modules e alvo só dentro de node_modules
    if (!dentroDe(join(destino, 'node_modules'), link) || !dentroDe(join(root, 'node_modules'), alvo)) { problemas.push(`externo ${String(x.nome).slice(0, 60)} resolve para fora de node_modules: recusado`); continue; }
    if (!existsSync(alvo)) { problemas.push(`externo ${x.pacote} não está em node_modules: a instalação da Vertra não o trouxe (está em dependencies?)`); continue; }
    let ok = false;
    try { ok = lstatSync(link).isSymbolicLink() && existsSync(link); } catch { /* ausente */ }
    if (!ok) {
      try { removerEntrada(link); } catch { /* ausente */ } // link velho/quebrado, arquivo ou pasta de verdade no lugar do link
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(alvo, link, process.platform === 'win32' ? 'junction' : 'dir');
      log.push(`link ${x.nome} -> node_modules/${x.pacote}`);
    }
  }

  // completude: nenhum arquivo citado pelos manifestos do Next pode faltar (um .next com pasta de rota perdida subiria sem login/API)
  const faltam = arquivosFaltando(destino);
  if (faltam.length) problemas.push(`.next restaurado INCOMPLETO: faltam ${faltam.length} arquivo(s) citado(s) pelos manifestos do Next (${faltam.slice(0, 5).join(' | ')}${faltam.length > 5 ? ' | …' : ''}): refaça o download com --retomar e o pacote`);
  // o mesmo conferido que o build-web faz depois do build: canonical com a URL do ambiente e noindex fora de produção/antes do go-live
  const idx = join(destino, 'server', 'app', 'index.html');
  // Home DINÂMICA (o build real do staging não gera server/app/index.html; o build-web só AVISA e pula): sem HTML estático não há o que conferir aqui; o canonical e o noindex dessa
  // home vêm do ambiente em execução (NEXT_PUBLIC_SITE_URL e APP_ENV, que o start-web já confere contra o release.json). NÃO é erro.
  if (!existsSync(idx)) log.push('home dinâmica: sem server/app/index.html estático; canonical e noindex vêm do ambiente em execução (conferido pelo start-web)');
  else problemas.push(...checkHome(readFileSync(idx, 'utf8'), release.siteUrl, release.appEnv, Boolean(release.vitrine), Boolean(release.indexavel)));
  return { ativo: true, problemas, log };
}

/** Só para teste/diagnóstico: onde o link aponta (ou null). */
export function alvoDoLink(link) { try { return readlinkSync(link); } catch { return null; } }
