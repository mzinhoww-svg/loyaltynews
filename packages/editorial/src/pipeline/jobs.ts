import type { IntelligenceHandoff } from '../intelligence/types';
import type { Draft, Evidence, Finding } from '../types';
import type { AutoralFormat, Editoria } from '../types';

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
  /** Id da TAREFA (no gateway) que produziu o rascunho atual, se o gateway informou: é o `reviewedDraftTaskId` das etapas seguintes. */
  draftTaskId?: string;
  /** Agente (worker) que produziu o rascunho atual, se o gateway informou (independência por agente, DP-71). */
  draftAgent?: string;
  /** Slug gerado na 1ª redação e mantido nas seguintes (muda livremente até a 1ª publicação; depois é imutável). */
  slug?: string;
  attempt: number;           // redações tentadas: sobe só em re-redação pedida (recheck/feedback do editor); gate determinístico não refaz a redação
  feedback?: Finding[];      // achados que motivaram nova redação
  factcheck?: { provider: string; model: string; verdicts: FactVerdict[]; reviewedDraftTaskId?: string; reviewedDraftSha256?: string; /** só na independência por agente: quem checou e em qual tarefa */ agent?: string; taskId?: string };
  /** Resultado da revisão final (qual revisão do rascunho avaliou e por qual modelo). */
  review?: { provider: string; model: string; reviewedDraftTaskId: string; reviewedDraftSha256: string };
  approved?: boolean;
  /** Pauta AUTORAL (DP-29): presente só no conteúdo próprio da redação; ausente = matéria de reescrita de fonte. */
  autoral?: { pautaId: string; formato: AutoralFormat; titulo: string; angulo: string };
}

export interface JobSpec { stage: Stage; jobId: string; data: ArticleJob }

export type BlockerCode =
  | 'duplicate' | 'rights_unknown' | 'suspicious_evidence' | 'not_relevant'
  | 'unsupported_claim' | 'copy_literal' | 'cross_provider_check_failed' | 'approval_missing'
  | 'rights_basis_unresolved' | 'budget_blocked' | 'invalid_model_output' | 'max_attempts' | 'no_image'
  | 'not_published' | 'stale_approval' | 'unanchored' | 'autoral_invalid'
  /** Tom lint bloqueante (guia de tom v0.2: emoji, "!" no título, título > 90, veja/saiba/confira, frase do rodapé em inglês). */
  | 'tone_lint'
  /** A tarefa segue na fila além do prazo do gateway (`pending_timeout`): não é falha permanente nem "modelo desabilitado". */
  | 'pending_timeout';

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
  /** `label` = rótulo visível obrigatório (ADR-018): "Ilustração conceitual"; null/ausente quando a imagem não é ilustração. */
  image: { mode: 'none' | 'source_image' | 'conceptual'; reason?: string; label?: string };
  mentions: string[];       // sempre vazio: nenhuma menção é publicada sem verificação (fallback texto puro)
  blockers: BlockerCode[];  // ex.: 'no_image' — o Growth decide como tratar
}
