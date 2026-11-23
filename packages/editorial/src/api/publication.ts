import { canTransition } from '@ln/contracts';
import { isSimulatedContent, runDeterministicChecks } from '../rules/rules';
import { draftContentSha256 } from '../intelligence/published';
import type { ArticleRecord, EditorialStore, OutboxItem } from './store';

/**
 * Registro da publicação (WF03 → editorial). A publicação em si é do Backend (identidade de publicação, com recibo);
 * esta função apenas REGISTRA o estado `publicado` e agenda, via outbox, a ligação com o Intelligence — e só se a
 * matéria continua aprovada: o gate é refeito aqui e uma aprovação vencida/adulterada recusa o registro.
 *
 * ATOMICIDADE: matéria publicada + recibo + auditoria + outbox são gravados por UMA operação da porta
 * (`EditorialStore.commitPublication`, uma transação no PostgreSQL). Falha em qualquer ponto ⇒ nada fica gravado e a
 * chamada pode ser repetida com segurança; repetição após sucesso devolve 'duplicate' sem efeitos.
 */

export type { OutboxItem } from './store';
export const INTELLIGENCE_QUEUE = 'intelligence-ingest';

export interface PublicationInput {
  /** Id único da matéria (ADR-017): o mesmo de `articles.id`; nasce na criação do rascunho e nunca muda. */
  articleId: string; receiptId: string; url: string; publishedAt: string; isMock?: boolean;
  /**
   * `PublicationReceipt.conteudoSha256` (publishedContentSha256 do rascunho APROVADO). Se informado e diferente do hash do
   * rascunho atual (manchete, imagem, corpo, fontes... mudaram depois da aprovação), a publicação é recusada ('receipt_stale').
   */
  expectedContentSha256?: string;
}
export type PublicationCode = 'not_found' | 'invalid_input' | 'not_approved' | 'gate_failed' | 'no_draft' | 'receipt_stale' | 'slug_immutable' | 'slug_taken' | 'simulated_content';
export type PublicationResult =
  | { ok: true; record: ArticleRecord; outbox: 'enqueued' | 'duplicate'; alreadyPublished: boolean }
  | { ok: false; code: PublicationCode; message: string; findings?: Array<{ code: string; message: string }> };

const outboxKey = (articleId: string, contentSha256: string) => `article.published:${articleId}:${contentSha256}`;

export async function applyPublication(store: EditorialStore, input: PublicationInput): Promise<PublicationResult> {
  if (!input.receiptId.trim() || !/^https?:\/\/\S+$/i.test(input.url) || Number.isNaN(Date.parse(input.publishedAt))) {
    return { ok: false, code: 'invalid_input', message: 'recibo, URL pública (http/https) e data de publicação são obrigatórios' };
  }
  const rec = await store.getArticle(input.articleId);
  if (!rec) return { ok: false, code: 'not_found', message: 'matéria não encontrada' };
  if (!rec.draft) return { ok: false, code: 'no_draft', message: 'matéria sem rascunho' };
  if (isSimulatedContent(rec.draft)) return { ok: false, code: 'simulated_content', message: 'conteúdo SIMULADO (ensaio com modelo simulado) nunca é publicado' };
  if (input.expectedContentSha256 && input.expectedContentSha256 !== draftContentSha256(rec.draft)) {
    return { ok: false, code: 'receipt_stale', message: 'o conteúdo do rascunho mudou depois do recibo: o hash do recibo não corresponde mais' };
  }
  // Slug: imutável depois da 1ª publicação (URL estável) e único entre as matérias (a unicidade definitiva é do banco).
  if (rec.publication?.slug && rec.publication.slug !== rec.draft.slug) {
    return { ok: false, code: 'slug_immutable', message: `slug já publicado como "${rec.publication.slug}": não pode mudar` };
  }
  if ((await store.listArticles()).some((a) => a.articleId !== rec.articleId && a.publication && a.draft?.slug === rec.draft!.slug)) {
    return { ok: false, code: 'slug_taken', message: `slug "${rec.draft.slug}" já pertence a outra matéria publicada` };
  }
  const item = (r: ArticleRecord): OutboxItem => ({ queue: INTELLIGENCE_QUEUE, refId: r.articleId, idempotencyKey: outboxKey(r.articleId, r.publication!.contentSha256) });
  const auditOf = (r: ArticleRecord) => ({ at: input.publishedAt, userId: null, action: 'article.published', target: r.articleId, detail: `recibo ${input.receiptId}` });

  // Repetição da MESMA publicação (recibo + URL): refaz o commit atômico, que é idempotente pela chave da outbox.
  // Se uma versão anterior deixou a publicação sem auditoria/outbox, este commit completa os dois de uma vez.
  if (rec.status === 'publicado' && rec.publication?.receiptId === input.receiptId && rec.publication.url === input.url) {
    const r = await store.commitPublication({ article: rec, audit: auditOf(rec), outbox: item(rec) });
    return { ok: true, record: (await store.getArticle(rec.articleId)) ?? rec, outbox: r.outbox, alreadyPublished: true };
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
    publication: { receiptId: input.receiptId, url: input.url, publishedAt: input.publishedAt, contentSha256: draftContentSha256(rec.draft), slug: rec.draft.slug, ...(input.isMock ? { isMock: true } : {}) },
  };
  const r = await store.commitPublication({ article: next, audit: auditOf(next), outbox: item(next) });
  return { ok: true, record: (await store.getArticle(next.articleId)) ?? next, outbox: r.outbox, alreadyPublished: r.outbox === 'duplicate' };
}
