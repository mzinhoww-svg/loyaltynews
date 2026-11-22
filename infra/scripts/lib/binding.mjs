// Vinculação ambiente <-> banco (bloqueio do QA em ft-infra-ci-staging.md): migração e backup só valem se o banco que as credenciais
// alcançam for O MESMO que o ambiente declara. A identidade é o host do banco (na Vertra contém o ID do banco) e o nome do banco:
// dados NÃO secretos, registrados em infra/vertra/bindings.json no provisionamento (valores nulos = ambiente ainda não provisionado).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDbUrl } from './pg.mjs';

const CANON = { staging: 'staging', homologacao: 'staging', production: 'production', producao: 'production' };
export const canonEnv = (e) => CANON[String(e || '').toLowerCase()] ?? null;

export function loadBindings(root = process.cwd()) {
  const p = join(root, 'infra/vertra/bindings.json');
  if (!existsSync(p)) throw new Error('infra/vertra/bindings.json ausente');
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Confere que `databaseUrl` aponta para o banco registrado para `env`. Devolve a identidade. Lança se não bater ou se não houver registro. */
export function assertBound({ env, databaseUrl, root }) {
  const e = canonEnv(env);
  if (!e) throw new Error(`ambiente desconhecido: ${env}`);
  const reg = loadBindings(root).ambientes?.[e];
  if (!reg || !reg.dbHost || !reg.dbName) throw new Error(`ambiente "${e}" sem vínculo em infra/vertra/bindings.json (preencher dbHost e dbName no provisionamento): recusado`);
  const id = parseDbUrl(databaseUrl);
  if (id.host !== String(reg.dbHost).toLowerCase() || id.database !== reg.dbName) {
    throw new Error(`DATABASE_URL (${id.host}/${id.database}) NÃO corresponde ao banco registrado para "${e}" (${reg.dbHost}/${reg.dbName}): recusado`);
  }
  return { env: e, host: id.host, database: id.database };
}
