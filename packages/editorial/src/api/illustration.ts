import { z } from 'zod';
import { apiError } from '@ln/contracts';
import { audit, authorize, bad, fail, isErr, ok, parse } from './common';
import type { ApiResponse, HandlerCtx } from './common';

/** Ilustração conceitual gerada (ADR-018): revisão humana dos limites de uso. */
const IllustrationIn = z.object({ articleId: z.string().min(1).max(128), note: z.string().trim().min(10).max(2000) });

/**
 * Registra que um humano conferiu os limites de uso da ilustração gerada: nenhuma pessoa real reconhecível, logotipo/marca/
 * produto/cartão real, cena documental ou imagem de terceiro como referência. Sem isso o gate bloqueia a aprovação. Não muda o
 * hash do recibo (revisão é registro interno). Matéria já publicada não é alterada por aqui (use o fluxo de correção).
 */
export async function confirmIllustrationLimits(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ articleId: string; reviewedBy: string }>> {
  const a = authorize(ctx, 'article.review'); if (isErr(a)) return fail(a);
  const p = parse(IllustrationIn, input); if (bad(p)) return fail(p);
  const r = await ctx.store.getArticle(p.data.articleId);
  if (!r?.draft) return fail(apiError('NOT_FOUND', 'matéria ou rascunho não encontrado'));
  if (r.status === 'publicado' || r.status === 'despublicado' || r.status === 'corrigido') return fail(apiError('CONFLICT', `matéria ${r.status}: use o fluxo de correção`));
  const img = r.draft.image;
  if (img.mode !== 'conceptual') return fail(apiError('CONFLICT', 'a matéria não usa ilustração conceitual'));
  const at = ctx.now().toISOString();
  await ctx.store.putArticle({ ...r, updatedAt: at, draft: { ...r.draft, image: { ...img, humanReview: { reviewedBy: a.userId, at, limitsConfirmed: true } } } });
  await audit(ctx, a.userId, 'illustration.limits_confirmed', r.articleId, p.data.note);
  return ok({ articleId: r.articleId, reviewedBy: a.userId });
}
