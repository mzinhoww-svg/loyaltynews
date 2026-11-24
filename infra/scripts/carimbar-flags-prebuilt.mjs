#!/usr/bin/env node
// Carimba as FLAGS DE PRODUTO de staging num pacote PRÉ-CONSTRUÍDO que o Actions construiu SEM flags (o workflow web-prebuilt não aceita flags: o ci-checks proíbe LN_FLAGS_ON em workflow, ADR-022).
// Por que vale: as flags só são lidas EM EXECUÇÃO (packages/contracts/src/flags.ts: resolveFlags na subida, em instrumentation-node; o .next não depende delas). Provado em 24/11/2026 com três
// `next build` de staging (releases/staging/prova-flags-build): dois builds iguais sem flag diferem em 159 arquivos (ruído do Next) e o build com flag difere dos sem flag nesses MESMOS 159: 0 diferenças atribuíveis
// à flag. A regra do ci-checks (LN_FLAGS_ON só é lida em packages/contracts/src/flags.ts) mantém isso verdadeiro; se ela reprovar, o carimbo deixa de valer e o staging volta a precisar de build próprio.
// O que muda (só o NECESSÁRIO para o start-web/guard-env exigirem LN_FLAGS_ON = release.json): release.json.flagsLigadas, prebuilt/prebuilt.json.flagsLigadas (+ registro `carimboFlags`) e o manifesto
// ao lado da pasta (flagsLigadas e a variável LN_FLAGS_ON nos passos set_env). O `.next` NÃO é tocado.
// Uso: node infra/scripts/carimbar-flags-prebuilt.mjs --pasta <ln-web-staging-…-prebuilt> --flags intelligencePessoas[,outra] --soma-esperada <arvore-sha256 do run> [--raiz <checkout com packages/contracts/src/flags.ts>]
// Sequência (infra/ci/LEIA-ME.md): baixar o artefato do run → conferir com `arvore-sha256.mjs <pasta> --esperado <hex do run>` → carimbar passando a MESMA soma em --soma-esperada: o 'antes' do carimbo TEM de ser a soma do run,
// senão recusa (pasta adulterada ou de outro run). O manifesto ao lado da pasta é OBRIGATÓRIO (ausente = recusa imediata, nada é gravado) e o packages/contracts/src/flags.ts do pacote tem de ser IGUAL, byte a byte, ao da --raiz
// (a validação das flags vale para o resolvedor que o app realmente vai rodar).
// Recusa: perfil que não seja staging; pacote que não seja web pré-construído; pacote que já tenha flags diferentes; flag desconhecida ou sem decisão para staging (valida com o resolveFlags do próprio contrato);
// ZIP ao lado (ficaria desatualizado). Saída: JSON com a soma da árvore ANTES e DEPOIS (arvore-sha256.mjs) e a lista de arquivos alterados. Código 0 = ok, 1 = recusado, 2 = uso errado.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fail, parseArgs, sha256File } from './lib/util.mjs';
import { somaArvore } from './arvore-sha256.mjs';
import { PREBUILT_MANIFEST, problemasPrebuilt } from './lib/prebuilt.mjs';

const SELF = dirname(fileURLToPath(import.meta.url));
const NOME_FLAG = /^[A-Za-z][A-Za-z0-9]*$/;

/** Pura: lista de flags normalizada (únicas, ordenadas). Lança Error se vazia ou com nome fora do formato. */
export function normalizarFlags(texto) {
  const lista = [...new Set(String(texto ?? '').split(',').map((s) => s.trim()).filter(Boolean))].sort();
  if (!lista.length) throw new Error('--flags exige nomes de flag separados por vírgula (ex.: intelligencePessoas)');
  for (const n of lista) if (!NOME_FLAG.test(n)) throw new Error(`nome de flag inválido "${n.slice(0, 40)}" (só letras e números)`);
  return lista;
}

/** Pura: acrescenta/atualiza LN_FLAGS_ON em toda lista de variáveis do manifesto (as que têm APP_COMMIT). Devolve quantas listas mudou. */
export function carimbarManifesto(man, flags) {
  const valor = flags.join(',');
  let listas = 0;
  const andar = (o) => {
    if (Array.isArray(o)) {
      if (o.some((x) => x && typeof x === 'object' && x.nome === 'APP_COMMIT')) {
        const atual = o.find((x) => x && typeof x === 'object' && x.nome === 'LN_FLAGS_ON');
        if (atual) atual.valor = valor; else o.push({ nome: 'LN_FLAGS_ON', valor });
        listas += 1;
      }
      o.forEach(andar);
    } else if (o && typeof o === 'object') Object.values(o).forEach(andar);
  };
  andar(man);
  man.flagsLigadas = flags;
  return listas;
}

/** Valida as flags com o resolveFlags do contrato do checkout (nome conhecido e decisão registrada para staging). Devolve os nomes ligados. */
export async function validarComContrato(raiz, flags, siteUrl) {
  const arq = join(raiz, 'packages', 'contracts', 'src', 'flags.ts');
  if (!existsSync(arq)) throw new Error(`packages/contracts/src/flags.ts ausente em ${raiz}`);
  const m = await import(pathToFileURL(arq).href);
  const r = m.resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: flags.join(','), NEXT_PUBLIC_SITE_URL: siteUrl });
  const ligadas = [...r.on].map(String).sort();
  if (JSON.stringify(ligadas) !== JSON.stringify(flags)) throw new Error(`o contrato ligou ${JSON.stringify(ligadas)} para o pedido ${JSON.stringify(flags)}`);
  return ligadas;
}

const direto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direto) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pasta || args.pasta === true || args.flags === undefined) fail('use --pasta <pasta pré-construída> --flags <nomes> --soma-esperada <arvore-sha256 do run>', 2);
  const somaEsperada = args['soma-esperada'] && args['soma-esperada'] !== true ? String(args['soma-esperada']).toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(somaEsperada)) fail('--soma-esperada é obrigatória: a linha arvore-sha256=<64 hex> do resumo do run (confira antes com arvore-sha256.mjs --esperado)', 2);
  const pasta = resolve(String(args.pasta));
  const raiz = args.raiz && args.raiz !== true ? resolve(String(args.raiz)) : resolve(SELF, '..', '..');
  let flags;
  try { flags = normalizarFlags(args.flags === true ? '' : args.flags); } catch (e) { fail(e.message, 2); }

  const relPath = join(pasta, 'release.json');
  const pbCaminho = join(pasta, PREBUILT_MANIFEST);
  if (!existsSync(relPath)) fail('--pasta não tem release.json', 1);
  if (!existsSync(pbCaminho)) fail('--pasta não é um pacote pré-construído (sem prebuilt.json)', 1);
  const manPath = join(dirname(pasta), `${basename(pasta)}.manifest.json`);
  if (!existsSync(manPath)) fail(`RECUSADO: manifesto ${basename(manPath)} ausente ao lado da pasta; sem ele o set_env do deploy não leva LN_FLAGS_ON. Baixe o artefato inteiro (pasta e manifesto) e não carimbe só a pasta`, 1);
  const ler = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
  const release = ler(relPath);
  const pb = ler(pbCaminho);

  if (release.tipo !== 'web') fail(`só o pacote do web pode ser carimbado (release.tipo=${release.tipo})`, 1);
  if (release.prebuilt !== true) fail('o pacote não é pré-construído (release.json.prebuilt != true)', 1);
  if (String(release.appEnv ?? '') !== 'staging') fail(`RECUSADO: APP_ENV do pacote é "${release.appEnv}"; flags por variável só existem no staging (ADR-022); em produção a flag liga por commit revisado`, 1);
  if (String(release.perfil ?? '').toLowerCase().startsWith('prod')) fail('RECUSADO: perfil de produção', 1);
  if (existsSync(join(dirname(pasta), `${basename(pasta)}.zip`))) fail('há um .zip ao lado da pasta: o carimbo não o atualiza (apague o ZIP e gere de novo depois)', 1);
  const atual = [...(Array.isArray(release.flagsLigadas) ? release.flagsLigadas : [])].map(String).sort();
  if (atual.length && JSON.stringify(atual) !== JSON.stringify(flags)) fail(`o pacote já liga outras flags (${atual.join(',')}); não reescrevo: refaça o pacote sem flags`, 1);
  let ligadas;
  try { ligadas = await validarComContrato(raiz, flags, release.siteUrl); } catch (e) { fail(`RECUSADO pelo contrato de flags: ${e.message}`, 1); }

  const antes = somaArvore(pasta);
  // o resolvedor de flags do pacote tem de ser o da raiz que validou os nomes
  const fPacote = join(pasta, 'packages', 'contracts', 'src', 'flags.ts');
  const fRaiz = join(raiz, 'packages', 'contracts', 'src', 'flags.ts');
  if (!existsSync(fPacote)) fail('RECUSADO: o pacote não tem packages/contracts/src/flags.ts (resolvedor de flags)', 1);
  if (!readFileSync(fPacote).equals(readFileSync(fRaiz))) fail('RECUSADO: packages/contracts/src/flags.ts do pacote DIFERE do da --raiz (a validação das flags não vale para o resolvedor que o app vai rodar); use a --raiz do MESMO commit do pacote', 1);
  if (atual.length && JSON.stringify(atual) === JSON.stringify(flags)) {
    console.log(JSON.stringify({ ok: true, jaCarimbado: true, flags: ligadas, arvoreSha256: antes }, null, 2));
    process.exit(0);
  }
  if (antes !== somaEsperada) fail(`RECUSADO: a soma da árvore (${antes}) NÃO é a do run (${somaEsperada}): a pasta foi alterada depois do download, é de outro run, ou o download está incompleto. Baixe de novo e confira com arvore-sha256.mjs --esperado`, 1);
  const alterados = [];
  const antesArq = {};
  for (const f of [relPath, pbCaminho]) antesArq[f] = await sha256File(f);
  release.flagsLigadas = flags;
  pb.flagsLigadas = flags;
  pb.carimboFlags = { de: [], para: flags, motivo: 'flags só em execução (ADR-022); o .next foi construído sem LN_FLAGS_ON (workflow web-prebuilt)', em: new Date().toISOString() };
  // o problemasPrebuilt do próprio restaurador tem de concordar ANTES de gravar qualquer coisa
  const prob = problemasPrebuilt(pb, release, null);
  if (prob.length) fail(`o pré-construído não passaria na restauração depois do carimbo:\n - ${prob.join('\n - ')}`, 1);
  // o manifesto é preparado ANTES de gravar qualquer coisa: sem a lista de variáveis do deploy (set_env com APP_COMMIT) o carimbo não vale e nada é alterado
  const man = ler(manPath);
  const listas = carimbarManifesto(man, flags);
  if (listas === 0) fail('RECUSADO: o manifesto não tem a lista de variáveis do deploy (set_env com APP_COMMIT): o LN_FLAGS_ON não chegaria ao app. Nada foi alterado', 1);
  writeFileSync(relPath, JSON.stringify(release));
  writeFileSync(pbCaminho, JSON.stringify(pb, null, 2) + '\n');
  alterados.push({ arquivo: relPath.slice(pasta.length + 1).split('\\').join('/'), antes: antesArq[relPath], depois: await sha256File(relPath) });
  alterados.push({ arquivo: pbCaminho.slice(pasta.length + 1).split('\\').join('/'), antes: antesArq[pbCaminho], depois: await sha256File(pbCaminho) });
  writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');
  const manifesto = { arquivo: basename(manPath), listasDeVariaveisAtualizadas: listas };
  const depois = somaArvore(pasta);
  console.log(JSON.stringify({ ok: true, flags: ligadas, arvoreSha256Antes: antes, arvoreSha256Depois: depois, alterados, manifesto, aviso: 'o ZIP (se houver) e a soma do artefato do Actions mudaram: registre as duas somas; o .next não foi tocado' }, null, 2));
}
