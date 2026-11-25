// Rotas /api/commercial/** a partir da tabela ROUTES do módulo comercial (@ln/commercial/api).
import { sql } from 'drizzle-orm';
import { can } from '@ln/auth';
import { apiError } from '@ln/contracts';
import { makeCtx, type CommercialCtx } from '@ln/commercial';
import { deleteLeadById, leadAuditSalt } from '@ln/commercial';
import { ROUTES, type Route } from '@ln/commercial/api';
import type { Db } from '@ln/auth';
import { AVISO_VENDA_DESLIGADA, vendaLiberadaNoAmbiente } from '../../../../lib/studio/comercial';
import { createDispatcher, type PureRoute } from '../handler-adapter';
import type { RouteCtx } from '../http';
import { adCall, isAdRoute } from './ads';
import { listAccounts, listCampaigns } from './lists';
import { COMMERCIAL_LOCK, hydrate, loadDelivery, persist, seedCommercial } from './repo';

// relatório de campanha (campaignId) e do anunciante (accountId, contrato do Commercial): só eles recebem as linhas de ad_delivery_daily
const isReportRoute = (path: string): boolean => /\/(campaigns|accounts)\/report(-csv)?$/.test(path);

/**
 * DP-43 por ambiente, na API (defesa em profundidade: a tela já esconde isto). Onde a venda NÃO foi liberada pelo proprietário
 * (FLAG_RELEASES.adServerVendas null: produção hoje; ambiente desconhecido, local ou CI), aprovar criativo e levar campanha a
 * 'approved' ou 'active' são recusados com 409 SALE_DISABLED_IN_ENV. É a MESMA regra das telas (vendaLiberadaNoAmbiente); staging e
 * as demais operações (rascunho, reserva, cancelar, pausar...) não mudam.
 */
export const SALE_DISABLED_IN_ENV = 'SALE_DISABLED_IN_ENV';
type AtorApi = { canManageCommercial: boolean; canApprove?: boolean } | undefined;
/**
 * A chamada é uma operação de venda que, sem a trava de ambiente, PASSARIA pelas checagens de papel? Só estas são recusadas com
 * SALE_DISABLED_IN_ENV: o admin ao aprovar (criativo ou campanha) e quem gerencia o comercial ao ativar. Quem não pode aprovar segue
 * recebendo o 403 APPROVAL_FORBIDDEN da DP-43 em qualquer ambiente (o contrato de papel não muda); sem sessão, o 401 vem antes.
 */
export function vendaTravadaNaApi(method: string, path: string, input: unknown, ator: AtorApi): boolean {
  if (method !== 'POST' || !ator?.canManageCommercial) return false;
  if (path.endsWith('/studio/creatives/approve')) return ator.canApprove === true;
  if (path.endsWith('/studio/campaigns/transition')) {
    const para = input && typeof input === 'object' ? (input as { to?: unknown }).to : undefined;
    if (para === 'approved') return ator.canApprove === true;
    return para === 'active';
  }
  return false;
}

/** Data de calendário em America/Sao_Paulo (YYYY-MM-DD). */
export const saoPauloDate = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

/**
 * DELETE /api/commercial/studio/leads/:leadId — exclusão de verdade do lead (LGPD). Restrita a quem gerencia o
 * comercial (admin/comercial); não há papel de anunciante com acesso. A trilha grava só HMAC do id, com sal do
 * servidor; sem sal, a exclusão não acontece (500), porque uma trilha sem sal não é segura.
 */
export async function runLeadDeletion(
  input: unknown,
  c: RouteCtx,
  actor: { id: string; canManageCommercial: boolean } | undefined,
  now: Date,
): Promise<{ status: number; body: unknown }> {
  if (!actor?.canManageCommercial) return { status: 403, body: apiError('FORBIDDEN', 'Sem permissão para o módulo comercial.') };
  const leadId = input && typeof input === 'object' ? (input as { leadId?: unknown }).leadId : undefined;
  if (typeof leadId !== 'string' || leadId.length < 1 || leadId.length > 128) {
    return { status: 400, body: apiError('VALIDATION_ERROR', 'Entrada inválida.') };
  }
  let salt: string;
  try {
    salt = leadAuditSalt(process.env);
  } catch (e) {
    console.error('[commercial] exclusão de lead recusada:', e instanceof Error ? e.message : 'sal ausente');
    return { status: 500, body: apiError('LEAD_AUDIT_NOT_CONFIGURED', 'A exclusão de lead não está configurada neste ambiente.') };
  }
  const deleted = await c.deps.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await db.execute(sql`select pg_advisory_xact_lock(${COMMERCIAL_LOCK})`);
    return deleteLeadById(db, leadId, { at: now, actorId: actor.id, actorRole: c.session?.role ?? null, origin: 'studio' }, salt);
  });
  return deleted ? { status: 204, body: null } : { status: 404, body: apiError('NOT_FOUND', 'Lead não encontrado.') };
}

/** Listas pedidas pelo Studio (aec1612), do adaptador do Backend: somente leitura, mesmo contexto hidratado das demais GET. */
const EXTRA: readonly Route[] = [
  { method: 'GET', path: '/api/commercial/studio/campaigns', auth: 'studio', handler: listCampaigns },
  { method: 'GET', path: '/api/commercial/studio/accounts', auth: 'studio', handler: listAccounts },
  // Exclusão de lead (LGPD): o handler é tratado em `runLeadDeletion`, com o banco; este marcador nunca roda.
  { method: 'DELETE', path: '/api/commercial/studio/leads/:leadId', auth: 'studio', handler: () => ({ status: 500, body: apiError('INTERNAL_ERROR', 'Exclusão de lead tratada no adaptador.') }) },
];

const routes: readonly PureRoute<Route['handler']>[] = [...ROUTES, ...EXTRA].map((r) => ({ method: r.method, path: r.path, auth: r.auth, handler: r.handler }));

export const dispatchCommercial = createDispatcher({
  routes,
  // quem entra nas rotas de Studio: sessão com MFA e leitura de campanhas; o handler exige canManageCommercial
  studioPerm: ['campanhas', 'read'],
  auditResource: 'comercial',
  limitPublicPosts: true,
  async call(route, input, c) {
    const now = c.deps.now();
    const actor = c.session
      ? { id: c.session.userId, canManageCommercial: can(c.session.role, 'campanhas', 'update') && can(c.session.role, 'inventario', 'update'), canApprove: c.session.role === 'admin' /* DP-43: aprova imagem e campanha só o proprietário */ }
      : undefined;
    const extra = { now: now.toISOString(), today: saoPauloDate(now), flags: c.deps.flags, actor };
    // Exclusão de lead (LGPD): apaga de verdade, com trilha sem PII, na mesma transação e sob a trava do módulo.
    if (route.method === 'DELETE' && route.path === '/api/commercial/studio/leads/:leadId') {
      return runLeadDeletion(input, c, actor, now);
    }
    // DP-43 por ambiente: onde a venda não foi liberada, aprovar e ativar são recusados antes de tocar o banco
    if (vendaTravadaNaApi(route.method, route.path, input, actor) && !vendaLiberadaNoAmbiente()) {
      return { status: 409, body: apiError(SALE_DISABLED_IN_ENV, AVISO_VENDA_DESLIGADA) };
    }
    // anúncios públicos: Redis, sem hidratar o banco inteiro e sem lock
    if (isAdRoute(route.path)) return adCall(route as Route, input, c, extra);
    if (route.method === 'GET') {
      const q = (input && typeof input === 'object' ? input : {}) as { campaignId?: unknown; accountId?: unknown; from?: unknown; to?: unknown };
      const txt = (v: unknown) => (typeof v === 'string' ? v : undefined);
      const scope = { campaignId: txt(q.campaignId), accountId: txt(q.accountId), from: txt(q.from), to: txt(q.to) };
      const h = await hydrate(c.deps.db, now, undefined, scope);
      // relatório do anunciante: só nestas rotas (e só da campanha e da janela pedidas) as linhas diárias de entrega entram no contexto
      const delivery = isReportRoute(route.path) ? await loadDelivery(c.deps.db, input) : undefined;
      return route.handler(makeCtx(h.state, { ...extra, delivery }), input);
    }
    return runCommercialWrite(route as Route, input, c, extra);
  },
});

/** Escrita do comercial: uma transação com a trava do módulo, hidratar → handler → persistir. Usada pelo despachante e pelo upload do criativo. */
export async function runCommercialWrite(
  route: Pick<Route, 'handler'>,
  input: unknown,
  c: RouteCtx,
  extra: { now: string; today: string; flags: CommercialCtx['flags']; actor?: CommercialCtx['actor'] },
): Promise<{ status: number; body: unknown }> {
  return c.deps.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await db.execute(sql`select pg_advisory_xact_lock(${COMMERCIAL_LOCK})`);
    await seedCommercial(db);
    const h = await hydrate(db, new Date(extra.now));
    const res = route.handler(makeCtx(h.state, extra), input);
    if (res.status < 400) await persist(db, h, h.state);
    return res;
  });
}
