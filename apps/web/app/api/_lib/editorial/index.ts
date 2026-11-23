// Rotas do CMS editorial: handlers puros de @ln/editorial (fila, revisão, checagem, correções, direito de resposta,
// fontes/habilitação) sobre o PgEditorialStore. Sessão + MFA + RBAC: este adaptador autentica e entrega `actor`;
// os handlers aplicam o RBAC próprio do domínio (ACTION_ROLES) e devolvem o envelope de erro.
// Escritas (POST) rodam numa transação com lock consultivo e o store ligado à transação (leitura-modificação-escrita
// sem corrida entre dois revisores). Recheck enfileira no outbox (Redis só com IDs; o worker relê o registro).
import { sql } from 'drizzle-orm';
import {
  acknowledgeLegalCase, closeCorrection, getArticleReview, getCorrection, getFactcheck, intakeRightOfReply, listCorrections, listQueue,
  listPautas, listSources, markCorrectionEntitiesRebuilt, openCorrection, preserveCorrectionEvidence, publishCorrectionNotice, reconcileCorrectionSocial,
  requestRecheck, reviewSource, setSourceEnabled, submitPauta, submitReview, triageCorrection, verifyRequester, SEED_SOURCES, SourceRegistry,
  type ApiResponse, type JobQueue,
} from '@ln/editorial';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { registerPublication, type PublicationCtx } from './publication';
import { articlesPublishedLookup } from './published';
import { getArticleDraft } from './draft-view';
import { enqueueOutbox } from '@ln/workers/outbox';
import type { Action, Db, Resource } from '@ln/auth';
import { createDispatcher, type PureRoute } from '../handler-adapter';

type H = (ctx: PublicationCtx, input: unknown) => Promise<ApiResponse<unknown>>;
const STU = '/api/studio/editorial';
const PUB = '/api/editorial';
// RBAC grosso na borda (quem nem é da redação nunca chega ao handler); o fino é ACTION_ROLES do domínio.
const READ: readonly [Resource, Action] = ['materias', 'read'];
const WRITE: readonly [Resource, Action] = ['materias', 'transition'];
const PUBLISH: readonly [Resource, Action] = ['materias', 'publish'];
const LOCK = 7_010_002;

const stu = (method: 'GET' | 'POST', path: string, perm: readonly [Resource, Action], handler: H): PureRoute<H> => ({ method, path: STU + path, auth: 'studio', perm, handler });

export const EDITORIAL_ROUTES: readonly PureRoute<H>[] = [
  // fila e revisão
  stu('GET', '/queue', READ, listQueue),
  stu('GET', '/articles/:articleId/review', READ, getArticleReview),
  stu('POST', '/articles/:articleId/review', WRITE, submitReview),
  // rascunho completo + última checagem (formulário de correção do Studio; ADR-019 §c.5)
  stu('GET', '/articles/:articleId/draft', READ, getArticleDraft as H),
  stu('GET', '/articles/:articleId/factcheck', READ, getFactcheck),
  stu('POST', '/articles/:articleId/recheck', WRITE, requestRecheck),
  // registro da publicação (flag publicacaoPortal; recibo e identidade de publicação)
  stu('POST', '/articles/:articleId/publication', PUBLISH, registerPublication),
  // correções e direito de resposta
  stu('GET', '/corrections', READ, listCorrections),
  stu('GET', '/corrections/:correctionId', READ, getCorrection),
  stu('POST', '/corrections', WRITE, openCorrection),
  stu('POST', '/corrections/:correctionId/verify-requester', WRITE, verifyRequester),
  stu('POST', '/corrections/:correctionId/preserve-evidence', WRITE, preserveCorrectionEvidence),
  stu('POST', '/corrections/:correctionId/triage', WRITE, triageCorrection),
  stu('POST', '/corrections/:correctionId/ack-legal', WRITE, acknowledgeLegalCase),
  stu('POST', '/corrections/:correctionId/publish-notice', WRITE, publishCorrectionNotice),
  stu('POST', '/corrections/:correctionId/reconcile-social', WRITE, reconcileCorrectionSocial),
  stu('POST', '/corrections/:correctionId/entities-rebuilt', WRITE, markCorrectionEntitiesRebuilt),
  stu('POST', '/corrections/:correctionId/close', WRITE, closeCorrection),
  // fontes: revisão e habilitação
  stu('GET', '/sources', READ, listSources),
  stu('POST', '/sources/:sourceId/review', WRITE, reviewSource),
  stu('POST', '/sources/:sourceId/enabled', WRITE, setSourceEnabled),
  // pauta autoral (DP-29): a rota só registra e lista; o worker (runAutoralQueue) processa
  stu('GET', '/pautas', READ, listPautas),
  stu('POST', '/pautas', WRITE, submitPauta),
  // Portal (sem sessão; limite por IP no dispatcher): formulário de direito de resposta
  { method: 'POST', path: `${PUB}/right-of-reply`, auth: 'public', handler: intakeRightOfReply },
];

/** Cadastro de fontes (imutável, no código). */
export const sourceRegistry = new SourceRegistry(SEED_SOURCES);

const STAGE_QUEUE: Record<string, 'coleta' | 'redacao' | 'checagem' | 'social'> = {
  triage: 'coleta', context: 'coleta', draft: 'redacao', factcheck: 'checagem', review: 'checagem', social_pack: 'social',
};

/** JobQueue sobre o outbox: só ids vão ao Redis; a chave de idempotência é o jobId (sem ':'). */
export function outboxQueue(db: Db): JobQueue {
  return {
    async enqueue(spec) {
      const queue = STAGE_QUEUE[spec.stage];
      if (!queue) throw new Error(`etapa sem fila: ${spec.stage}`);
      await enqueueOutbox(db, { queue, refId: spec.data.articleId, idempotencyKey: spec.jobId.replace(/[^A-Za-z0-9_.-]/g, '_') });
    },
  };
}

/** Coerção da query string (tudo chega como texto) para os campos numéricos/booleanos que os handlers esperam. */
export function coerceQuery(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const k of ['limit', 'offset']) if (typeof out[k] === 'string' && /^\d+$/.test(out[k] as string)) out[k] = Number(out[k]);
  for (const k of ['somenteElegiveis']) if (out[k] === 'true' || out[k] === 'false') out[k] = out[k] === 'true';
  return out;
}

/** Só para teste: troca a fábrica da loja (ex.: para armar a falha injetada). null restaura a padrão. */
let storeFactory = (db: Db): PgEditorialStore => new PgEditorialStore(db);
export function setStoreFactoryForTest(f: ((db: Db) => PgEditorialStore) | null): void {
  storeFactory = f ?? ((db) => new PgEditorialStore(db));
}

/** URL base do portal (mesma variável do portal e do Social). Sem ela a preservação de evidência exige a URL no pedido. */
const siteBaseUrl = (): string | undefined => process.env.NEXT_PUBLIC_SITE_URL?.trim() || undefined;

/** Evidências de apoio do caso (`supportingEvidenceIds` do pedido e do caso já aberto) que a verificação da errata também considera. */
async function supportingIds(store: PgEditorialStore, input: unknown): Promise<string[]> {
  const o = (input && typeof input === 'object' ? input : {}) as { supportingEvidenceIds?: unknown; correctionId?: unknown };
  const ids = Array.isArray(o.supportingEvidenceIds) ? o.supportingEvidenceIds.filter((x): x is string => typeof x === 'string') : [];
  if (typeof o.correctionId === 'string') ids.push(...((await store.getCorrection(o.correctionId))?.case.supportingEvidenceIds ?? []));
  return ids;
}

export const dispatchEditorial = createDispatcher<H>({
  routes: EDITORIAL_ROUTES,
  studioPerm: READ,
  auditResource: 'editorial',
  limitPublicPosts: true,
  async call(route, input, c) {
    const actor = c.session ? { userId: c.session.userId, roles: [c.session.role], mfa: c.session.mfa } : null;
    const base = { actor, now: c.deps.now, newId: () => crypto.randomUUID(), sources: sourceRegistry, flags: c.deps.flags, db: c.deps.db, siteBaseUrl: siteBaseUrl() };
    const data = route.method === 'GET' ? coerceQuery(input) : input;
    // ADR-019 §c: a matéria publicada vem de `articles` (porta PublishedArticleLookup); as evidências de apoio do caso entram na checagem
    const withLookup = (db: Db, store: PgEditorialStore) => ({
      ...base, db, store, published: articlesPublishedLookup(db, () => supportingIds(store, data)),
    });
    if (route.method === 'GET') return route.handler(withLookup(c.deps.db, storeFactory(c.deps.db)), data);
    return c.deps.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      await db.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
      return route.handler({ ...withLookup(db, storeFactory(db)), queue: outboxQueue(db) }, data);
    });
  },
});
