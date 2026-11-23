#!/usr/bin/env node
// Alerta de backup velho, ausente ou inconsistente (ADR-012: falha do job gera alerta em até 15 min) e barreira antes de migrar produção.
// Código 1 = ALERTAR/RECUSAR. Verifica, nesta ordem (QA: não basta a data do ponteiro `latest`):
//   1. `latest-<env>.json` existe e o manifesto que ele cita existe; os dois concordam (arquivo, data, SHA-256 do cifrado);
//   2. manifesto: ambiente igual ao pedido e BANCO DE ORIGEM igual ao registrado para o ambiente em infra/vertra/bindings.json
//      (um backup recente de OUTRO banco não vale);
//   3. data: não pode estar no futuro (tolerância 5 min) e a idade não passa de --max-age-min (375 = RPO 6 h + 15 min);
//   4. o objeto cifrado existe no destino com o tamanho do manifesto; com --verify-object, baixa e confere o SHA-256 (usado antes de migrar).
// Uso (na raiz do repositório): node infra/scripts/backup-freshness.mjs --env production [--max-age-min 375] [--verify-object]
// Ambiente: BACKUP_DEST (e AWS_* se s3://).
import { join } from 'node:path';
import { parseArgs, fail, requireEnv, withTempDir, sha256File } from './lib/util.mjs';
import { readText, statObject, getFile } from './lib/dest.mjs';
import { loadBindings, canonEnv } from './lib/binding.mjs';

const args = parseArgs(process.argv.slice(2));
requireEnv(['BACKUP_DEST']);
const envName = canonEnv(args.env);
if (!envName) fail('use --env staging|production', 2);
const maxMin = Number(args['max-age-min'] ?? 375);
const dest = process.env.BACKUP_DEST;

function out(ok, extra) { console.log(JSON.stringify({ env: envName, ok, ...extra })); process.exit(ok ? 0 : 1); }

try {
  const reg = loadBindings(process.cwd()).ambientes?.[envName];
  if (!reg?.dbHost || !reg?.dbName) out(false, { motivo: `ambiente sem vínculo em infra/vertra/bindings.json: não há como provar que o backup é deste banco` });

  const r = await withTempDir('ln-fresh-', async (tmp) => {
    const latest = JSON.parse(readText(dest, `latest-${envName}.json`, tmp));
    const manifest = JSON.parse(readText(dest, latest.manifest, tmp));
    const problems = [];
    if (manifest.env !== envName) problems.push(`manifesto é do ambiente "${manifest.env}"`);
    if (manifest.file !== latest.file || manifest.createdAt !== latest.createdAt || manifest.encryptedSha256 !== latest.encryptedSha256) problems.push('latest e manifesto divergem');
    if (!manifest.source || String(manifest.source.host).toLowerCase() !== String(reg.dbHost).toLowerCase() || manifest.source.database !== reg.dbName) {
      problems.push(`banco de origem do backup (${manifest.source?.host}/${manifest.source?.database}) não é o registrado para o ambiente (${reg.dbHost}/${reg.dbName})`);
    }
    const t = Date.parse(manifest.createdAt);
    const ageMin = (Date.now() - t) / 60000;
    if (!Number.isFinite(ageMin)) problems.push('createdAt inválido');
    else if (ageMin < -5) problems.push(`createdAt no futuro (${Math.round(-ageMin)} min)`);
    else if (ageMin > maxMin) problems.push(`backup velho: ${Math.round(ageMin)} min > ${maxMin} min`);
    let objectOk = null;
    try {
      const st = statObject(dest, manifest.file);
      if (st.size !== manifest.encryptedBytes) problems.push(`objeto com ${st.size} bytes; manifesto diz ${manifest.encryptedBytes}`);
      if (args['verify-object']) {
        const p = join(tmp, manifest.file);
        getFile(dest, manifest.file, p);
        objectOk = (await sha256File(p)) === manifest.encryptedSha256;
        if (!objectOk) problems.push('SHA-256 do objeto cifrado difere do manifesto');
      }
    } catch (e) { problems.push(e.message); }
    return { file: manifest.file, ageMin: Math.round(ageMin), maxMin, banco: `${manifest.source?.host}/${manifest.source?.database}`, hashConferido: objectOk, problems };
  });
  out(r.problems.length === 0, r);
} catch (e) {
  out(false, { motivo: e.message });
}
