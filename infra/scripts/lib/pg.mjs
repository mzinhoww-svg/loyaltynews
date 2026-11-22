// Acesso ao PostgreSQL da Vertra: TLS obrigatório com certificado de cliente (a senha sozinha nunca conecta).
// Os PEM vêm de variáveis de ambiente (limite da Vertra: 3.072 caracteres por valor) e são gravados em arquivos
// temporários 0600, apagados ao final. Nada de segredo em argv.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { must } from './util.mjs';

/** prefix: 'DB' (origem) ou 'RESTORE_DB' (destino do ensaio). */
export function pgEnv(prefix, tmpDir) {
  const g = (k) => process.env[`${prefix}_${k}`];
  const need = ['HOST', 'PORT', 'NAME', 'USER', 'PASSWORD', 'CA_PEM', 'CLIENT_CERT_PEM', 'CLIENT_KEY_PEM'].filter((k) => !g(k));
  if (need.length) throw new Error(`variáveis ausentes: ${need.map((k) => `${prefix}_${k}`).join(', ')}`);
  const ca = join(tmpDir, `${prefix}.ca.pem`);
  const crt = join(tmpDir, `${prefix}.crt`);
  const key = join(tmpDir, `${prefix}.key`);
  writeFileSync(ca, g('CA_PEM'), { mode: 0o600 });
  writeFileSync(crt, g('CLIENT_CERT_PEM'), { mode: 0o600 });
  writeFileSync(key, g('CLIENT_KEY_PEM'), { mode: 0o600 });
  return {
    PGHOST: g('HOST'), PGPORT: g('PORT'), PGDATABASE: g('NAME'), PGUSER: g('USER'), PGPASSWORD: g('PASSWORD'),
    PGSSLMODE: 'verify-full', PGSSLROOTCERT: ca, PGSSLCERT: crt, PGSSLKEY: key,
  };
}

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

/** Contagem e checksum por tabela (ADR-012: "contagens e checksums por tabela iguais"). */
export function tableStats(env, psql = process.env.PSQL_BIN || 'psql') {
  const list = must(psql, ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
    "select schemaname||'.'||tablename from pg_tables where schemaname not in ('pg_catalog','information_schema') order by 1"],
  { env, capture: true }).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const stats = {};
  for (const full of list) {
    const [schema, table] = full.split('.');
    const sql = `select count(*)||'|'||md5(coalesce(string_agg(t::text, E'\\n' order by t::text), '')) from ${q(schema)}.${q(table)} t`;
    const out = must(psql, ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { env, capture: true }).stdout.trim();
    const [rows, md5] = out.split('|');
    stats[full] = { rows: Number(rows), md5 };
  }
  return stats;
}

export function compareStats(expected, actual) {
  const diffs = [];
  for (const t of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const a = expected[t]; const b = actual[t];
    if (!a) diffs.push(`${t}: tabela inesperada no destino`);
    else if (!b) diffs.push(`${t}: ausente no destino`);
    else if (a.rows !== b.rows || a.md5 !== b.md5) diffs.push(`${t}: origem ${a.rows} linhas/${a.md5.slice(0, 8)} != destino ${b.rows} linhas/${b.md5.slice(0, 8)}`);
  }
  return diffs;
}
