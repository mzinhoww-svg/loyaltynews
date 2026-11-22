import { canTransition } from '@ln/contracts';
import { runDeterministicChecks } from '../rules/rules';
import { articleContentSha256 } from '../intelligence/published';
import type { ArticleRecord, EditorialStore } from './store';

/**
 * Registro da publicação (WF03 → editorial). A publicação em si é do Backend (identidade de publicação, com recibo);
 * esta função apenas REGISTRA o estado `publicado` e agenda, via outbox, a ligação com o Intelligence — e só se a
 * matéria continua aprovada: o gate é refeito aqui e uma aprovação vencida/adulterada recusa o registro.
 */

/** Item de outbox por REFERÊNCIA (o worker relê a matéria do banco; alinhado a packages/db outbox: queue, refId, idempotencyKey). */
export interface OutboxItem { queue: string; refId: string; idempotencyKey: string }
export interface OutboxPort { enqueue(item: OutboxItem): Promise<'enqueued' | 'duplicate'> }

export class InMemoryOutbox implements OutboxPort {
  readonly items: OutboxItem[] = [];
  async enqueue(item: OutboxItem) {
    if (this.items.some((i) => i.idempotencyKey === item.idempotencyKey)) return 'duplicate' as const;
    this.items.push({ ...item });
    return 'enqueued' as const;
  }
}

export const INTELLIGENCE_QUEUE = 'intelligence-ingest';

export interface PublicationInput { articleId: string; receiptId: string; url: string; publishedAt: string; isMock?: boolean }
export type PublicationCode = 'not_found' | 'invalid_input' | 'not_approved' | 'gate_failed' | 'no_draft';
export type PublicationResult =
  | { ok: true; record: ArticleRecord; outbox: 'enqueued' | 'duplicate'; alreadyPublished: boolean }
  | { ok: false; code: PublicationCode; message: string; findings?: Array<{ code: string; message: string }> };

export async function applyPublication(store: EditorialStore, outbox: OutboxPort, input: PublicationInput): Promise<PublicationResult> {
  if (!input.receiptId.trim() || !/^https?:\/\/\S+$/i.test(input.url) || Number.isNaN(Date.parse(input.publishedAt))) {
    return { ok: false, code: 'invalid_input', message: 'recibo, URL pública (http/https) e data de publicação são obrigatórios' };
  }
  const rec = await store.getArticle(input.articleId);
  if (!rec) return { ok: false, code: 'not_found', message: 'matéria não encontrada' };
  if (!rec.draft) return { ok: false, code: 'no_draft', message: 'matéria sem rascunho' };
  const key = (r: ArticleRecord) => `article.published:${r.articleId}:${r.publication?.contentSha256 ?? ''}`;

  // Idempotência: mesma publicação (recibo + URL) já registrada => reemite a referência (a outbox deduplica).
  if (rec.status === 'publicado' && rec.publication?.receiptId === input.receiptId && rec.publication.url === input.url) {
    const o = await outbox.enqueue({ queue: INTELLIGENCE_QUEUE, refId: rec.articleId, idempotencyKey: key(rec) });
    return { ok: true, record: rec, outbox: o, alreadyPublished: true };
  }
  if (rec.status !== 'aprovado' || !canTransition(rec.status, 'publicado')) {
    return { ok: false, code: 'not_approved', message: `matéria em ${rec.status}: só matéria aprovada pode ser registrada como publicada` };
  }
  // O gate é refeito: rascunho adulterado depois da aprovação, checagem sem provedor distinto ou claim sem 'pass' bloqueiam.
  const chk = runDeterministicChecks(rec.draft, rec.evidences);
  const fc = rec.factcheck;
  const independent = !!fc && fc.provider !== rec.draft.modelProvider;
  const allPass = !!fc && rec.draft.claims.length > 0 && rec.draft.claims.every((c) => fc.verdicts.some((v) => v.claimId === c.id && v.verdict === 'pass'));
  if (chk.verdict !== 'pass' || !independent || !allPass) {
    return { ok: false, code: 'gate_failed', message: 'o gate editorial não passa mais para esta matéria', findings: chk.findings };
  }
  const next: ArticleRecord = {
    ...rec, status: 'publicado', updatedAt: input.publishedAt,
    publication: { receiptId: input.receiptId, url: input.url, publishedAt: input.publishedAt, contentSha256: articleContentSha256(rec.draft.body), ...(input.isMock ? { isMock: true } : {}) },
  };
  await store.putArticle(next);
  const o = await outbox.enqueue({ queue: INTELLIGENCE_QUEUE, refId: next.articleId, idempotencyKey: key(next) });
  await store.appendAudit({ at: input.publishedAt, userId: null, action: 'article.published', target: next.articleId, detail: `recibo ${input.receiptId}` });
  return { ok: true, record: next, outbox: o, alreadyPublished: false };
}
