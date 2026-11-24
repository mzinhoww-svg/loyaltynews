#!/usr/bin/env node
// Guarda da troca de memória do WEB durante o build (2048 MB só no build; 512 MB em regime). NÃO fala com a Vertra: lê o JSON que o PM salva do `get_profile`
// e diz (1) se pode subir agora, (2) os passos exatos na ordem, com o valor esperado de `plan.memory.used` depois de cada um, (3) se o estado está certo
// em cada fase. Quem executa na Vertra é o PM (update_app_config e deploy_app); este script só confere e nunca imprime e-mail, nome ou segredo.
// Regras (PEDIDO-PROVISIONAMENTO-PRODUCAO-v3 §1): só UM web do LN fica acima do regime por vez; o pico nunca passa de limite − margem; a memória
// volta ao regime SEMPRE, também quando o build falha (a Vertra faz o rollback do release, não da memória).
// Uso:
//   node infra/scripts/memoria-build.mjs plano    --profile <get_profile.json> --app <id> [--pacote <pasta>] [--build 2048] [--regime 512] [--margem 128]
//   node infra/scripts/memoria-build.mjs conferir --profile <get_profile.json> --app <id> --fase antes|durante|depois [--build 2048] [--regime 512] [--margem 128]
// Saída: JSON; código 0 = pode seguir / estado certo, 1 = NÃO siga (motivos em `problemas`), 2 = uso errado.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs, fail } from './lib/util.mjs';

/** get_profile do MCP/API, com ou sem o envelope `{ response: ... }`. */
export function lerPerfil(json) {
  const p = json && typeof json === 'object' && json.response && typeof json.response === 'object' ? json.response : json;
  if (!p || !Array.isArray(p.applications) || !p.plan?.memory) throw new Error('JSON não parece um get_profile (faltam applications e plan.memory)');
  const limit = Number(p.plan.memory.limit);
  const used = Number(p.plan.memory.used);
  if (!Number.isFinite(limit) || !Number.isFinite(used)) throw new Error('plan.memory.limit/used inválidos');
  const apps = p.applications.map((a) => ({ id: a.id, name: String(a.name ?? ''), ram: Number(a.ram), type: a.type, status: a.status }));
  const dbs = (Array.isArray(p.databases) ? p.databases : []).map((d) => ({ id: d.id, name: String(d.name ?? ''), ram: Number(d.ram) }));
  const soma = apps.reduce((s, a) => s + a.ram, 0) + dbs.reduce((s, d) => s + d.ram, 0);
  return { limit, used, apps, dbs, soma };
}

/** Webs do LN: tipo Website (2) com nome `ln-*`. */
const ehWebLN = (a) => a.type === 2 && /^ln-/i.test(a.name);

/**
 * Avalia o estado para uma fase. fase: 'antes' (vai subir), 'durante' (já está subido, vai fazer o deploy) ou 'depois' (já baixou).
 * Função pura (testada sem Vertra).
 */
/** Memória do web durante o build. 24/11/2026: o build do web (Turbopack, Next 16.4.6) passou a morrer com "Killed" (137) a 880 e 1024 MB e passou a 2048 (ambiente de build = 2× a RAM, máx. 4096); a regra antiga de 880 deixou de valer. Com 5248 alocados o pico é 6784 de 8192. Na PRODUÇÃO em regime (7552) o pico seria 9088: NÃO cabe; use --build menor e plano à parte. */
export const BUILD_PADRAO = 2048;

export function avaliar(perfil, appId, { fase, build = BUILD_PADRAO, regime = 512, margem = 128 }) {
  const problemas = [];
  const alvo = perfil.apps.find((a) => a.id === appId);
  if (!alvo) return { ok: false, problemas: [`app ${appId} não está no get_profile`], alvo: null };
  if (!Number.isInteger(build) || !Number.isInteger(regime) || regime < 100 || build < regime) {
    return { ok: false, problemas: [`valores inválidos: build=${build} regime=${regime} (build ≥ regime ≥ 100)`], alvo };
  }
  if (perfil.soma !== perfil.used) problemas.push(`o get_profile não fecha: soma dos apps e bancos = ${perfil.soma}, plan.memory.used = ${perfil.used} (leitura velha ou recurso fora da lista)`);
  const irmaos = perfil.apps.filter((a) => ehWebLN(a) && a.id !== appId);
  const irmaoAlto = irmaos.filter((a) => a.ram > regime);
  const livre = perfil.limit - perfil.used;
  const extra = build - alvo.ram;
  if (fase === 'antes') {
    if (alvo.ram !== regime) problemas.push(`${alvo.name} está em ${alvo.ram} MB, não no regime de ${regime}: confira se um build anterior deixou a memória alta`);
    for (const a of irmaoAlto) problemas.push(`${a.name} está em ${a.ram} MB (acima do regime ${regime}): só um web sobe por vez; baixe-o antes`);
    if (extra > 0 && perfil.limit - (perfil.used + extra) < margem) problemas.push(`faltam ${margem - (livre - extra)} MB: o pico seria ${perfil.used + extra} de ${perfil.limit} (livre ${livre - extra}, mínimo ${margem})`);
  } else if (fase === 'durante') {
    if (alvo.ram !== build) problemas.push(`${alvo.name} está em ${alvo.ram} MB, esperado ${build} durante o build`);
    for (const a of irmaoAlto) problemas.push(`${a.name} também está acima do regime (${a.ram} MB)`);
    if (livre < margem) problemas.push(`sobram só ${livre} MB de ${perfil.limit} (mínimo ${margem})`);
  } else if (fase === 'depois') {
    if (alvo.ram !== regime) problemas.push(`${alvo.name} continua em ${alvo.ram} MB: baixe para ${regime} (update_app_config memory ${regime}), também quando o build falhou`);
    for (const a of irmaoAlto) problemas.push(`${a.name} está acima do regime (${a.ram} MB)`);
  } else {
    return { ok: false, problemas: ['--fase deve ser antes, durante ou depois'], alvo };
  }
  return { ok: problemas.length === 0, problemas, alvo: { id: alvo.id, nome: alvo.name, ram: alvo.ram }, used: perfil.used, limit: perfil.limit, livre };
}

/** Passos exatos, na ordem, com o `used` esperado depois de cada um. */
export function passos(perfil, appId, { build = BUILD_PADRAO, regime = 512, pacote = '<pasta do pacote>' }) {
  const alvo = perfil.apps.find((a) => a.id === appId);
  const base = perfil.used - (alvo.ram - regime); // used com o alvo no regime
  const pico = base + (build - regime);
  return [
    { n: 1, acao: 'get_profile (salve o JSON) e rode: memoria-build.mjs conferir --fase antes', usedEsperado: perfil.used },
    { n: 2, acao: 'update_app_config', args: { id: appId, memory: build }, usedEsperado: pico, nota: `o ambiente de build passa a ter ${2 * build} MB (2× a RAM do app)` },
    { n: 3, acao: 'get_profile e rode: memoria-build.mjs conferir --fase durante', usedEsperado: pico },
    { n: 4, acao: 'get_file_tree + node infra/scripts/arquivos-orfaos.mjs --tree <arquivo> --pasta <pacote>; apague as sobras (delete_file)', usedEsperado: pico },
    { n: 5, acao: 'deploy_app', args: { id: appId, path: pacote, restart: true, message: '<commit curto>' }, usedEsperado: pico },
    { n: 6, acao: 'wait_for_app; confirme o release `active` (list_releases: source upload) e, se falhou, get_release_log do release', usedEsperado: pico },
    { n: 7, acao: 'update_app_config', args: { id: appId, memory: regime }, usedEsperado: base, nota: 'SEMPRE, também quando o build falhou ou o deploy foi revertido' },
    { n: 8, acao: 'get_profile e rode: memoria-build.mjs conferir --fase depois; confirme /api/health com o commit novo', usedEsperado: base },
  ];
}

function main() {
  const modo = process.argv[2];
  const args = parseArgs(process.argv.slice(3));
  if (!['plano', 'conferir'].includes(modo)) fail('use: plano | conferir (veja o cabeçalho do script)', 2);
  for (const k of ['profile', 'app']) if (!args[k] || args[k] === true) fail(`use --${k}`, 2);
  const num = (k, d) => (args[k] === undefined ? d : Number(args[k]));
  const opt = { build: num('build', BUILD_PADRAO), regime: num('regime', 512), margem: num('margem', 128) };
  let perfil;
  try { perfil = lerPerfil(JSON.parse(readFileSync(String(args.profile), 'utf8'))); } catch (e) { fail(`perfil: ${e.message}`, 2); }
  const appId = String(args.app);
  if (modo === 'plano') {
    const a = avaliar(perfil, appId, { ...opt, fase: 'antes' });
    const saida = { ok: a.ok, problemas: a.problemas, app: a.alvo, usedAgora: perfil.used, limite: perfil.limit, ...opt };
    if (a.ok) saida.passos = passos(perfil, appId, { ...opt, pacote: args.pacote && args.pacote !== true ? String(args.pacote) : undefined });
    console.log(JSON.stringify(saida, null, 2));
    process.exit(a.ok ? 0 : 1);
  }
  if (!args.fase || args.fase === true) fail('use --fase antes|durante|depois', 2);
  const r = avaliar(perfil, appId, { ...opt, fase: String(args.fase) });
  console.log(JSON.stringify({ fase: String(args.fase), ...r }, null, 2));
  process.exit(r.ok ? 0 : 1);
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main();
