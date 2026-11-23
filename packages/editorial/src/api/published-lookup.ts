import type { Evidence } from '../types';
import type { EditorialStore } from './store';

/**
 * Porta de consulta de matérias PUBLICADAS (ADR-019 §c). O caso de correção/resposta ancora em `articles.id` já publicado,
 * seja da Fábrica ou do CMS. O Backend implementa sobre `articles` (`origem: 'fabrica'` quando existe `editorial_article`
 * com o mesmo id); `storeBackedPublishedLookup` é a implementação de referência só para matérias da Fábrica.
 */

/** Status de uma matéria que o leitor já viu: só destas se abre caso de correção. */
export const CORRECTABLE_STATUSES = ['publicado', 'corrigido', 'despublicado'] as const;

export interface PublishedArticleRef {
  id: string;
  slug: string;
  titulo: string;
  /** Status em `articles`. Qualquer valor fora de CORRECTABLE_STATUSES (rascunho, aprovado...) é tratado como "não publicada". */
  status: string;
  versao: number;
  publicadoEm: string | null;
  origem: 'fabrica' | 'cms';
}

export interface PublishedArticleLookup {
  /** `undefined` quando o id não existe. */
  get(id: string): Promise<PublishedArticleRef | undefined>;
  /**
   * Evidências que sustentam a matéria: da Fábrica = as do registro editorial; do CMS = as ligadas em `article_sources`.
   * Opcional: sem ela, a verificação de errata usa só as evidências do registro editorial.
   */
  evidences?(id: string): Promise<Evidence[]>;
}

export const isCorrectable = (r: PublishedArticleRef | undefined): r is PublishedArticleRef =>
  !!r && (CORRECTABLE_STATUSES as readonly string[]).includes(r.status);

/** Referência: matérias da Fábrica no EditorialStore (status publicado/corrigido com recibo). `versao` fixa em 1 (o Backend lê `articles.versao`). */
export function storeBackedPublishedLookup(store: EditorialStore): PublishedArticleLookup {
  return {
    async get(id) {
      const r = await store.getArticle(id);
      if (!r) return undefined;
      return {
        id: r.articleId, slug: r.publication?.slug ?? r.draft?.slug ?? r.articleId, titulo: r.draft?.headline ?? '',
        status: r.status, versao: 1, publicadoEm: r.publication?.publishedAt ?? null, origem: 'fabrica',
      };
    },
    async evidences(id) { return (await store.getArticle(id))?.evidences ?? []; },
  };
}
