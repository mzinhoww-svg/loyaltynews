// Dependências das rotas de API (banco, auth, relógio, flags). Em produção vêm do ambiente
// (DATABASE_URL, BETTER_AUTH_SECRET); sem elas getDeps() devolve null e as rotas respondem 503 NOT_CONFIGURED
// (APP_MODE=nodb: o site sobe sem banco). Testes injetam as suas com setDepsForTest.
import { FLAG_DEFAULTS, type FlagState } from '@ln/contracts';
import { getRuntime } from '@ln/auth/runtime';
import type { Auth, Db } from '@ln/auth';

export interface Deps {
  db: Db;
  auth: Auth;
  now: () => Date;
  flags: FlagState;
}

let override: Deps | null = null;

export function setDepsForTest(d: Deps | null): void {
  override = d;
}

export function getDeps(env: Record<string, string | undefined> = process.env): Deps | null {
  if (override) return override;
  if (env.APP_MODE === 'nodb') return null;
  const rt = getRuntime(env);
  if (!rt) return null;
  return { db: rt.db, auth: rt.auth, now: () => new Date(), flags: { ...FLAG_DEFAULTS } };
}
