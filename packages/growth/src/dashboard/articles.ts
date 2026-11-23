import { EDITORIAS, isImagePublishable, type Article as ContractArticle } from '@ln/contracts';
import type { Article, Entity, Fact } from '../types';

/** Porta de leitura de matérias (a implementação real lê o PostgreSQL/CMS). */
export interface ArticleSource {
  get(id: string): Promise<Article | null>;
}

export interface ContractArticleExtras {
  /** URL canônica da matéria no portal. */
  url: string;
  /** Fatos aprovados pela checagem editorial (Frente 06). O contrato `Article` não traz fatos estruturados: nunca extraídos do corpo aqui. */
  facts: Fact[];
  entities?: Entity[];
  /** Matéria já passou nos gates automáticos WF02/WF03. Padrão: não. */
  gatesPassed?: boolean;
  mock?: boolean;
}

/** Projeta a matéria do contrato para a entrada do Growth. Imagem sem base de direito não vira `approvedImage`. */
export function toSocialArticle(a: ContractArticle, extras: ContractArticleExtras): Article {
  const editoria = EDITORIAS.find((e) => e.slug === a.editoria)?.nome ?? a.editoria;
  const img = a.imagem && isImagePublishable(a.imagem) ? a.imagem : undefined;
  return {
    id: a.id,
    title: a.titulo,
    // Subtítulo; sem ele, o resumo (cards/SEO). Números do deck ainda exigem fato com fonte (regra do copy).
    deck: a.subtitulo ?? a.resumo,
    editoria,
    url: extras.url,
    facts: extras.facts,
    entities: extras.entities,
    approvedImage: img ? { ref: img.url, credit: img.credito, creditUrl: img.link } : undefined,
    gatesPassed: extras.gatesPassed ?? false,
    mock: extras.mock,
    // Tipo `patrocinado` ou flag `patrocinado`: rótulo obrigatório no post; sem rótulo, a regra do copy recusa.
    sponsored: a.patrocinado || a.tipoConteudo === 'patrocinado' ? { label: a.rotuloPublieditorial ?? '' } : undefined,
  };
}
