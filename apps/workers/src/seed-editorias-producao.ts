// CLI mínima do worker: cria as 10 editorias OFICIAIS em PRODUÇÃO (DP-52, autorizada pelo proprietário) e nada mais.
// Dono: Frente 02 — LN Backend Engineer.
//  - Insere SÓ as 10 editorias de EDITORIAS (@ln/contracts), com `insert … onConflictDoNothing`: repetir é seguro (idempotente). Nunca atualiza nem apaga uma editoria que já exista.
//  - NÃO cria matéria, evento, documento de site, demonstração, usuário nem qualquer outro dado.
//  - Recusa (nada é conectado antes de passar): sem `--confirm-production`; APP_ENV diferente de `production` (exato); DATABASE_URL cujo host/banco difere do registrado para produção
//    em infra/vertra/bindings.json (produção sem vínculo = recusa). A mensagem de recusa nunca repete a URL, o host nem o nome do banco.
//  - Saída (stdout) SÓ: `editorias criadas: N, já existiam: M`. Nada de URL, segredo, PEM nem detalhe de banco.
//  - Auditoria: uma linha em `audit_log` (ação `producao.editorias_seed`, só contagens) na MESMA transação das inserções.
// Build: npm run build:seed-editorias-producao -w @ln/workers  →  apps/workers/dist/seed-editorias-producao.js
// Uso:   APP_ENV=production DATABASE_URL=… DB_SSL_*_PEM=… node dist/seed-editorias-producao.js --confirm-production
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { audit } from '@ln/auth';
import type { Db } from '@ln/auth';
import { EDITORIAS } from '@ln/contracts';
import { schema } from '@ln/db';
import { errLine, onClientError } from '@ln/db/safe-log';
import { pgPoolConfig } from '@ln/db/tls';
import bindingsFile from '../../../infra/vertra/bindings.json';
import type { BindingsFile } from './staging-admin';

export class SeedEditoriasRefused extends Error {}

export const CONFIRM_FLAG = '--confirm-production';

/** Só `APP_ENV=production` (exato). Staging, vazio, `producao`, `Production` e qualquer outro valor recusam. */
export function assertProduction(env: Record<string, string | undefined>): void {
  if (env.APP_ENV !== 'production') throw new SeedEditoriasRefused(`recusado: APP_ENV=${env.APP_ENV ? env.APP_ENV : '(vazio)'}; só vale com APP_ENV=production`);
}

/** DATABASE_URL tem de apontar para o banco de produção registrado (host e nome). Lança sem repetir a URL, o host nem o banco. */
export function assertProductionBound(databaseUrl: string | undefined, bindings: BindingsFile = bindingsFile as BindingsFile): void {
  const reg = bindings.ambientes?.production;
  if (!reg || !reg.dbHost || !reg.dbName) throw new SeedEditoriasRefused('recusado: produção sem vínculo de banco em infra/vertra/bindings.json');
  let u: URL;
  try {
    u = new URL(databaseUrl ?? '');
  } catch {
    throw new SeedEditoriasRefused('recusado: DATABASE_URL ausente ou inválida');
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new SeedEditoriasRefused('recusado: DATABASE_URL precisa ser postgres://');
  const host = u.hostname.toLowerCase();
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (host !== reg.dbHost.toLowerCase() || database !== reg.dbName) throw new SeedEditoriasRefused('recusado: DATABASE_URL NÃO aponta para o banco de produção registrado em infra/vertra/bindings.json');
}

export interface SeedEditoriasReport { criadas: number; existiam: number }

/** Insere as editorias oficiais que faltam. `criadas` é o que de fato entrou (RETURNING), não o que se tentou. */
export async function seedEditoriasProducao(db: Db, now: Date = new Date()): Promise<SeedEditoriasReport> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const inseridas = await t
      .insert(schema.editorias)
      .values(EDITORIAS.map((e) => ({ slug: e.slug, nome: e.nome })))
      .onConflictDoNothing()
      .returning({ slug: schema.editorias.slug });
    const report: SeedEditoriasReport = { criadas: inseridas.length, existiam: EDITORIAS.length - inseridas.length };
    await audit(t, { actorId: 'seed-editorias-producao', actorRole: 'cli', action: 'producao.editorias_seed', resource: 'editorias', resourceId: 'oficiais', detalhe: { ...report }, at: now });
    return report;
  });
}

export async function run(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  out: (s: string) => void = console.log,
  /** Só testes: banco já aberto e vínculo injetado. */
  inj: { db?: unknown; bindings?: BindingsFile } = {},
): Promise<number> {
  if (argv.length !== 1 || argv[0] !== CONFIRM_FLAG) {
    out(`uso: seed-editorias-producao ${CONFIRM_FLAG}  (cria as 10 editorias oficiais; só com APP_ENV=production no banco de produção registrado)`);
    return 2;
  }
  try {
    assertProduction(env);
    assertProductionBound(env.DATABASE_URL, inj.bindings);
  } catch (e) {
    out(e instanceof SeedEditoriasRefused ? e.message : 'recusado');
    return 2;
  }
  const pool = inj.db ? null : new Pool(pgPoolConfig(env, { max: 1 }));
  pool?.on('error', onClientError('[seed-editorias-producao] pg (conexão ociosa)')); // C1: nunca o objeto de erro (traz o TLS)
  try {
    const db = (inj.db ?? drizzle(pool!, { schema })) as unknown as Db;
    const r = await seedEditoriasProducao(db);
    out(`editorias criadas: ${r.criadas}, já existiam: ${r.existiam}`);
    return 0;
  } finally {
    await pool?.end();
  }
}

const invokedDirectly = typeof process !== 'undefined' && process.argv[1] !== undefined && /seed-editorias-producao\.(js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(errLine('[seed-editorias-producao] falha', e)); // C1–C5: só a mensagem, sem URL nem PEM
      process.exit(1);
    },
  );
}
