// Rotas do Entity Intelligence (@ln/intelligence): handlers puros sobre uma porta SQL `query(sql, params)`.
// Público (Portal): só dados com pessoas se a flag `intelligencePessoas` estiver ligada (J-01); nunca inferidos.
// Studio: RBAC por rota; revisão de move/alerta por quem tem `materias:transition`; pedidos do titular (LGPD) só admin.
import { apiError } from '@ln/contracts';
import {
  addWatchlistItemHandler, createWatchlistHandler, deleteWatchlistHandler, listWatchlists, removeWatchlistItemHandler, exportSubjectDataHandler, getCompanyHandler, getExecutiveHandler, getOrgChartHandler,
  getWatchlistHandler, graphNeighborsHandler, graphPathHandler, listAlertsHandler, listMovesHandler, listWatchlistsHandler,
  openSubjectRequestHandler, rectifySubjectHandler, reviewAlertHandler, reviewMoveHandler, searchCompaniesHandler,
  searchExecutivesHandler, suppressSubjectHandler, type ApiResult, type Db as IntelDb,
} from '@ln/intelligence';
import type { Action, Db, Resource } from '@ln/auth';
import { createDispatcher, type PureRoute } from '../handler-adapter';
import { confirmRoleHandler, discardRoleHandler, listRolesHandler } from './cargos';

/** Porta SQL do Intelligence sobre o cliente do driver (pg Pool em produção, PGlite nos testes). */
export function intelDb(db: Db): IntelDb {
  const client = (db as unknown as { $client?: { query?: unknown } }).$client;
  if (!client || typeof client.query !== 'function') throw new Error('driver sem $client.query: não dá para montar a porta do Intelligence');
  const q = client.query.bind(client) as (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  return { query: async <T,>(sql: string, params?: unknown[]) => ({ rows: (await q(sql, params)).rows as T[] }) };
}

type H = (db: IntelDb, actor: string, input: unknown) => Promise<ApiResult>;
interface IRoute extends PureRoute<H> {
  /** Expõe dado de pessoa: o Portal só recebe com a flag `intelligencePessoas` ligada. */
  people?: boolean;
}

const PUB = '/api/intelligence';
const STU = '/api/studio/intelligence';
const READ: readonly [Resource, Action] = ['entidades', 'read'];
const WRITE: readonly [Resource, Action] = ['entidades', 'update'];
const CREATE: readonly [Resource, Action] = ['entidades', 'create'];
const REVIEW: readonly [Resource, Action] = ['materias', 'transition'];
const DPO: readonly [Resource, Action] = ['usuarios', 'update']; // só admin: pedidos do titular

const pub = (path: string, handler: H, people = false): IRoute => ({ method: 'GET', path: PUB + path, auth: 'public', handler, people });
const stu = (method: 'GET' | 'POST' | 'DELETE', path: string, perm: readonly [Resource, Action], handler: H): IRoute => ({ method, path: STU + path, auth: 'studio', perm, handler });

export const INTELLIGENCE_ROUTES: readonly IRoute[] = [
  // ---- Portal (sem login) ----
  pub('/companies', (db, _a, i) => searchCompaniesHandler(db, i)),
  pub('/companies/:id', (db, _a, i) => getCompanyHandler(db, 'public', i), true),
  pub('/companies/:organizationId/org-chart', (db, _a, i) => getOrgChartHandler(db, 'public', i), true),
  pub('/executives', (db, _a, i) => searchExecutivesHandler(db, i), true),
  pub('/executives/:id', (db, _a, i) => getExecutiveHandler(db, 'public', i), true),
  pub('/moves', (db, _a, i) => listMovesHandler(db, 'public', i), true),
  pub('/graph/neighbors', (db, _a, i) => graphNeighborsHandler(db, 'public', i), true),
  // ---- Studio ----
  stu('GET', '/companies', READ, (db, _a, i) => searchCompaniesHandler(db, i)),
  stu('GET', '/companies/:id', READ, (db, _a, i) => getCompanyHandler(db, 'studio', i)),
  stu('GET', '/companies/:organizationId/org-chart', READ, (db, _a, i) => getOrgChartHandler(db, 'studio', i)),
  stu('GET', '/executives', READ, (db, _a, i) => searchExecutivesHandler(db, i)),
  stu('GET', '/executives/:id', READ, (db, _a, i) => getExecutiveHandler(db, 'studio', i)),
  stu('GET', '/moves', READ, (db, _a, i) => listMovesHandler(db, 'studio', i)),
  stu('GET', '/graph/neighbors', READ, (db, _a, i) => graphNeighborsHandler(db, 'studio', i)),
  stu('POST', '/graph/path', READ, (db, _a, i) => graphPathHandler(db, 'studio', i)),
  // cargos "a confirmar" (fonte secundária): fila, confirmação com a página OFICIAL e descarte (editor ou superior: entidades:update)
  stu('GET', '/roles', READ, listRolesHandler),
  stu('POST', '/roles/:id/confirm', WRITE, confirmRoleHandler),
  stu('POST', '/roles/:id/discard', WRITE, discardRoleHandler),
  stu('POST', '/moves/:id/review', REVIEW, (db, a, i) => reviewMoveHandler(db, a, i)),
  // watchlists são PRIVADAS: o dono é quem criou (`actor`); quem não é o dono recebe 404 (nunca revela que a lista existe), como manda o WATCHLISTS_API.md
  stu('GET', '/watchlists', READ, (db, a, i) => listWatchlistsHandler(db, { ...(isObj(i) ? i : {}), ownerRef: a })),
  stu('POST', '/watchlists', CREATE, (db, a, i) => createWatchlistHandler(db, a, i)),
  stu('GET', '/watchlists/:id', READ, (db, a, i) => getWatchlistHandler(db, i, a)),
  stu('DELETE', '/watchlists/:id', WRITE, (db, a, i) => deleteWatchlistHandler(db, a, i)),
  stu('POST', '/watchlists/:watchlistId/items', WRITE, (db, a, i) => addWatchlistItemHandler(db, i, a)),
  stu('DELETE', '/watchlists/:watchlistId/items', WRITE, (db, a, i) => removeWatchlistItemHandler(db, a, i)),
  stu('GET', '/alerts', READ, alertsOfOwner),
  stu('POST', '/alerts/:id/review', REVIEW, (db, a, i) => reviewAlertHandler(db, a, i)),
  stu('POST', '/subject-requests', DPO, (db, a, i) => openSubjectRequestHandler(db, a, i)),
  stu('POST', '/subject-requests/:requestId/export', DPO, (db, a, i) => exportSubjectDataHandler(db, a, i)),
  stu('POST', '/subject-requests/:requestId/suppress', DPO, (db, a, i) => suppressSubjectHandler(db, a, i)),
  stu('POST', '/subject-requests/:requestId/rectify', DPO, (db, a, i) => rectifySubjectHandler(db, a, i)),
];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Em GET a query chega como texto: `includeInferred=true` vira o booleano que os handlers esperam (sem isso o cargo inferido nunca aparecia por HTTP). */
const BOOLEAN_KEYS = ['includeInferred', 'includeClosed'];
export function normalizeBooleans(input: unknown): unknown {
  if (!isObj(input)) return input;
  return Object.fromEntries(Object.entries(input).map(([k, v]) => (BOOLEAN_KEYS.includes(k) && (v === 'true' || v === 'false') ? [k, v === 'true'] : [k, v])));
}

/** Alertas só das watchlists do próprio `actor` (o dono); watchlistId de outro dono = 404, como nas demais rotas de watchlist. */
async function alertsOfOwner(db: IntelDb, actor: string, input: unknown): Promise<ApiResult> {
  const mine = new Set((await listWatchlists(db, actor)).map((w) => w.id));
  const wid = isObj(input) && typeof input.watchlistId === 'string' ? input.watchlistId : undefined;
  if (wid && !mine.has(wid)) return { status: 404, body: { error: { code: 'not_found', message: 'watchlist não encontrada' } } };
  const r = await listAlertsHandler(db, input);
  if (r.status !== 200) return r;
  const body = r.body as { items: { watchlist_id: string }[] };
  return { status: 200, body: { ...body, items: body.items.filter((a) => mine.has(a.watchlist_id)) } };
}

export const dispatchIntelligence = createDispatcher<H>({
  routes: INTELLIGENCE_ROUTES,
  studioPerm: READ,
  auditResource: 'intelligence',
  async call(route, input, c) {
    const r = route as IRoute;
    if (r.people && !c.deps.flags.intelligencePessoas) {
      return { status: 403, body: apiError('FEATURE_DISABLED', 'Dados de pessoas desligados (flag intelligencePessoas; condições de J-01).') };
    }
    return r.handler(intelDb(c.deps.db), c.session?.userId ?? '', normalizeBooleans(input));
  },
});
