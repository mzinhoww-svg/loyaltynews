// Social Dashboard (Frente 09, @ln/growth) como rotas do Studio. PUBLICAÇÃO SOMENTE SIMULADA: o publicador é criado
// em modo 'simulated' e não há caminho de configuração para o modo real (nada vai ao mLabs; recibos `SIM-…`).
// Permissões do Growth derivadas do RBAC: social:read ← social/read, social:generate ← social/create,
// social:request_publish ← social/publish.
import { apiError } from '@ln/contracts';
import { can, type Action, type Resource } from '@ln/auth';
import { createSocialPublisher, growthFlagsFrom } from '@ln/growth';
import {
  generatePackages, getDashboardSummary, getPackage, listAudit, listQueue, listReceipts, PERMISSIONS, requestSimulatedPublish,
  type Caller, type DashboardDeps, type HandlerResult,
} from '@ln/growth/dashboard';
import { createDispatcher, type PureRoute } from '../handler-adapter';
import { PgArticleSource } from './articles';
import { PgPackageStore } from './store';

type H = (d: DashboardDeps, caller: Caller, input: Record<string, unknown>) => Promise<HandlerResult<unknown>>;
const P = '/api/studio/social';
const READ: readonly [Resource, Action] = ['social', 'read'];
const GEN: readonly [Resource, Action] = ['social', 'create'];
const PUB: readonly [Resource, Action] = ['social', 'publish'];
const r = (method: 'GET' | 'POST', path: string, perm: readonly [Resource, Action], handler: H): PureRoute<H> => ({
  method, path: P + path, auth: 'studio', perm, handler,
});

export const SOCIAL_ROUTES: readonly PureRoute<H>[] = [
  r('GET', '/summary', READ, (d, c) => getDashboardSummary(d, c)),
  r('GET', '/queue', READ, (d, c, i) => listQueue(d, c, i)),
  r('GET', '/packages/:id', READ, (d, c, i) => getPackage(d, c, String(i.id))),
  r('GET', '/receipts', READ, (d, c) => listReceipts(d, c)),
  r('GET', '/audit', READ, (d, c, i) => listAudit(d, c, Number(i.limit ?? 50) || 50)),
  r('POST', '/packages', GEN, (d, c, i) => generatePackages(d, c, i)),
  r('POST', '/packages/:id/publish-simulated', PUB, (d, c, i) => requestSimulatedPublish(d, c, String(i.id))),
];

// O publicador guarda recibos e auditoria em memória (por processo); pacotes e recibos ficam no PostgreSQL.
let publisher: ReturnType<typeof createSocialPublisher> | null = null;
export function getPublisher() {
  return (publisher ??= createSocialPublisher({ mode: 'simulated' }));
}
export function resetPublisherForTest() {
  publisher = null;
}

export const dispatchSocial = createDispatcher<H>({
  routes: SOCIAL_ROUTES,
  studioPerm: READ,
  auditResource: 'social',
  async call(route, input, c) {
    const role = c.session!.role;
    const permissions = [
      ...(can(role, 'social', 'read') ? [PERMISSIONS.read] : []),
      ...(can(role, 'social', 'create') ? [PERMISSIONS.generate] : []),
      ...(can(role, 'social', 'publish') ? [PERMISSIONS.requestPublish] : []),
    ];
    const deps: DashboardDeps = {
      store: new PgPackageStore(c.deps.db),
      articles: new PgArticleSource(c.deps.db, process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
      publisher: getPublisher(),
      flags: growthFlagsFrom(c.deps.flags),
      now: () => c.deps.now().toISOString(),
    };
    if (deps.publisher.mode !== 'simulated') {
      return { status: 500, body: apiError('INTERNAL_ERROR', 'publicador não está em modo simulado') };
    }
    return route.handler(deps, { id: c.session!.userId, permissions }, input as Record<string, unknown>);
  },
});
