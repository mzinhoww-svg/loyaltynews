import type { SocialMetricsSource } from '../metrics/mlabs-metrics';
import { apiError, type ApiError } from '@ln/contracts';
import { z } from 'zod';
import { CopyRefusal } from '../copy/engine';
import { CreativeRefusal, TOKENS } from '../creative/post';
import type { GrowthFlags } from '../flags';
import type { PublishReceipt } from '../mlabs/port';
import { buildInstagramPackage, type InstagramPackage } from '../package/instagram';
import { buildLinkedInPackage, type LinkedInPackage } from '../package/linkedin';
import { PUBLISHER_SOCIAL, PublishRefused, type SocialPublisher } from '../publisher/publisher';
import type { Article, Channel } from '../types';
import type { ArticleSource } from './articles';
import { emptyChannelCounts, emptyStatusCounts, queryQueue, toListItem, type PackageStore } from './store';
import {
  PACKAGE_STATUSES,
  type DashboardSummary,
  type PackageListItem,
  type PackageSummary,
  type QueueResult,
  type ReceiptRow,
  type SocialPackageRecord,
} from './types';

// Handlers PUROS do Social Dashboard: recebem dependências e entrada, devolvem {status, body}. Sem I/O próprio,
// sem Next e sem relógio global: o Studio (apps/web/app/api) só adapta Request/Response a estas funções.

export interface DashboardDeps {
  store: PackageStore;
  articles: ArticleSource;
  publisher: SocialPublisher;
  flags: GrowthFlags;
  now: () => string;
  /** Métricas do canal (mLabs, só leitura). Opcional: sem fonte, o painel mostra "indisponível". */
  metrics?: SocialMetricsSource;
}

export interface HandlerResult<T> {
  status: number;
  body: T | ApiError;
}

export interface Caller {
  id: string;
  /** Permissões do usuário do Studio (a autorização real vem de @ln/auth; aqui só se confere). */
  permissions: readonly string[];
}

export const PERMISSIONS = {
  read: 'social:read',
  generate: 'social:generate',
  requestPublish: 'social:request_publish',
} as const;

const ok = <T>(body: T, status = 200): HandlerResult<T> => ({ status, body });
const fail = (status: number, code: string, message: string, details?: unknown): HandlerResult<never> => ({
  status,
  body: apiError(code, message, details),
});

function can(caller: Caller, perm: string): boolean {
  return caller.permissions.includes(perm);
}

/** Bloqueios que só impedem a publicação REAL (a simulação não envia nada ao mLabs). */
export function isRealOnlyBlocker(b: string): boolean {
  return b === 'mock_nao_publicavel' || b.startsWith('brandkit_');
}

const QueueQuerySchema = z.object({
  channel: z.enum(['linkedin', 'instagram', 'the_loyal']).optional(),
  status: z.enum(PACKAGE_STATUSES).optional(),
  blocker: z.string().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().regex(/^\d{1,6}$/).optional(),
});
const GenerateSchema = z.object({
  articleId: z.string().min(1).max(128),
  channels: z.array(z.enum(['linkedin', 'instagram', 'the_loyal'])).min(1).max(3).optional(),
  version: z.number().int().min(1).max(999).optional(),
});
const PackageIdSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,128}:(linkedin|instagram|the_loyal):v\d{1,3}$/);

export function packageId(articleId: string, channel: Channel, version: number): string {
  return `${articleId}:${channel}:v${version}`;
}

type Built = LinkedInPackage | InstagramPackage;

function buildFor(article: Article, channel: Channel, version: number, flags: GrowthFlags): Built {
  if (channel === 'linkedin') return buildLinkedInPackage(article, { version });
  if (channel === 'instagram') return buildInstagramPackage(article, flags);
  throw new CreativeRefusal('canal_nao_construido', 'The Loyal não tem pacote social construído');
}

function summarize(b: Built, article: Article): PackageSummary {
  const isLinkedIn = 'copy' in b;
  const creative = isLinkedIn ? b.creative : b.feed;
  const text = isLinkedIn ? b.copy.text : b.caption;
  return {
    title: article.title,
    editoria: article.editoria,
    copyText: text,
    hook: text.split('\n')[0] ?? '',
    hashtags: isLinkedIn ? b.copy.hashtags : (text.match(/#[\p{L}\p{N}_]+/gu) ?? []),
    mentions: isLinkedIn ? b.copy.mentions.map((m) => ({ name: m.name })) : [],
    plainEntities: isLinkedIn ? b.copy.plainEntities : [],
    textOnlyFallback: isLinkedIn ? b.copy.textOnlyFallback : true,
    creative: {
      format: creative.format,
      width: creative.width,
      height: creative.height,
      sha256: isLinkedIn ? b.creativeSha256 : (b.imageRef.split('/').pop() ?? ''),
      brandStatus: creative.brandStatus,
      contextKey: creative.contextKey,
      svg: creative.svg,
    },
    carouselSlides: isLinkedIn ? b.carousel.slides.length : 0,
    imageRef: b.imageRef,
  };
}

function failedRecord(
  article: Article, channel: Channel, version: number, at: string, rules: string[], detail: string,
): SocialPackageRecord {
  return {
    id: packageId(article.id, channel, version),
    articleId: article.id,
    channel,
    version,
    status: 'falhou',
    createdAt: at,
    updatedAt: at,
    blockers: rules.map((r) => `regra:${r}`),
    failure: { rules, detail },
    receipts: [],
    mock: Boolean(article.mock),
  };
}

// ---------- leitura ----------

export async function getDashboardSummary(deps: DashboardDeps, caller: Caller): Promise<HandlerResult<DashboardSummary>> {
  if (!can(caller, PERMISSIONS.read)) return fail(403, 'FORBIDDEN', 'sem permissão social:read');
  const all = await deps.store.all();
  const byStatus = emptyStatusCounts();
  const byChannel = emptyChannelCounts();
  const blockerCount = new Map<string, number>();
  for (const r of all) {
    byStatus[r.status] += 1;
    byChannel[r.channel] += 1;
    for (const b of r.blockers) blockerCount.set(b, (blockerCount.get(b) ?? 0) + 1);
  }
  const topBlockers = [...blockerCount.entries()]
    .map(([blocker, count]) => ({ blocker, count }))
    .sort((a, b) => b.count - a.count || a.blocker.localeCompare(b.blocker))
    .slice(0, 8);
  let metrics: DashboardSummary['metrics'] = { available: false, reason: 'integração de métricas não configurada; sem números fictícios' };
  if (deps.metrics) {
    try {
      metrics = { available: true, data: await deps.metrics.read() };
    } catch {
      metrics = { available: false, reason: 'leitura de métricas falhou; sem números fictícios' };
    }
  }
  const live = deps.publisher.mode === 'live';
  const mode = live ? 'real' : 'simulado';
  return ok<DashboardSummary>({
    totals: { packages: all.length, byStatus, byChannel },
    channels: [
      { channel: 'linkedin', flagEnabled: deps.flags.growth_linkedin_live, mode },
      { channel: 'instagram', flagEnabled: deps.flags.growth_instagram_enabled, mode },
      { channel: 'the_loyal', flagEnabled: deps.flags.growth_the_loyal_enabled, mode },
    ],
    topBlockers,
    brandStatus: TOKENS.status,
    metrics,
    note: live ? 'Adaptador REAL ativo.' : 'Modo simulado: nada é enviado ao mLabs.',
  });
}

export async function listQueue(deps: DashboardDeps, caller: Caller, rawQuery: unknown): Promise<HandlerResult<QueueResult>> {
  if (!can(caller, PERMISSIONS.read)) return fail(403, 'FORBIDDEN', 'sem permissão social:read');
  const q = QueueQuerySchema.safeParse(rawQuery ?? {});
  if (!q.success) return fail(400, 'VALIDATION_ERROR', 'consulta inválida', q.error.issues.map((i) => i.path.join('.')));
  return ok(queryQueue(await deps.store.all(), q.data));
}

export async function getPackage(deps: DashboardDeps, caller: Caller, id: string): Promise<HandlerResult<SocialPackageRecord>> {
  if (!can(caller, PERMISSIONS.read)) return fail(403, 'FORBIDDEN', 'sem permissão social:read');
  if (!PackageIdSchema.safeParse(id).success) return fail(400, 'VALIDATION_ERROR', 'id de pacote inválido');
  const r = await deps.store.get(id);
  return r ? ok(r) : fail(404, 'PACKAGE_NOT_FOUND', 'pacote não encontrado');
}

export async function listReceipts(
  deps: DashboardDeps, caller: Caller,
): Promise<HandlerResult<{ items: ReceiptRow[]; simulatedOnly: boolean }>> {
  if (!can(caller, PERMISSIONS.read)) return fail(403, 'FORBIDDEN', 'sem permissão social:read');
  const all = await deps.store.all();
  const items: ReceiptRow[] = all.flatMap((r) =>
    r.receipts.map((receipt) => ({ packageId: r.id, articleId: r.articleId, channel: r.channel, receipt })),
  );
  items.sort((a, b) => (a.receipt.createdAt < b.receipt.createdAt ? 1 : -1));
  return ok({ items, simulatedOnly: items.every((i) => i.receipt.simulated) });
}

export async function listAudit(
  deps: DashboardDeps, caller: Caller, limit = 50,
): Promise<HandlerResult<{ items: SocialPublisher['audit'] }>> {
  if (!can(caller, PERMISSIONS.read)) return fail(403, 'FORBIDDEN', 'sem permissão social:read');
  const n = Math.min(Math.max(Math.trunc(limit), 1), 200);
  return ok({ items: deps.publisher.audit.slice(-n).reverse() });
}

// ---------- geração ----------

export interface GenerateResult {
  created: string[];
  existing: string[];
  failed: string[];
  items: PackageListItem[];
}

/** Gera (de forma idempotente) os pacotes de uma matéria. Falha de regra vira registro `falhou`, nunca silêncio. */
export async function generatePackages(
  deps: DashboardDeps, caller: Caller, rawBody: unknown,
): Promise<HandlerResult<GenerateResult>> {
  if (!can(caller, PERMISSIONS.generate)) return fail(403, 'FORBIDDEN', 'sem permissão social:generate');
  const parsed = GenerateSchema.safeParse(rawBody);
  if (!parsed.success) return fail(400, 'VALIDATION_ERROR', 'corpo inválido', parsed.error.issues.map((i) => i.path.join('.')));
  const { articleId, version = 1 } = parsed.data;
  const channels = [...new Set(parsed.data.channels ?? ['linkedin'])] as Channel[];
  if (channels.includes('the_loyal')) {
    return fail(422, 'CHANNEL_NOT_SUPPORTED', 'The Loyal não tem pacote social construído');
  }
  const article = await deps.articles.get(articleId);
  if (!article) return fail(404, 'ARTICLE_NOT_FOUND', 'matéria não encontrada');

  const result: GenerateResult = { created: [], existing: [], failed: [], items: [] };
  for (const channel of channels) {
    const id = packageId(articleId, channel, version);
    const prior = await deps.store.get(id);
    if (prior) {
      result.existing.push(id);
      result.items.push(toListItem(prior));
      continue;
    }
    const at = deps.now();
    let record: SocialPackageRecord;
    try {
      const built = buildFor(article, channel, version, deps.flags);
      record = {
        id,
        articleId,
        channel,
        version,
        status: built.blockers.length === 0 ? 'gerado' : 'bloqueado',
        createdAt: at,
        updatedAt: at,
        blockers: built.blockers,
        summary: summarize(built, article),
        receipts: [],
        mock: Boolean(article.mock),
      };
      result.created.push(id);
    } catch (e) {
      if (e instanceof CopyRefusal) {
        record = failedRecord(article, channel, version, at, e.violations.map((v) => v.rule), e.message);
      } else if (e instanceof CreativeRefusal) {
        record = failedRecord(article, channel, version, at, [e.rule], e.message);
      } else {
        throw e;
      }
      result.failed.push(id);
    }
    await deps.store.put(record);
    result.items.push(toListItem(record));
  }
  return ok(result, result.created.length + result.failed.length > 0 ? 201 : 200);
}

// ---------- pedido de publicação SIMULADA ----------

export interface SimulatedPublishResult {
  record: SocialPackageRecord;
  receipt: PublishReceipt;
}

/**
 * Pede ao serviço de publicação uma publicação SIMULADA do pacote. Só funciona com adaptador `simulated`; com o
 * adaptador real o dashboard recusa (publicação real é do serviço, depois de R5-02). Regera o pacote da matéria atual
 * e confere o hash do criativo: se a matéria mudou desde a geração, o pacote está obsoleto (409).
 */
export async function requestSimulatedPublish(
  deps: DashboardDeps, caller: Caller, id: string,
): Promise<HandlerResult<SimulatedPublishResult>> {
  if (!can(caller, PERMISSIONS.requestPublish)) return fail(403, 'FORBIDDEN', 'sem permissão social:request_publish');
  if (!PackageIdSchema.safeParse(id).success) return fail(400, 'VALIDATION_ERROR', 'id de pacote inválido');
  if (deps.publisher.mode !== 'simulated') {
    return fail(409, 'LIVE_ADAPTER_NOT_ALLOWED', 'este dashboard só pede publicação simulada');
  }
  const record = await deps.store.get(id);
  if (!record) return fail(404, 'PACKAGE_NOT_FOUND', 'pacote não encontrado');
  if (record.status === 'falhou' || !record.summary) {
    return fail(409, 'PACKAGE_FAILED', 'pacote com falha de geração não pode ser publicado', record.blockers);
  }
  // `canal_desligado:*` não barra aqui: a tentativa segue ao publisher, que recusa e REGISTRA (ADR-008).
  const hard = record.blockers.filter((b) => !isRealOnlyBlocker(b) && !b.startsWith('canal_desligado:'));
  if (hard.length) return fail(409, 'PACKAGE_BLOCKED', 'pacote com bloqueios', hard);

  const article = await deps.articles.get(record.articleId);
  if (!article) return fail(404, 'ARTICLE_NOT_FOUND', 'matéria não encontrada');
  let built: Built;
  try {
    built = buildFor(article, record.channel, record.version, deps.flags);
  } catch (e) {
    if (e instanceof CopyRefusal || e instanceof CreativeRefusal) {
      return fail(409, 'PACKAGE_STALE', 'a matéria mudou e o pacote não passa mais nas regras');
    }
    throw e;
  }
  if (built.imageRef !== record.summary.imageRef) {
    return fail(409, 'PACKAGE_STALE', 'a matéria mudou desde a geração; gere o pacote de novo');
  }

  try {
    const receipt = await deps.publisher.publish(PUBLISHER_SOCIAL, built.publishRequest);
    const updated: SocialPackageRecord = {
      ...record,
      status: 'simulado',
      updatedAt: deps.now(),
      receipts: record.receipts.some((r) => r.id === receipt.id) ? record.receipts : [...record.receipts, receipt],
      lastRefusal: undefined,
    };
    await deps.store.put(updated);
    return ok({ record: updated, receipt });
  } catch (e) {
    if (e instanceof PublishRefused) {
      const updated: SocialPackageRecord = { ...record, status: 'recusado', updatedAt: deps.now(), lastRefusal: e.reason };
      await deps.store.put(updated);
      const off = e.reason.startsWith('canal_desligado');
      return fail(off ? 403 : 409, off ? 'CHANNEL_DISABLED' : 'PUBLISH_REFUSED', `publicação recusada: ${e.reason}`, e.reason);
    }
    throw e;
  }
}
