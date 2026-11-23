// Rastro de QUEM publicou (ADR-017 §5): `publicadoPor` = usuário da sessão que registrou a publicação; `aprovador` = quem emitiu o recibo.
// Vai à auditoria do Backend, ao outbox (`meta`), à auditoria do CMS editorial (matéria da Fábrica) e, no histórico da matéria, ao
// `actorId` da transição (o recibo da transição liga ao aprovador). Só ids de usuário; nada de conteúdo.
import { and, eq, isNull } from 'drizzle-orm';
import { audit } from '@ln/auth';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import type { EditorialStore } from '@ln/editorial';

export interface PublisherTrail {
  publicadoPor: string;
  role: string | undefined;
  aprovador: string;
  receiptId: string;
  articleId: string;
  /** `materia.publicada` ou `materia.corrigida` */
  action: string;
  sha: string;
  outboxKey: string;
  at: Date;
  extra?: Record<string, unknown>;
  /** CMS editorial (só matéria da Fábrica): também grava a auditoria dele */
  store?: EditorialStore;
}

export async function recordPublisher(db: Db, t: PublisherTrail): Promise<void> {
  await audit(db, {
    actorId: t.publicadoPor, actorRole: t.role, action: t.action, resource: 'materias', resourceId: t.articleId,
    detalhe: { receiptId: t.receiptId, contentSha256: t.sha, publicadoPor: t.publicadoPor, aprovador: t.aprovador, ...(t.extra ?? {}) }, at: t.at,
  });
  await db
    .update(schema.outbox)
    .set({ meta: { publicadoPor: t.publicadoPor, aprovador: t.aprovador, receiptId: t.receiptId } })
    .where(and(eq(schema.outbox.idempotencyKey, t.outboxKey), isNull(schema.outbox.meta)));
  if (t.store) {
    await t.store.appendAudit({
      at: t.at.toISOString(), userId: t.publicadoPor, action: 'article.publisher', target: t.articleId,
      detail: `publicadoPor ${t.publicadoPor}; aprovador ${t.aprovador}; recibo ${t.receiptId}`,
    });
  }
}
