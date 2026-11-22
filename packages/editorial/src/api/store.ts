import type { ArticleStatus } from '@ln/contracts';
import type { Claim, Draft, Evidence, Finding } from '../types';
import type { ArticleJob, BlockerCode, StageOutcome } from '../pipeline/jobs';
import type { CorrectionCase } from '../corrections/corrections';

/**
 * Persistência dos handlers do Studio. É uma PORTA: o Backend implementa sobre PostgreSQL (packages/db);
 * `InMemoryEditorialStore` serve a testes e desenvolvimento. Nenhum dado fictício é semeado aqui.
 */

export interface ReviewNote { at: string; userId: string; decision: 'confirm' | 'send_back' | 'block'; note: string }

export interface ArticleRecord {
  articleId: string;
  editoria: Draft['editoria'];
  status: ArticleStatus;
  draft?: Draft;
  evidences: Evidence[];
  factcheck?: { provider: string; model: string; verdicts: Array<{ claimId: string; verdict: 'pass' | 'fail' | 'inconclusive' }> };
  blockers: BlockerCode[];
  findings: Finding[];
  reviews: ReviewNote[];
  recheckCount: number;
  updatedAt: string;
}

/** Caso de correção/resposta + dados que o fluxo precisa guardar e que não pertencem à máquina de estados. */
export interface CorrectionRecord {
  case: CorrectionCase;
  /** Texto do requerente (dado NÃO confiável e pessoal): preservado sem alteração; nunca vai a modelo sem saneamento. */
  replyText?: string;
  /** Contato do requerente (dado pessoal, LGPD): usar só para o caso. */
  contact?: string;
  /** Texto corrigido proposto e claims que o sustentam (errata). */
  corrected?: string;
  claims?: Claim[];
  verification?: { by: string; at: string; method: string };
}

export interface AuditItem { at: string; userId: string | null; action: string; target: string; detail?: string }

export interface EditorialStore {
  getArticle(id: string): ArticleRecord | undefined;
  putArticle(r: ArticleRecord): void;
  listArticles(): ArticleRecord[];
  getCorrection(id: string): CorrectionRecord | undefined;
  putCorrection(r: CorrectionRecord): void;
  listCorrections(): CorrectionRecord[];
  appendAudit(a: AuditItem): void;
}

export class InMemoryEditorialStore implements EditorialStore {
  private readonly articles = new Map<string, ArticleRecord>();
  private readonly corrections = new Map<string, CorrectionRecord>();
  readonly audit: AuditItem[] = [];
  getArticle(id: string) { return this.articles.get(id); }
  putArticle(r: ArticleRecord) { this.articles.set(r.articleId, r); }
  listArticles() { return [...this.articles.values()]; }
  getCorrection(id: string) { return this.corrections.get(id); }
  putCorrection(r: CorrectionRecord) { this.corrections.set(r.case.id, r); }
  listCorrections() { return [...this.corrections.values()]; }
  appendAudit(a: AuditItem) { this.audit.push(a); }
}

/** Aplica o resultado de um estágio do pipeline ao registro da matéria (hooks do worker do Backend). */
export function applyOutcome(store: EditorialStore, job: ArticleJob, outcome: StageOutcome, at: string): ArticleRecord {
  const prev = store.getArticle(job.articleId);
  const base: ArticleRecord = prev ?? {
    articleId: job.articleId, editoria: job.editoria, status: 'rascunho', evidences: job.evidences, blockers: [], findings: [],
    reviews: [], recheckCount: 0, updatedAt: at,
  };
  const src = outcome.kind === 'next' ? outcome.next.data : outcome.kind === 'done' ? outcome.data : job;
  const rec: ArticleRecord = {
    ...base, editoria: src.editoria, evidences: src.evidences, updatedAt: at,
    ...(src.draft ? { draft: src.draft } : {}), ...(src.factcheck ? { factcheck: src.factcheck } : {}),
  };
  if (outcome.kind === 'next') { rec.status = 'em_checagem'; rec.blockers = []; rec.findings = []; }
  else if (outcome.kind === 'done') { rec.status = outcome.event === 'article.approved' ? 'aprovado' : rec.status; rec.blockers = []; rec.findings = []; }
  else { rec.status = 'bloqueado'; rec.blockers = outcome.blocked.blockers; rec.findings = outcome.blocked.findings; }
  store.putArticle(rec);
  return rec;
}
