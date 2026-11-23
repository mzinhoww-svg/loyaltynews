// Registro da publicação editorial (applyPublication → PgEditorialStore.commitPublication) como rota do Studio.
// POST /api/studio/editorial/articles/:articleId/publication  { receiptId, url }
// - atrás da flag `publicacaoAutonoma` (desligada por padrão): com ela desligada nada é lido nem gravado;
// - sessão + MFA (dispatcher) e papel com `materias:publish` (admin, editor-chefe);
// - o recibo precisa existir em publication_receipts para ESTA matéria e a identidade de publicação do recibo
//   precisa ser a de quem chama (ADR-008);
// - a data da publicação é a do servidor; `isMock`, `publishedAt` e qualquer campo extra são RECUSADOS (sem mock em produção);
// - idempotente pela chave do outbox do produtor (`article.published:{id}:{sha}`): repetir devolve 200, sem novos efeitos;
// - a gravação é UMA transação (matéria publicada + auditoria + outbox) ou nada.
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { apiError } from '@ln/contracts';
import type { FlagState } from '@ln/contracts';
import { schema } from '@ln/db';
import { applyPublication, type ApiResponse, type HandlerCtx } from '@ln/editorial';
import type { Db } from '@ln/auth';
import { HttpUrl } from '../schemas';

export type PublicationCtx = HandlerCtx & { flags: FlagState; db: Db };

const Input = z.strictObject({
  articleId: z.string().min(1).max(128),
  receiptId: z.string().trim().min(1).max(128),
  url: HttpUrl,
});

const err = (status: number, code: string, message: string, details?: unknown): ApiResponse<never> => ({ status, body: apiError(code, message, details) });

export async function registerPublication(ctx: PublicationCtx, input: unknown): Promise<ApiResponse<unknown>> {
  if (!ctx.flags.publicacaoAutonoma) {
    return err(403, 'FEATURE_DISABLED', 'Registro de publicação desligado (flag publicacaoAutonoma; só após os gates de R6).');
  }
  const actor = ctx.actor;
  if (!actor) return err(401, 'UNAUTHENTICATED', 'Autenticação obrigatória.');
  const p = Input.safeParse(input);
  if (!p.success) return err(400, 'VALIDATION_ERROR', 'Entrada inválida.', p.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const { articleId, receiptId, url } = p.data;

  const [receipt] = await ctx.db
    .select({ identidade: schema.publicationReceipts.identidadePublicacao })
    .from(schema.publicationReceipts)
    .where(and(eq(schema.publicationReceipts.id, receiptId), eq(schema.publicationReceipts.articleId, articleId)));
  if (!receipt) return err(409, 'RECEIPT_NOT_FOUND', 'Recibo inexistente para esta matéria.');
  if (receipt.identidade !== actor.userId) return err(403, 'NOT_PUBLISHER_IDENTITY', 'Só a identidade de publicação do recibo registra esta publicação.');

  const r = await applyPublication(ctx.store, { articleId, receiptId, url, publishedAt: ctx.now().toISOString() });
  if (!r.ok) {
    const status = { not_found: 404, invalid_input: 400, not_approved: 409, gate_failed: 409, no_draft: 409 }[r.code];
    return err(status, r.code.toUpperCase(), r.message, r.findings);
  }
  return {
    status: r.alreadyPublished ? 200 : 201,
    body: {
      articleId: r.record.articleId,
      status: r.record.status,
      publication: r.record.publication ?? null,
      outbox: r.outbox,
      alreadyPublished: r.alreadyPublished,
    },
  };
}
