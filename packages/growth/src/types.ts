// Tipos locais do pacote growth. Quando packages/contracts existir (Frente 02), estes tipos
// migram para lá (schemas zod); este arquivo não define contrato compartilhado.

export type Channel = 'linkedin' | 'instagram' | 'the_loyal';

/** Identidade que age. Só `publisher_social` (serviço determinista de publicação) pode publicar (ADR-008, F-044). */
export type ActorRole = 'publisher_social' | 'redacao' | 'design' | 'growth_agent' | 'unknown';

export interface Actor {
  id: string;
  role: ActorRole;
}

export interface VerifiedIdentity {
  /** URN/URL da página oficial (LinkedIn) ou handle verificado. */
  ref: string;
  /** Fonte da verificação (URL da página oficial, registro CNPJ etc.). */
  source: string;
  verifiedAt: string;
}

export interface Entity {
  name: string;
  kind: 'company' | 'person';
  /** Sem `verified`, a entidade NUNCA é marcada: aparece em texto puro. */
  verified?: VerifiedIdentity;
}

export interface Fact {
  /** Texto do fato como aprovado pela fábrica editorial. */
  text: string;
  /** Fonte rastreável (URL ou id de evidência). */
  source: string;
}

export interface Article {
  id: string;
  title: string;
  deck?: string;
  /** Editoria canônica (uma das dez). */
  editoria: string;
  /** URL canônica da matéria no portal. */
  url: string;
  facts: Fact[];
  entities?: Entity[];
  /** Imagem aprovada pelo gate de mídia (crédito e link preservados). */
  approvedImage?: { ref: string; credit: string; creditUrl?: string };
  /** `true` = matéria já passou nos gates automáticos WF02/WF03. */
  gatesPassed: boolean;
  /** Marca fixture/demonstração: o criativo exibe MOCK. */
  mock?: boolean;
}

export interface Violation {
  rule: string;
  detail: string;
}

export interface CreativeAsset {
  format: 'vertical' | 'square' | 'story' | 'open_graph' | 'linkedin_landscape';
  width: number;
  height: number;
  svg: string;
  html: string;
  contextKey: string;
  brandStatus: string;
  mock: boolean;
}
