import { providerOfModel, type Account } from './types';

// Trilha e parada imediata do PILOTO de 10 matérias pelo canal OpenBot (assinaturas Claude/Codex + OpenCode grátis;
// OpenRouter desligado). Desenho: fast-track/custo/piloto-10-materias-openbot.md. Kit do AgentOps: packages/agents (pilot.ts).
// Aqui o adaptador faz o que só ele vê: grava uma LINHA por execução (a mesma da planilha), detecta as condições de parada
// imediata (publicar, API tarifada, segredo em texto, ferramenta fora do contrato) e consulta o `canDispatchNext` do AgentOps
// antes de entregar ou despachar qualquer tarefa. Nenhuma chamada de modelo, nenhuma rede.

// Espelho dos tipos de packages/agents/src/pilot.ts (PilotRow). Mantidos idênticos para a função `canDispatchNext` do AgentOps
// aceitar estas linhas sem adaptação; a conferência de tipos entra quando ft/agents for integrado.
export type PilotAccount = 'claude' | 'codex' | 'opencode' | 'antigravity' | 'deterministic';
export type PilotStage = 'triage' | 'draft' | 'factcheck' | 'review' | 'check_edit' | 'social_pack' | 'roles' | 'rights_seo_qa';
export const PILOT_STAGES = ['triage', 'draft', 'factcheck', 'review', 'check_edit', 'social_pack', 'roles', 'rights_seo_qa'] as const;
export const PILOT_ACCOUNTS = ['claude', 'codex', 'opencode', 'antigravity', 'deterministic'] as const;

export interface PilotRow {
  task_id: string;
  kind: string;
  article_id: string;
  source_id: string;
  stage: PilotStage;
  account: PilotAccount;
  declared_model: string | null;
  prompt_version: string | null;
  started_at: string;
  ended_at: string;
  attempt: number;
  reviewed_draft_task_id?: string;
  outcome: 'completed' | 'failed' | 'retryable' | 'pending_limit';
  limit_message?: string;
  limit_at?: string;
  account_resumed_at?: string;
  gate_verdict?: 'approved' | 'blocked';
  gate_reasons?: string[];
  cross_provider_ok?: boolean;
  packet_chars: number | null;
  output_valid?: boolean;
  tokens_measured: false;
  unsupported_facts?: number;
  published_attempt: boolean;
  tarifada_api_call: boolean;
  secret_in_log: boolean;
  tool_outside_contract: boolean;
  notes?: string;
}

/** Porta do AgentOps: `canDispatchNext(rows)` de packages/agents. Injetada; este pacote não importa o kit do AgentOps. */
export type PilotGate = (rows: readonly PilotRow[]) => { allowed: boolean; reasons: string[] };

export interface PilotRowStore {
  /** Insere ou substitui a linha de (task_id, attempt). */
  upsert(row: PilotRow): Promise<void>;
  /** Completa campos que só Editorial/AgentOps conhecem (gate_verdict, unsupported_facts…). */
  patch(taskId: string, attempt: number, fields: Partial<PilotRow>): Promise<boolean>;
  all(): Promise<PilotRow[]>;
}

export class InMemoryPilotRowStore implements PilotRowStore {
  private readonly rows = new Map<string, PilotRow>();
  private key = (taskId: string, attempt: number) => `${taskId}#${attempt}`;
  async upsert(row: PilotRow) {
    this.rows.set(this.key(row.task_id, row.attempt), structuredClone(row));
  }
  async patch(taskId: string, attempt: number, fields: Partial<PilotRow>) {
    const cur = this.rows.get(this.key(taskId, attempt));
    if (!cur) return false;
    this.rows.set(this.key(taskId, attempt), { ...cur, ...structuredClone(fields), task_id: cur.task_id, attempt: cur.attempt });
    return true;
  }
  async all() {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
}

export interface PilotStop {
  reasons: string[];
  at: string;
}

export interface PilotStateStore {
  get(): Promise<PilotStop | null>;
  stop(reason: string, at: string): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryPilotState implements PilotStateStore {
  private cur: PilotStop | null = null;
  async get() {
    return this.cur ? { reasons: [...this.cur.reasons], at: this.cur.at } : null;
  }
  async stop(reason: string, at: string) {
    this.cur = this.cur ? { reasons: [...new Set([...this.cur.reasons, reason])], at: this.cur.at } : { reasons: [reason], at };
  }
  async clear() {
    this.cur = null;
  }
}

/**
 * DP-41 (23/11/2026, proprietário): o piloto só usa as assinaturas JÁ PAGAS, Claude e Codex; sem OpenCode nem Antigravity, sem API
 * tarifada, sem publicação. Vale por padrão sempre que o piloto está ativo (`PilotControl.allowedAccounts` só pode ESTREITAR ou, em
 * teste da mecânica genérica, ampliar de forma explícita).
 */
export const DP41_ACCOUNTS: readonly Account[] = Object.freeze(['claude', 'codex'] as Account[]);

export interface PilotControl {
  /** Piloto ativo: ligado só em staging, por decisão registrada. Desligado = nada disto vale. */
  enabled: boolean;
  /** Contas que o piloto aceita (rota, pull e despacho). Padrão: DP-41 = claude e codex. */
  allowedAccounts?: readonly Account[];
  rows: PilotRowStore;
  state: PilotStateStore;
  gate: PilotGate;
}

/** Etapas de independência: a linha só fica completa quando a Editorial grava `gate_verdict` (por `patch`), depois do callback. */
export const INDEPENDENT_STAGES: readonly string[] = ['factcheck', 'review', 'check_edit'];

/**
 * Linha concluída de uma etapa de independência que ainda NÃO recebeu o veredito do gate da Editorial. O `canDispatchNext` do AgentOps
 * a considera inválida (`gate_verdict` obrigatório), o que PARARIA o piloto no intervalo entre o callback e o `patch`. Por isso ela não
 * entra na consulta do gate: as paradas imediatas já foram registradas pelo próprio adaptador no callback, e a linha continua na
 * planilha, pendente, até a Editorial completá-la (a avaliação final do piloto exige todas completas).
 */
export function awaitingEditorialGate(r: Pick<PilotRow, 'stage' | 'outcome' | 'gate_verdict'>): boolean {
  return INDEPENDENT_STAGES.includes(r.stage) && r.outcome === 'completed' && r.gate_verdict === undefined;
}

export const STOP = {
  api: 'api_tarifada',
  publish: 'tentativa_de_publicar',
  secret: 'segredo_em_texto',
  tool: 'ferramenta_fora_do_contrato',
  route: 'conta_fora_da_rota',
  gate: 'canDispatchNext_recusou',
} as const;

// ---------- segredo em texto ----------

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/,
  /\b(?:api[_-]?key|secret|token|password|senha)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{12,}/i,
];
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Mascara e-mail e segredo; devolve se achou segredo (parada imediata). O texto devolvido nunca contém o segredo. */
export function redactText(text: string): { text: string; secretFound: boolean } {
  let out = text;
  let secretFound = false;
  for (const re of SECRET_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    if (g.test(out)) {
      secretFound = true;
      out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), '[segredo removido]');
    }
  }
  out = out.replace(EMAIL_RE, '[e-mail]');
  return { text: out, secretFound };
}

// ---------- planilha (CSV) ----------

/** Ordem das colunas da planilha de medição do AgentOps (pilot-protocol.md §9). */
export const PILOT_CSV_COLUMNS = [
  'task_id', 'kind', 'article_id', 'source_id', 'stage', 'account', 'declared_model', 'prompt_version', 'started_at', 'ended_at', 'attempt',
  'reviewed_draft_task_id', 'outcome', 'limit_message', 'limit_at', 'account_resumed_at', 'gate_verdict', 'gate_reasons', 'cross_provider_ok',
  'packet_chars', 'output_valid', 'tokens_measured', 'unsupported_facts', 'published_attempt', 'tarifada_api_call', 'secret_in_log',
  'tool_outside_contract', 'notes',
] as const;

function cell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = Array.isArray(v) ? v.join(' | ') : String(v);
  // Neutraliza fórmula de planilha (injeção de CSV) e escapa aspas/quebras.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function pilotCsv(rows: readonly PilotRow[]): string {
  const lines = [PILOT_CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(PILOT_CSV_COLUMNS.map((c) => cell((r as unknown as Record<string, unknown>)[c])).join(','));
  return `${lines.join('\n')}\n`;
}

// ---------- relatório do que o adaptador mede ----------

export interface PilotAdapterReport {
  articles: number;
  executions: number;
  byAccount: Record<string, { executions: number; completed: number; failed: number; pendingLimit: number; limitHits: number }>;
  /** Intervalos entre o limite e a retomada da conta, em ms, quando o OpenBot informou os dois horários. */
  limitWindowsMs: number[];
  /** Por matéria: redator e checador de provedores diferentes? Falso = violação da independência. */
  independence: { checked: number; independent: number; violations: string[] };
  notMeasured: string[];
}


export function adapterReport(rows: readonly PilotRow[]): PilotAdapterReport {
  const byAccount: PilotAdapterReport['byAccount'] = {};
  const windows: number[] = [];
  for (const r of rows) {
    const a = (byAccount[r.account] ??= { executions: 0, completed: 0, failed: 0, pendingLimit: 0, limitHits: 0 });
    a.executions += 1;
    if (r.outcome === 'completed') a.completed += 1;
    if (r.outcome === 'failed') a.failed += 1;
    if (r.outcome === 'pending_limit') a.pendingLimit += 1;
    if (r.limit_at) {
      a.limitHits += 1;
      if (r.account_resumed_at) {
        const d = Date.parse(r.account_resumed_at) - Date.parse(r.limit_at);
        if (Number.isFinite(d) && d >= 0) windows.push(d);
      }
    }
  }
  const byArticle = new Map<string, PilotRow[]>();
  for (const r of rows) byArticle.set(r.article_id, [...(byArticle.get(r.article_id) ?? []), r]);
  let checked = 0;
  let independent = 0;
  const violations: string[] = [];
  for (const [article, rs] of byArticle) {
    const authors = new Set(rs.filter((r) => r.stage === 'draft' && r.outcome === 'completed').map((r) => providerOfModel(r.declared_model, r.account)));
    const checkers = rs.filter((r) => ['factcheck', 'review', 'check_edit'].includes(r.stage) && r.outcome === 'completed');
    for (const c of checkers) {
      checked += 1;
      if (authors.size > 0 && !authors.has(providerOfModel(c.declared_model, c.account))) independent += 1;
      else violations.push(`${article}: ${c.stage} (${c.account}) sem autor distinto do redator`);
    }
  }
  return {
    articles: byArticle.size,
    executions: rows.length,
    byAccount,
    limitWindowsMs: windows,
    independence: { checked, independent, violations },
    notMeasured: ['tokens (o OpenBot não os expõe; packet_chars é o substituto)'],
  };
}
