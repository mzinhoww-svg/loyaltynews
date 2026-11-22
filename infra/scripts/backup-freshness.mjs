#!/usr/bin/env node
// Alerta de backup velho/ausente (ADR-012: falha do job gera alerta em até 15 min).
// Rodar a cada 15 min por rotina externa; código 1 = ALERTAR. Também é a barreira antes de migrar produção.
// Uso: node infra/scripts/backup-freshness.mjs --env production [--max-age-min 375]
// 375 min = RPO de 6 h + 15 min de tolerância. Ambiente: BACKUP_DEST (e AWS_* se s3://).
import { parseArgs, fail, requireEnv, withTempDir } from './lib/util.mjs';
import { readText } from './lib/dest.mjs';

const args = parseArgs(process.argv.slice(2));
requireEnv(['BACKUP_DEST']);
const envName = args.env;
if (!['staging', 'production'].includes(envName)) fail('use --env staging|production', 2);
const maxMin = Number(args['max-age-min'] ?? 375);

try {
  const latest = await withTempDir('ln-fresh-', (tmp) => JSON.parse(readText(process.env.BACKUP_DEST, `latest-${envName}.json`, tmp)));
  const ageMin = (Date.now() - Date.parse(latest.createdAt)) / 60000;
  if (!Number.isFinite(ageMin)) fail('latest sem createdAt válido');
  const out = { env: envName, file: latest.file, ageMin: Math.round(ageMin), maxMin, ok: ageMin <= maxMin };
  console.log(JSON.stringify(out));
  process.exit(out.ok ? 0 : 1);
} catch (e) {
  console.log(JSON.stringify({ env: envName, ok: false, motivo: e.message }));
  process.exit(1);
}
