// Rotas /api/commercial/** a partir da tabela ROUTES do módulo comercial (@ln/commercial/api).
import { sql } from 'drizzle-orm';
import { can } from '@ln/auth';
import { makeCtx } from '@ln/commercial';
import { ROUTES, type Route } from '@ln/commercial/api';
import type { Db } from '@ln/auth';
import { createDispatcher, type PureRoute } from '../handler-adapter';
import { COMMERCIAL_LOCK, hydrate, persist, seedCommercial } from './repo';

/** Data de calendário em America/Sao_Paulo (YYYY-MM-DD). */
export const saoPauloDate = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

const routes: readonly PureRoute<Route['handler']>[] = ROUTES.map((r) => ({ method: r.method, path: r.path, auth: r.auth, handler: r.handler }));

export const dispatchCommercial = createDispatcher({
  routes,
  // quem entra nas rotas de Studio: sessão com MFA e leitura de campanhas; o handler exige canManageCommercial
  studioPerm: ['campanhas', 'read'],
  auditResource: 'comercial',
  limitPublicPosts: true,
  async call(route, input, c) {
    const now = c.deps.now();
    const actor = c.session
      ? { id: c.session.userId, canManageCommercial: can(c.session.role, 'campanhas', 'update') && can(c.session.role, 'inventario', 'update') }
      : undefined;
    const extra = { now: now.toISOString(), today: saoPauloDate(now), flags: c.deps.flags, actor };
    if (route.method === 'GET') {
      const h = await hydrate(c.deps.db);
      return route.handler(makeCtx(h.state, extra), input);
    }
    return c.deps.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      await db.execute(sql`select pg_advisory_xact_lock(${COMMERCIAL_LOCK})`);
      await seedCommercial(db);
      const h = await hydrate(db);
      const res = route.handler(makeCtx(h.state, extra), input);
      if (res.status < 400) await persist(db, h, h.state, extra.today);
      return res;
    });
  },
});
