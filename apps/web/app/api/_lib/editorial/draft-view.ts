// Leitura do rascunho editorial COMPLETO de uma matéria da Fábrica para o formulário de correção do Studio (ADR-019 §c.5):
// o que applyCorrection precisa (id do rascunho, classe de dado, provedor/versão do prompt, claims, imagem) e a última checagem.
// Campos listados UM A UM (nada de espalhar o registro): sem texto bruto de evidência, sem prompt, sem segredo, sem contato de
// requerente. Campos ausentes são OMITIDOS (o corpo devolvido é aceito como está em `correcao.draft`). O corpo vem SEM o bloco "Avisos:" (o sistema o compõe na correção); `avisos` traz o que já foi publicado.
import { and, eq } from 'drizzle-orm';
import { apiError } from '@ln/contracts';
import { schema } from '@ln/db';
import { ACTION_ROLES, composeBody, fontesPart, type ApiResponse, type HandlerCtx } from '@ln/editorial';
import type { Db } from '@ln/auth';

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const mainOf = (body: string): string => body.split(/\n\n(?:Avisos|Fontes):\n/)[0]!;

export async function getArticleDraft(ctx: HandlerCtx & { db: Db }, input: unknown): Promise<ApiResponse<unknown>> {
  const a = ctx.actor;
  if (!a) return { status: 401, body: apiError('UNAUTHENTICATED', 'sessão ausente') };
  if (!a.mfa) return { status: 401, body: apiError('MFA_REQUIRED', 'MFA obrigatório') };
  if (!a.roles.some((r) => ACTION_ROLES['article.read'].includes(r))) return { status: 403, body: apiError('FORBIDDEN', 'papel sem permissão para article.read') };
  const articleId = (input as { articleId?: unknown } | null)?.articleId;
  if (typeof articleId !== 'string' || !ID.test(articleId)) return { status: 400, body: apiError('INVALID_INPUT', 'articleId inválido') };
  const r = await ctx.store.getArticle(articleId);
  if (!r?.draft) return { status: 404, body: apiError('NOT_FOUND', 'matéria não encontrada') };
  const d = r.draft;
  const [art] = await ctx.db
    .select({ versao: schema.articles.versao, status: schema.articles.status })
    .from(schema.articles)
    .where(and(eq(schema.articles.id, articleId)));
  const fc = r.factcheck;
  return {
    status: 200,
    body: {
      articleId: r.articleId,
      status: r.status,
      /** versão em `articles` (a do recibo vigente); a correção gera a seguinte */
      versaoPublicada: art?.versao ?? null,
      podeCorrigir: art?.status === 'publicado' || art?.status === 'corrigido',
      publicacao: r.publication
        ? { url: r.publication.url, publicadoEm: r.publication.publishedAt, corrigidoEm: r.publication.correctedAt ?? null, contentSha256: r.publication.contentSha256 }
        : null,
      avisos: (r.notices ?? []).map((n) => ({ caseId: n.caseId, tipo: n.kind, em: n.at, texto: n.text })),
      rascunho: {
        id: d.id,
        editoria: d.editoria,
        slug: d.slug,
        headline: d.headline,
        ...(d.subtitulo ? { subtitulo: d.subtitulo } : {}),
        resumo: d.resumo,
        tipoConteudo: d.tipoConteudo,
        classeDeDado: d.classeDeDado,
        patrocinado: d.patrocinado,
        ...(d.rotuloPublieditorial ? { rotuloPublieditorial: d.rotuloPublieditorial } : {}),
        /** texto + bloco Fontes, SEM "Avisos:" — é o que se reenvia em `correcao.draft.body` */
        body: composeBody(mainOf(d.body), [], fontesPart(d.body)),
        claims: d.claims.map((c) => ({ id: c.id, kind: c.kind, text: c.text, evidenceIds: [...c.evidenceIds], ...(c.quote ? { quote: { text: c.quote.text, speaker: c.quote.speaker } } : {}) })),
        evidenceIds: [...d.evidenceIds],
        signature: d.signature,
        image: d.image.mode === 'conceptual'
          ? {
              mode: 'conceptual' as const, url: d.image.url, alt: d.image.alt, generatedBy: d.image.generatedBy, promptVersion: d.image.promptVersion, promptSha256: d.image.promptSha256,
              ...(d.image.humanReview ? { humanReview: { reviewedBy: d.image.humanReview.reviewedBy, at: d.image.humanReview.at, limitsConfirmed: d.image.humanReview.limitsConfirmed } } : {}),
            }
          : d.image.mode === 'source_image'
            ? {
                mode: 'source_image' as const, sourceId: d.image.sourceId, url: d.image.url, credit: d.image.credit, creditLink: d.image.creditLink,
                basis: d.image.basis ? { kind: d.image.basis.kind, reference: d.image.basis.reference, registeredAt: d.image.basis.registeredAt, validatedBy: d.image.basis.validatedBy } : null,
                ...(d.image.alt ? { alt: d.image.alt } : {}),
              }
            : { mode: 'none' as const, reason: d.image.reason },
        modelProvider: d.modelProvider,
        promptVersion: d.promptVersion,
      },
      /** última checagem registrada (provedor distinto do redator é exigido pela correção) */
      checagem: fc ? { provider: fc.provider, model: fc.model, verdicts: fc.verdicts.map((v) => ({ claimId: v.claimId, verdict: v.verdict })) } : null,
    },
  };
}
