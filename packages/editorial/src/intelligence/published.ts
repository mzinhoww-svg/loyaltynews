import { publishedContentSha256 } from '@ln/contracts/hash';
import type { PublishableContent } from '@ln/contracts';
import type { Draft } from '../types';
import { mainBody } from '../rules/rules';
import type { ArticleRecord } from '../api/store';
import type { PublishedArticle } from './types';

/**
 * Conteúdo publicável do RASCUNHO editorial aprovado, na forma que `@ln/contracts` canoniza (ADR-017, decisão 3).
 * É a ÚNICA derivação Draft → PublishableContent: o Backend deve usá-la (não reimplementar) ao emitir o recibo.
 * O Draft editorial é sempre notícia pública e não patrocinada (conteúdo pago é do módulo Comercial), sem subtítulo/resumo.
 */
export function toPublishableContent(d: Draft): PublishableContent {
  return {
    titulo: d.headline, subtitulo: null, resumo: null, tipoConteudo: 'noticia', editoria: d.editoria, corpo: d.body,
    imagem: d.image, classeDeDado: 'public', patrocinado: false, rotuloPublieditorial: null, fontes: d.evidenceIds,
  };
}

/**
 * Hash do recibo (`publishedContentSha256`, versão ln-published-content/1) sobre o rascunho aprovado: cobre título, editoria,
 * corpo com "Fontes:", imagem com base de direito, classe, patrocínio e fontes. Mudar QUALQUER um depois da aprovação invalida o recibo.
 * O mesmo valor vai ao recibo, à chave de outbox `article.published:{id}:{sha}` e a `publication.contentSha256`.
 */
export const draftContentSha256 = (d: Draft): string => publishedContentSha256(toPublishableContent(d));

export const PORTAL_SOURCE_NAME = 'Loyalty News';

export type PublishedResult =
  | { ok: true; article: PublishedArticle }
  | { ok: false; reason: 'not_published' | 'no_publication_record' | 'no_draft' | 'content_mismatch' };

/**
 * Monta o `PublishedArticle` do consumidor do Intelligence a partir do registro JÁ PUBLICADO.
 * Rascunho ou matéria só aprovada nunca vira PublishedArticle; o hash precisa bater com o corpo armazenado
 * (se o texto mudou depois da publicação, a emissão é recusada até nova publicação com recibo).
 */
export function toPublishedArticle(rec: ArticleRecord, opts: { sourceName?: string; withText?: boolean } = {}): PublishedResult {
  if (rec.status !== 'publicado' && rec.status !== 'corrigido') return { ok: false, reason: 'not_published' };
  if (!rec.publication) return { ok: false, reason: 'no_publication_record' };
  if (!rec.draft) return { ok: false, reason: 'no_draft' };
  if (draftContentSha256(rec.draft) !== rec.publication.contentSha256) return { ok: false, reason: 'content_mismatch' };
  return {
    ok: true,
    article: {
      id: rec.articleId, status: 'published', url: rec.publication.url, sourceName: opts.sourceName ?? PORTAL_SOURCE_NAME,
      fetchedAt: rec.publication.publishedAt, publishedAt: rec.publication.publishedAt, contentSha256: rec.publication.contentSha256,
      // Texto e título só quando pedidos (podem conter nomes de pessoas): o estágio `roles` decide o que sai conforme a flag.
      ...(opts.withText ? { headline: rec.draft.headline, text: mainBody(rec.draft.body) } : {}), ...(rec.publication.isMock ? { isMock: true } : {}),
    },
  };
}

/**
 * Reconstrói o job do estágio `roles` a partir do registro PUBLICADO (o worker do Backend lê a matéria do banco por
 * `refId`). `approved` só é verdadeiro para matéria publicada/corrigida: rascunho ou aprovada-sem-publicar não passa.
 */
export function jobFromRecord(rec: ArticleRecord): import('../pipeline/jobs').ArticleJob {
  return {
    articleId: rec.articleId, editoria: rec.editoria, evidences: rec.evidences, attempt: 0,
    ...(rec.draft ? { draft: rec.draft } : {}), ...(rec.factcheck ? { factcheck: rec.factcheck } : {}),
    approved: (rec.status === 'publicado' || rec.status === 'corrigido') && !!rec.publication,
  };
}
