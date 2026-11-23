/**
 * Interface ESTRUTURAL com packages/intelligence (consumidor `consumeArticle`, ft/intelligence 8bba2d9; contrato em
 * packages/intelligence/INGESTION_CONTRACT.md). Copiada de propósito: nenhum import entre os pacotes. Qualquer chave
 * fora destas listas é recusada pelo contrato `role-observation/1`.
 */

export interface PublishedArticle {
  id: string;
  status: 'published';
  /** URL pública (http/https) da matéria publicada. */
  url: string;
  sourceName: string;
  /** ISO 8601 com fuso: instante em que o conteúdo publicado foi capturado. */
  fetchedAt: string;
  publishedAt?: string | null;
  contentSha256?: string;
  headline?: string;
  /** Texto PUBLICADO (sem o bloco "Fontes:"). */
  text?: string;
  isMock?: boolean;
}

export interface RoleMention {
  personName: string;
  publicProfileUrl?: string;
  orgName: string;
  title: string;
  kind: 'present' | 'left';
  /** Só quando a própria matéria anuncia a mudança. */
  announced?: boolean;
  /** AAAA-MM-DD, só se a matéria traz a data. */
  effectiveDate?: string;
  /** Trecho LITERAL da matéria publicada que sustenta a menção (≤ 500 caracteres). */
  excerpt: string;
}

export const PUBLISHED_ARTICLE_KEYS = ['id', 'status', 'url', 'sourceName', 'fetchedAt', 'publishedAt', 'contentSha256', 'headline', 'text', 'isMock'] as const;
export const ROLE_MENTION_KEYS = ['personName', 'publicProfileUrl', 'orgName', 'title', 'kind', 'announced', 'effectiveDate', 'excerpt'] as const;

export type DropReason =
  | 'excerpt_not_literal' | 'name_not_in_excerpt' | 'org_not_in_excerpt' | 'title_not_in_excerpt'
  | 'not_in_source_evidence' | 'announcement_unsupported' | 'date_not_in_excerpt' | 'bad_shape' | 'duplicate'
  | 'profile_url_not_public' | 'profile_url_not_in_text';

export interface DroppedMention { reason: DropReason; personName?: string; orgName?: string }

/** O que o estágio `roles` entrega ao worker que chama `consumeArticle(db, { article, mentions }, config)`. */
export interface IntelligenceHandoff {
  article: PublishedArticle;
  mentions: RoleMention[];
  /**
   * false = flag `intelligencePessoas` desligada: só organizações. Nesse modo o pacote NÃO carrega nome de pessoa
   * (personName vazio, trecho com o nome omitido e sem headline); o consumidor registra só as organizações.
   */
  personsIncluded: boolean;
  /** Auditoria: menções propostas e descartadas, com o motivo. Nunca vai ao consumidor. */
  dropped: DroppedMention[];
  /** Origem de cada menção mantida (regra determinística ou modelo via gateway), na mesma ordem de `mentions`. */
  origins: Array<'rule' | 'model'>;
}
