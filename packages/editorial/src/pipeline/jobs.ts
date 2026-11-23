import type { IntelligenceHandoff } from '../intelligence/types';
import type { Draft, Evidence, Finding } from '../types';
import type { Editoria } from '../types';

export const STAGES = ['triage', 'context', 'draft', 'factcheck', 'review', 'social_pack', 'roles'] as const;
export type Stage = (typeof STAGES)[number];
export const queueName = (s: Stage): string => `editorial-${s}`;

export interface ContextNote { text: string; evidenceIds: string[] }
export interface FactVerdict { claimId: string; verdict: 'pass' | 'fail' | 'inconclusive' }

/** Estado serializável carregado pelo job (em produção, persistido em PostgreSQL por id). */
export interface ArticleJob {
  articleId: string;
  editoria: Editoria;
  evidences: Evidence[];
  /** Fontes e rastros já resolvidos pelo coletor/dedupe antes da triagem. */
  duplicateOf?: string | null;
  context?: ContextNote[];
  draft?: Draft;
  /** Slug gerado na 1ª redação e mantido nas seguintes (muda livremente até a 1ª publicação; depois é imutável). */
  slug?: string;
  attempt: number;           // redações tentadas (máx. 3, model.policy rules.max_attempts)
  feedback?: Finding[];      // achados que motivaram nova redação
  factcheck?: { provider: string; model: string; verdicts: FactVerdict[] };
  approved?: boolean;
}

export interface JobSpec { stage: Stage; jobId: string; data: ArticleJob }

export type BlockerCode =
  | 'duplicate' | 'rights_unknown' | 'suspicious_evidence' | 'not_relevant'
  | 'unsupported_claim' | 'copy_literal' | 'cross_provider_check_failed' | 'approval_missing'
  | 'rights_basis_unresolved' | 'budget_blocked' | 'invalid_model_output' | 'max_attempts' | 'no_image'
  | 'not_published' | 'stale_approval';

export interface Blocked { articleId: string; stage: Stage; blockers: BlockerCode[]; findings: Finding[] }

export type StageOutcome =
  | { kind: 'next'; next: JobSpec }
  | { kind: 'blocked'; blocked: Blocked }
  | { kind: 'done'; event: 'article.approved' | 'social.pack_ready' | 'roles.extracted'; data: ArticleJob; pack?: SocialPack; handoff?: IntelligenceHandoff };

export interface SocialPack {
  articleId: string;
  linkedin: { text: string; url: string; utm: { source: string; medium: string; campaign: string } };
  /** Instagram só existe com a flag ligada; padrão: ausente. */
  instagram?: { caption: string };
  image: { mode: 'none' | 'source_image' | 'conceptual'; reason?: string };
  mentions: string[];       // sempre vazio: nenhuma menção é publicada sem verificação (fallback texto puro)
  blockers: BlockerCode[];  // ex.: 'no_image' — o Growth decide como tratar
}
