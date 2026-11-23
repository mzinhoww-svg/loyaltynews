// Porta PublishedArticleLookup (ADR-019 §c) sobre `articles`: o caso de correção/resposta ancora em `articles.id` JÁ PUBLICADO.
//  - get(id): a linha de `articles` (qualquer status; o handler só aceita publicado/corrigido/despublicado e dá 404 igual para o resto);
//    `origem` = 'fabrica' quando existe `editorial_article` com o mesmo id (ADR-017), senão 'cms';
//  - evidences(id): as ligadas em `article_sources` (matéria do CMS) MAIS as que o caso aponta em `supportingEvidenceIds`.
//    O banco de evidências do CMS guarda URL e hash, não o texto: o texto fica vazio e, portanto, citação literal e número
//    NÃO são verificáveis para matéria do CMS (a errata com esse tipo de claim fica bloqueada: falha fechada, nunca presumida).
import { eq, inArray } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import type { Evidence, PublishedArticleLookup } from '@ln/editorial';

type EvidenceRow = typeof schema.evidences.$inferSelect;
const toEvidence = (e: EvidenceRow): Evidence => ({
  id: e.id, sourceId: e.sourceId, url: e.url, canonicalUrl: e.url, fetchedAt: e.capturadoEm.toISOString(), contentSha256: e.sha256,
  title: '', text: '', publishedAt: null, suspicious: false, suspiciousReasons: [],
});

export function articlesPublishedLookup(db: Db, extraEvidenceIds: () => Promise<readonly string[]> = async () => []): PublishedArticleLookup {
  return {
    async get(id) {
      const [a] = await db
        .select({ id: schema.articles.id, slug: schema.articles.slug, titulo: schema.articles.titulo, status: schema.articles.status, versao: schema.articles.versao, publicadoEm: schema.articles.publicadoEm })
        .from(schema.articles)
        .where(eq(schema.articles.id, id));
      if (!a) return undefined;
      const [fab] = await db.select({ id: schema.editorialArticle.articleId }).from(schema.editorialArticle).where(eq(schema.editorialArticle.articleId, id));
      return { id: a.id, slug: a.slug, titulo: a.titulo, status: a.status, versao: a.versao, publicadoEm: a.publicadoEm ? a.publicadoEm.toISOString() : null, origem: fab ? 'fabrica' : 'cms' };
    },
    async evidences(id) {
      const linked = await db
        .select({ e: schema.evidences })
        .from(schema.articleSources)
        .innerJoin(schema.evidences, eq(schema.articleSources.evidenceId, schema.evidences.id))
        .where(eq(schema.articleSources.articleId, id));
      const extraIds = [...new Set(await extraEvidenceIds())].filter((x) => !linked.some((l) => l.e.id === x));
      const extra = extraIds.length ? await db.select().from(schema.evidences).where(inArray(schema.evidences.id, extraIds)) : [];
      return [...linked.map((l) => l.e), ...extra].map(toEvidence);
    },
  };
}
