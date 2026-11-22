import type { ArticleStatus } from '@ln/contracts';
import type { Claim, Draft, Evidence, Finding, TermsStatus, Source } from '../types';
import type { ArticleJob, BlockerCode, StageOutcome } from '../pipeline/jobs';
import type { CorrectionCase } from '../corrections/corrections';

/**
 * PORTA DE PERSISTÊNCIA do CMS editorial (contrato completo em docs/editorial-store-contract.md).
 * O Backend implementa sobre PostgreSQL e DEVE passar `runEditorialStoreContract` (ver `@ln/editorial/testing`).
 * `InMemoryEditorialStore` é a implementação de referência para testes; nenhum dado fictício é semeado.
 *
 * Regras de contrato (resumo):
 * - Todos os métodos são assíncronos.
 * - `get*` devolve `undefined` quando não existe. `put*` é UPSERT pela chave (substitui por inteiro, atômico).
 * - Valores são dados JSON puros (strings ISO para datas; sem Date/Map/funções). `undefined` pode ser descartado.
 * - Sem aliasing: alterar o objeto devolvido ou o objeto já entregue a `put*` NÃO altera o que está armazenado.
 * - `appendAudit` é somente-acréscimo e preserva a ordem de chegada; `listAudit` devolve tudo, em ordem.
 * - `list*` devolve todos os registros, sem duplicatas; a ordem NÃO é garantida (os handlers ordenam).
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
  /** Preenchido por `applyPublication` quando o Backend publica (WF03) e devolve o recibo. */
  publication?: { receiptId: string; url: string; publishedAt: string; contentSha256: string; isMock?: boolean };
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

/** Revisão humana de uma fonte (habilitação nunca é automática). */
export interface SourceReview {
  reviewer: string;
  at: string;
  termsStatus: Exclude<TermsStatus, 'pending'>;
  termsNote: string;
  urlVerified: boolean;
  robotsChecked: boolean;
  paywall: 'none' | 'login' | 'metered';
  /** Impressão digital da definição da fonte revisada (host, prefixo, URLs, termos). Muda a definição => revisão vencida. */
  fingerprint: string;
}

/** Estado mutável de uma fonte; o cadastro (seed) é imutável e `enabled` nunca vem dele. */
export interface SourceState {
  sourceId: string;
  enabled: boolean;
  termsStatus: TermsStatus;
  urlVerified: boolean;
  paywall: Source['paywall'];
  review: SourceReview | null;
  updatedAt: string;
  updatedBy: string;
}

export interface EditorialStore {
  getArticle(id: string): Promise<ArticleRecord | undefined>;
  putArticle(r: ArticleRecord): Promise<void>;
  listArticles(): Promise<ArticleRecord[]>;
  getCorrection(id: string): Promise<CorrectionRecord | undefined>;
  putCorrection(r: CorrectionRecord): Promise<void>;
  listCorrections(): Promise<CorrectionRecord[]>;
  getSourceState(sourceId: string): Promise<SourceState | undefined>;
  putSourceState(s: SourceState): Promise<void>;
  listSourceStates(): Promise<SourceState[]>;
  appendAudit(a: AuditItem): Promise<void>;
  listAudit(): Promise<AuditItem[]>;
}

const copy = <T>(v: T): T => structuredClone(v);

export class InMemoryEditorialStore implements EditorialStore {
  private readonly articles = new Map<string, ArticleRecord>();
  private readonly corrections = new Map<string, CorrectionRecord>();
  private readonly sources = new Map<string, SourceState>();
  private readonly auditLog: AuditItem[] = [];
  async getArticle(id: string) { const r = this.articles.get(id); return r ? copy(r) : undefined; }
  async putArticle(r: ArticleRecord) { this.articles.set(r.articleId, copy(r)); }
  async listArticles() { return [...this.articles.values()].map(copy); }
  async getCorrection(id: string) { const r = this.corrections.get(id); return r ? copy(r) : undefined; }
  async putCorrection(r: CorrectionRecord) { this.corrections.set(r.case.id, copy(r)); }
  async listCorrections() { return [...this.corrections.values()].map(copy); }
  async getSourceState(id: string) { const r = this.sources.get(id); return r ? copy(r) : undefined; }
  async putSourceState(s: SourceState) { this.sources.set(s.sourceId, copy(s)); }
  async listSourceStates() { return [...this.sources.values()].map(copy); }
  async appendAudit(a: AuditItem) { this.auditLog.push(copy(a)); }
  async listAudit() { return this.auditLog.map(copy); }
}

/** Aplica o resultado de um estágio do pipeline ao registro da matéria (hooks do worker do Backend). */
export async function applyOutcome(store: EditorialStore, job: ArticleJob, outcome: StageOutcome, at: string): Promise<ArticleRecord> {
  const prev = await store.getArticle(job.articleId);
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
  await store.putArticle(rec);
  return rec;
}
