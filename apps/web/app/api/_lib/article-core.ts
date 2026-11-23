// Núcleo compartilhado das matérias do CMS: regras determinísticas, ids de evidência e hash do conteúdo (ADR-017: função ÚNICA
// `publishedContentSha256`). Fica à parte para o fluxo de correção (correcao.ts) e a publicação oficial usarem as MESMAS regras.
import { and, eq } from 'drizzle-orm';
import { ASSINATURA, isImagePublishable, ImageRights } from '@ln/contracts';
import { publishedContentSha256 } from '@ln/contracts/hash';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';

export type ArticleRow = typeof schema.articles.$inferSelect;

/** Campos que formam o conteúdo publicado (e o hash). */
export type ContentFields = Pick<
  ArticleRow,
  'titulo' | 'subtitulo' | 'resumo' | 'tipoConteudo' | 'editoria' | 'corpo' | 'imagem' | 'classeDeDado' | 'patrocinado' | 'rotuloPublieditorial'
> & { assinatura?: string };

export async function evidenceIdsOf(db: Db, articleId: string): Promise<string[]> {
  const rows = await db.select({ id: schema.articleSources.evidenceId }).from(schema.articleSources).where(eq(schema.articleSources.articleId, articleId));
  return rows.map((r) => r.id).sort();
}

/** Regras determinísticas (sem modelo): o que impede aprovar ou publicar. Vazio = passou. */
export function gateFailures(a: ContentFields & { assinatura: string }, evidenceCount: number): string[] {
  const f: string[] = [];
  if (evidenceCount < 1) f.push('fontes: ao menos uma evidência');
  if (a.assinatura !== ASSINATURA) f.push('assinatura institucional');
  if (!a.resumo) f.push('resumo obrigatório (até 300 caracteres)');
  if (a.patrocinado && !a.rotuloPublieditorial) f.push('conteúdo pago sem rótulo');
  if (a.classeDeDado !== 'public') f.push(`classe de dado ${a.classeDeDado} não é publicável`);
  if (a.imagem != null) {
    const img = ImageRights.safeParse(a.imagem);
    if (!img.success) f.push('imagem inválida');
    else if (!isImagePublishable(img.data)) f.push('imagem sem base de direito');
  }
  return f;
}

/** Hash do conteúdo de uma linha de `articles` (ou de uma versão revista dela) com as evidências citadas. */
export function rowContentSha(a: ContentFields, evidenceIds: readonly string[]): string {
  return publishedContentSha256({
    titulo: a.titulo, subtitulo: a.subtitulo, resumo: a.resumo, tipoConteudo: a.tipoConteudo, editoria: a.editoria, corpo: a.corpo,
    imagem: a.imagem, classeDeDado: a.classeDeDado, patrocinado: a.patrocinado, rotuloPublieditorial: a.rotuloPublieditorial, fontes: evidenceIds,
  });
}

/** Recibo de uma versão da matéria (único por matéria e versão). */
export async function receiptOfVersion(db: Db, articleId: string, versao: number) {
  const [r] = await db
    .select()
    .from(schema.publicationReceipts)
    .where(and(eq(schema.publicationReceipts.articleId, articleId), eq(schema.publicationReceipts.versao, versao)));
  return r ?? null;
}
