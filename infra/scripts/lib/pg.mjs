// Acesso ao PostgreSQL da Vertra. Convenção do scaffold (packages/db/src/migrate.ts): DATABASE_URL + TLS com certificado de
// cliente por variável PEM (DB_SSL_CA_PEM, DB_SSL_CERT_PEM, DB_SSL_KEY_PEM). A Vertra exige TLS verify-full; senha sozinha nunca conecta.
// Os PEM vão para arquivos temporários 0600, apagados ao final. Nada de segredo em argv.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { must } from './util.mjs';

/** Identidade NÃO secreta do banco a partir da URL (host e nome do banco; o host da Vertra contém o ID do banco). */
export function parseDbUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('DATABASE_URL inválida'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('DATABASE_URL precisa ser postgres://');
  return {
    host: u.hostname.toLowerCase(), port: u.port || '5432', database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  };
}

/** origem: { urlVar:'DATABASE_URL', pemPrefix:'DB_SSL' } · ensaio de restauração: { urlVar:'RESTORE_DATABASE_URL', pemPrefix:'RESTORE_DB_SSL' } */
export function pgEnv({ urlVar, pemPrefix }, tmpDir, env = process.env) {
  const need = [urlVar, `${pemPrefix}_CA_PEM`, `${pemPrefix}_CERT_PEM`, `${pemPrefix}_KEY_PEM`].filter((k) => !env[k]);
  if (need.length) throw new Error(`variáveis ausentes: ${need.join(', ')}`);
  const id = parseDbUrl(env[urlVar]);
  const ca = join(tmpDir, `${pemPrefix}.ca.pem`);
  const crt = join(tmpDir, `${pemPrefix}.crt`);
  const key = join(tmpDir, `${pemPrefix}.key`);
  writeFileSync(ca, env[`${pemPrefix}_CA_PEM`], { mode: 0o600 });
  writeFileSync(crt, env[`${pemPrefix}_CERT_PEM`], { mode: 0o600 });
  writeFileSync(key, env[`${pemPrefix}_KEY_PEM`], { mode: 0o600 });
  return {
    PGHOST: id.host, PGPORT: id.port, PGDATABASE: id.database, PGUSER: id.user, PGPASSWORD: id.password,
    PGSSLMODE: 'verify-full', PGSSLROOTCERT: ca, PGSSLCERT: crt, PGSSLKEY: key,
  };
}

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

/** Tabelas de usuário a partir da saída de `psql -At` (schema.tabela por linha). Função pura (testada sem banco). */
export function parseUserTables(stdout) {
  return String(stdout).split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Tabelas de usuário do banco (ignora catálogos do PostgreSQL e o schema `drizzle`, que só guarda o controle das migrações). Vazio = banco novo. */
export function userTables(env, psql = process.env.PSQL_BIN || 'psql') {
  const sql = "select table_schema||'.'||table_name from information_schema.tables where table_type='BASE TABLE' and table_schema not in ('pg_catalog','information_schema','drizzle') order by 1";
  return parseUserTables(must(psql, ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { env, capture: true }).stdout);
}

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
