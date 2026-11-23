import type { UsageReport } from './types';
import { ID_RE } from './types';

// Custos do OpenBot em micro-USD inteiros (mesma unidade do modelops). Regras: custo desconhecido é recusado (bloqueio
// por preço desconhecido), o relato é deduplicado por `executionId`, e a soma do OpenBot é CONCILIADA com o ledger do
// gateway por `generationId` (ADR-003). Teto mensal padrão: US$ 50 agregado (Blueprint §5; o valor oficial é do modelops).

export const MONTHLY_CAP_MICRO = 50_000_000;

export type UsageProblem =
  | 'campo_ausente'
  | 'id_invalido'
  | 'numero_invalido'
  | 'custo_desconhecido'
  | 'geracao_ausente';

export interface UsageValidation {
  ok: boolean;
  problems: { code: UsageProblem; field: string }[];
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

export function validateUsage(u: unknown): UsageValidation {
  const problems: UsageValidation['problems'] = [];
  const bad = (code: UsageProblem, field: string) => problems.push({ code, field });
  if (typeof u !== 'object' || u === null || Array.isArray(u)) return { ok: false, problems: [{ code: 'campo_ausente', field: '(raiz)' }] };
  const r = u as Record<string, unknown>;
  for (const f of ['executionId', 'taskId', 'leaseId'] as const) {
    if (typeof r[f] !== 'string') bad('campo_ausente', f);
    else if (!ID_RE.test(r[f] as string)) bad('id_invalido', f);
  }
  if (typeof r.model !== 'string' || r.model.length === 0 || r.model.length > 128) bad('campo_ausente', 'model');
  for (const f of ['promptTokens', 'completionTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (!isCount(r[f])) bad('numero_invalido', f);
  }
  // Custo ausente, NaN, negativo, fracionário ou nulo = preço desconhecido: recusa, nunca assume zero.
  if (r.costMicro === undefined || r.costMicro === null) bad('custo_desconhecido', 'costMicro');
  else if (!isCount(r.costMicro)) bad('custo_desconhecido', 'costMicro');
  const gens = r.generationIds;
  if (!Array.isArray(gens) || gens.some((g) => typeof g !== 'string' || !ID_RE.test(g))) bad('id_invalido', 'generationIds');
  else if (gens.length === 0 && ((r.costMicro as number) > 0 || (r.promptTokens as number) > 0 || (r.completionTokens as number) > 0)) {
    bad('geracao_ausente', 'generationIds'); // gasto sem id de geração não pode ser conciliado
  }
  return { ok: problems.length === 0, problems };
}

export interface CostEntry extends UsageReport {
  recordedAt: string;
  /** `true` quando o custo passou do teto da tarefa. Registrado mesmo assim: nunca esconder estouro. */
  overrun: boolean;
}

export interface CostLedger {
  /** Idempotente por `executionId`. */
  record(report: UsageReport, maxCostMicro: number, now: Date): Promise<{ recorded: boolean; entry: CostEntry }>;
  entries(): Promise<CostEntry[]>;
  totalMicro(): Promise<number>;
}

export class InMemoryCostLedger implements CostLedger {
  private readonly rows = new Map<string, CostEntry>();

  async record(report: UsageReport, maxCostMicro: number, now: Date) {
    const prior = this.rows.get(report.executionId);
    if (prior) return { recorded: false, entry: structuredClone(prior) };
    const entry: CostEntry = {
      ...structuredClone(report),
      recordedAt: now.toISOString(),
      overrun: report.costMicro > maxCostMicro,
    };
    this.rows.set(report.executionId, entry);
    return { recorded: true, entry: structuredClone(entry) };
  }

  async entries() {
    return [...this.rows.values()].map((e) => structuredClone(e));
  }

  async totalMicro() {
    let s = 0;
    for (const e of this.rows.values()) s += e.costMicro;
    return s;
  }
}

export type BudgetStatus = 'ok' | 'alerta' | 'estourado';

/** Alerta a partir de 80% do teto; estourado quando o gasto (com o novo custo) passa do teto. Inteiros, sem ponto flutuante. */
export function budgetStatus(spentMicro: number, capMicro: number = MONTHLY_CAP_MICRO): { status: BudgetStatus; remainingMicro: number } {
  const remaining = capMicro - spentMicro;
  if (spentMicro > capMicro) return { status: 'estourado', remainingMicro: remaining };
  if (spentMicro * 10 >= capMicro * 8) return { status: 'alerta', remainingMicro: remaining };
  return { status: 'ok', remainingMicro: remaining };
}

export interface GatewayEntry {
  generationId: string;
  costMicro: number;
}

export interface Reconciliation {
  ok: boolean;
  totalOpenbotMicro: number;
  /** Soma do gateway SÓ das gerações atribuídas ao LN (as que o OpenBot relatou ou que o gateway marcou). */
  totalGatewayMicro: number;
  matched: number;
  /** Gerações que o OpenBot relatou e o gateway não tem: custo sem lastro no ledger. */
  onlyOpenbot: string[];
  /** Gerações no ledger do gateway que o OpenBot não relatou: gasto sem relato. */
  onlyGateway: string[];
  /** Mesma geração, valores diferentes além da tolerância. */
  mismatches: { generationId: string; openbotMicro: number; gatewayMicro: number }[];
}

/**
 * Concilia custos relatados pelo OpenBot com o ledger do gateway por `generationId`. O custo de uma execução com várias
 * gerações é repartido igualmente entre elas só para a comparação por geração quando o relato não traz custo por geração;
 * a soma total é comparada exatamente. Tolerância em micro-USD (padrão 0: custos inteiros devem bater).
 */
export function reconcile(reports: readonly UsageReport[], gateway: readonly GatewayEntry[], toleranceMicro = 0): Reconciliation {
  const gw = new Map<string, number>();
  for (const g of gateway) gw.set(g.generationId, (gw.get(g.generationId) ?? 0) + g.costMicro);

  const perGen = new Map<string, number>();
  let totalOpenbot = 0;
  for (const r of reports) {
    totalOpenbot += r.costMicro;
    const n = r.generationIds.length;
    if (n === 0) continue;
    const base = Math.floor(r.costMicro / n);
    let rest = r.costMicro - base * n;
    for (const id of r.generationIds) {
      const share = base + (rest > 0 ? 1 : 0);
      if (rest > 0) rest -= 1;
      perGen.set(id, (perGen.get(id) ?? 0) + share);
    }
  }

  const onlyOpenbot: string[] = [];
  const mismatches: Reconciliation['mismatches'] = [];
  let matched = 0;
  let totalGateway = 0;
  for (const [id, mine] of perGen) {
    const theirs = gw.get(id);
    if (theirs === undefined) {
      onlyOpenbot.push(id);
      continue;
    }
    totalGateway += theirs;
    if (Math.abs(theirs - mine) <= toleranceMicro) matched += 1;
    else mismatches.push({ generationId: id, openbotMicro: mine, gatewayMicro: theirs });
  }
  const onlyGateway = [...gw.keys()].filter((id) => !perGen.has(id));
  for (const id of onlyGateway) totalGateway += gw.get(id) ?? 0;

  return {
    ok: onlyOpenbot.length === 0 && onlyGateway.length === 0 && mismatches.length === 0 && Math.abs(totalGateway - totalOpenbot) <= toleranceMicro,
    totalOpenbotMicro: totalOpenbot,
    totalGatewayMicro: totalGateway,
    matched,
    onlyOpenbot: onlyOpenbot.sort(),
    onlyGateway: onlyGateway.sort(),
    mismatches,
  };
}
