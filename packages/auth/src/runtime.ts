// Instância única (por processo) de banco + Better Auth + handler, montada a partir do ambiente.
// Sem DATABASE_URL e BETTER_AUTH_SECRET válidos devolve null: todas as rotas protegidas negam (padrão seguro).
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from '@ln/db';
import { pgPoolConfig } from '@ln/db/tls';
import { createAuthHandler } from './handler';
import { createAuth, type Auth } from './server';
import type { Db } from './types';

export interface Runtime {
  db: Db;
  auth: Auth;
  handle: (request: Request) => Promise<Response>;
}

const KEY = Symbol.for('ln.auth.runtime');
type G = typeof globalThis & { [KEY]?: Runtime | null };

export function getRuntime(env: Record<string, string | undefined> = process.env): Runtime | null {
  const g = globalThis as G;
  if (g[KEY] !== undefined) return g[KEY] ?? null;
  const url = env.DATABASE_URL;
  const secret = env.BETTER_AUTH_SECRET;
  if (!url || !secret || secret.length < 32) {
    g[KEY] = null;
    return null;
  }
  let pool: Pool;
  try {
    // TLS com certificado de cliente (Vertra, R0-07): DB_SSL_*_PEM. Configuração de TLS inválida = banco não configurado (rotas negam) + log SEM segredo.
    pool = new Pool(pgPoolConfig(env, { max: 5 }));
  } catch (e) {
    console.error(`[auth] banco não configurado: ${e instanceof Error ? e.message : 'erro de TLS'}`);
    g[KEY] = null;
    return null;
  }
  const db = drizzle(pool, { schema }) as unknown as Db;
  const auth = createAuth({ db, secret, baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:3000' });
  g[KEY] = { db, auth, handle: createAuthHandler({ auth, db }) };
  return g[KEY];
}

/** Só para testes: troca ou limpa a instância. */
export function setRuntimeForTest(rt: Runtime | null | undefined): void {
  (globalThis as G)[KEY] = rt;
}
