import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';
import { pgPoolConfig } from './tls';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Banco-modelo em disco. Aplicar todas as migrações em WASM custa segundos por teste e, com vários workers e a máquina carregada,
 * estourava o tempo (falhas transitórias na suíte paralela). As migrações agora são aplicadas UMA vez por conteúdo de migração:
 * o diretório de dados (dump) fica em `os.tmpdir()` com o hash das migrações no nome, e cada `createTestDb` só carrega esse dump
 * num PGlite novo e ISOLADO (nada é compartilhado em memória entre testes). Gravação atômica (arquivo temporário + rename), então
 * workers concorrentes não leem arquivo pela metade; dump ausente, velho ou corrompido ⇒ reconstrói. Só para testes.
 */
function templateKey(): string {
  const h = createHash('sha256');
  const files = readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) h.update(f).update(readFileSync(join(MIGRATIONS_FOLDER, f)));
  const journal = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
  if (existsSync(journal)) h.update(readFileSync(journal));
  return h.digest('hex').slice(0, 24);
}

async function buildTemplate(path: string): Promise<void> {
  const seed = new PGlite();
  await migrate(drizzle(seed, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
  const dump = await seed.dumpDataDir('none');
  await seed.close();
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, Buffer.from(await dump.arrayBuffer()));
  try {
    renameSync(tmp, path);
  } catch {
    rmSync(tmp, { force: true }); // outro worker publicou o mesmo modelo primeiro: vale o dele
  }
}

async function open(path: string): Promise<PGlite> {
  const client = new PGlite({ loadDataDir: new Blob([readFileSync(path)]) });
  await client.waitReady;
  return client;
}

// ---------------------------------------------------------------------------------------------------------------------
// MODO PostgreSQL REAL (opcional): com LN_TEST_PG_URL (URL de um banco administrativo, ex. .../postgres) e LN_TEST_CERTS_DIR (ca.crt,
// client.crt, client.pk8.key; mesmo TLS com certificado de cliente da Vertra), `createTestDb` NÃO usa PGlite: clona um banco-modelo já
// migrado (CREATE DATABASE ... TEMPLATE) num banco novo e isolado por teste e o apaga no `close`. Serve para rodar a suíte inteira
// contra PostgreSQL 18 de verdade e achar o que o PGlite esconde (travas e concorrência reais, tipos, erros, planos).
// ---------------------------------------------------------------------------------------------------------------------
let avisado = false;
const realEnv = (): Record<string, string | undefined> | null => {
  const url = process.env.LN_TEST_PG_URL;
  const dir = process.env.LN_TEST_CERTS_DIR;
  if (!url || !dir) {
    // Sem as DUAS variáveis o modo real não liga e a suíte roda em PGlite: avisar para ninguém achar que rodou em PostgreSQL real.
    // (LN_TEST_CERTS_DIR sozinho é legítimo nos testes de TLS do Redis, que trazem LN_TEST_REDIS_TLS_URL.)
    const soUmaDoPg = (url && !dir) || (dir && !url && !process.env.LN_TEST_REDIS_TLS_URL);
    if (soUmaDoPg && !avisado) {
      avisado = true;
      console.warn(`[ln-test] ATENÇÃO: só ${url ? 'LN_TEST_PG_URL' : 'LN_TEST_CERTS_DIR'} está definida; o modo PostgreSQL REAL exige as duas (LN_TEST_PG_URL e LN_TEST_CERTS_DIR). Esta execução usa PGlite, NÃO o PostgreSQL real.`);
    }
    return null;
  }
  assertLocalTestHost(url, 'LN_TEST_PG_URL');
  return {
    DATABASE_URL: url,
    DB_SSL_CA_PEM: readFileSync(join(dir, 'ca.crt'), 'utf8'),
    DB_SSL_CERT_PEM: readFileSync(join(dir, 'client.crt'), 'utf8'),
    DB_SSL_KEY_PEM: readFileSync(join(dir, 'client.pk8.key'), 'utf8'),
    NODE_ENV: 'production',
  };
};

/**
 * Guarda de host: o modo real CRIA e APAGA bancos (e os testes de Redis real fazem `flushall`). Só vale em máquina local
 * (127.0.0.1, ::1, localhost) a menos que `LN_TEST_ALLOW_REMOTE=1` seja definida de propósito. Apontar a variável para staging
 * ou produção sem querer destruiria dados.
 */
export function assertLocalTestHost(url: string, nome: string): void {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    throw new Error(`${nome} não é uma URL válida`);
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || process.env.LN_TEST_ALLOW_REMOTE === '1') return;
  throw new Error(`${nome} aponta para um host que não é local (${host}): o teste cria/apaga bancos e limpa dados. Use uma instância local ou defina LN_TEST_ALLOW_REMOTE=1 de propósito.`);
}

const ident = (n: string): string => {
  if (!/^[a-z0-9_]+$/.test(n)) throw new Error('nome de banco inválido');
  return `"${n}"`;
};
const CLONE_LOCK = 7_030_001;

async function createRealDb(env: Record<string, string | undefined>) {
  const adminCfg = pgPoolConfig(env, { max: 1 });
  const admin = new pg.Pool(adminCfg);
  const tpl = `ln_tpl_${templateKey()}`;
  const name = `ln_t_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
  const withDb = (db: string) => env.DATABASE_URL!.replace(/\/[^/?]*(\?|$)/, `/${db}$1`);
  const c = await admin.connect();
  try {
    // uma conexão administrativa segura a trava durante o preparo do modelo e a clonagem (CREATE DATABASE ... TEMPLATE exige modelo sem uso)
    await c.query('SELECT pg_advisory_lock($1)', [CLONE_LOCK]);
    try {
      const has = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [tpl]);
      if (has.rowCount === 0) {
        const building = `${tpl}_b${process.pid}`;
        await c.query(`DROP DATABASE IF EXISTS ${ident(building)} WITH (FORCE)`);
        await c.query(`CREATE DATABASE ${ident(building)}`);
        const { runMigrations } = await import('./migrate');
        await runMigrations({ ...env, DATABASE_URL: withDb(building) });
        await c.query(`ALTER DATABASE ${ident(building)} RENAME TO ${ident(tpl)}`);
      }
      await c.query(`CREATE DATABASE ${ident(name)} TEMPLATE ${ident(tpl)}`);
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [CLONE_LOCK]).catch(() => undefined);
    }
  } finally {
    c.release();
  }
  const pool = new pg.Pool(pgPoolConfig({ ...env, DATABASE_URL: withDb(name) }, { max: 6 }));
  // Um cliente ocioso derrubado pelo DROP DATABASE ... FORCE (57P01) emite 'error'; sem handler isso vira exceção não tratada.
  pool.on('error', () => undefined);
  admin.on('error', () => undefined);
  const db = drizzlePg(pool, { schema });
  // Compatível com o que os testes usam do cliente PGlite (`exec` e `query`).
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await pool.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  };
  const client = {
    exec: (q: string) => pool.query(q),
    query: <T = Record<string, unknown>>(q: string, params?: unknown[]) => pool.query(q, params).then((r) => ({ rows: r.rows as T[] })),
    /** Formato do PGlite: `transaction(fn(tx))`, com `tx.query`. */
    async transaction<T>(fn: (tx: { query: <R = Record<string, unknown>>(q: string, p?: unknown[]) => Promise<{ rows: R[] }>; exec: (q: string) => Promise<unknown> }) => Promise<T>): Promise<T> {
      const c2 = await pool.connect();
      try {
        await c2.query('BEGIN');
        const out = await fn({ query: <R,>(q: string, p?: unknown[]) => c2.query(q, p).then((r) => ({ rows: r.rows as R[] })), exec: (q: string) => c2.query(q) });
        await c2.query('COMMIT');
        return out;
      } catch (e) {
        await c2.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        c2.release();
      }
    },
    close,
  };
  return { db, client, close, real: true as const };
}

/** Banco PostgreSQL (PGlite em memória por padrão; PostgreSQL real com LN_TEST_PG_URL) com todas as migrações aplicadas. Só para testes. */
export async function createTestDb() {
  const env = realEnv();
  if (env) return createRealDb(env) as unknown as ReturnType<typeof createPgliteDb>;
  return createPgliteDb();
}

async function createPgliteDb() {
  const path = join(tmpdir(), `ln-pglite-template-${templateKey()}.tar`);
  let client: PGlite | null = null;
  if (existsSync(path)) client = await open(path).catch(() => null);
  if (!client) {
    rmSync(path, { force: true });
    await buildTemplate(path);
    client = await open(path);
  }
  return { db: drizzle(client, { schema }), client, close: () => client!.close() };
}

/** Verdadeiro quando os testes rodam contra PostgreSQL REAL (LN_TEST_PG_URL + LN_TEST_CERTS_DIR) em vez de PGlite. */
export const isRealTestDb = (): boolean => realEnv() !== null;
