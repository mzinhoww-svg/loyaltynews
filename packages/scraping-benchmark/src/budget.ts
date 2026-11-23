/**
 * Política US$ 0 (Diretiva V3 §10). Duas travas antes de QUALQUER chamada externa:
 *  1) gate de cobrança: o provedor só roda com `billing: 'free-confirmed'` e evidência (link/print da conta). Senão: bloqueado.
 *  2) teto de créditos: limite do benchmark ABAIXO da cota gratuita (margem de segurança); ao atingir, corte automático.
 * O livro é persistido em JSON (checkpoint) para sobreviver a reinícios.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type BillingStatus = 'free-confirmed' | 'unconfirmed' | 'blocked';

export interface ProviderBudget {
  provider: string;
  billing: BillingStatus;
  billingEvidence?: string;
  /** Créditos que o benchmark pode gastar neste mês (≤ cota gratuita restante − margem). */
  creditCap: number;
  /** Preço de referência por crédito, só para ESTIMAR custo equivalente (não é gasto: cota gratuita). */
  usdPerCredit: number;
  /** Conta (rótulo, nunca o segredo) cuja cota é consumida: o livro soma por produto E por conta (pedido FinOps 23/11). */
  account?: string;
  /** Unidade do crédito, para o FinOps (ex.: '1 req (Web Unlocker)', 'US$ 0,001 (Exa costDollars)'). */
  unit?: string;
  /** Alerta (créditos) antes do teto; gravado uma vez por mês em `alerts`. */
  alertAt?: number;
}

export interface LedgerState {
  month: string;
  /** créditos por produto */
  used: Record<string, number>;
  /** créditos por `produto|conta` */
  byAccount?: Record<string, number>;
  alerts?: Array<{ at: string; key: string; used: number; alertAt: number }>;
}

export type BudgetDecision = { ok: true } | { ok: false; reason: 'billing_unconfirmed' | 'budget_blocked' };

export class BudgetGuard {
  private state: LedgerState;
  constructor(
    private readonly budgets: Record<string, ProviderBudget>,
    private readonly ledgerPath?: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    const month = this.monthKey();
    const loaded = ledgerPath && existsSync(ledgerPath) ? (JSON.parse(readFileSync(ledgerPath, 'utf8')) as LedgerState) : undefined;
    this.state = loaded && loaded.month === month ? loaded : { month, used: {} };
  }
  private monthKey() {
    const d = this.now();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  used(provider: string): number {
    return this.state.used[provider] ?? 0;
  }
  remaining(provider: string): number {
    const b = this.budgets[provider];
    return b ? Math.max(0, b.creditCap - this.used(provider)) : 0;
  }
  /** Checa ANTES de chamar, com o pior caso de créditos da leitura. */
  check(provider: string, worstCaseCredits: number): BudgetDecision {
    const b = this.budgets[provider];
    if (!b || b.billing !== 'free-confirmed') return { ok: false, reason: 'billing_unconfirmed' };
    if (this.used(provider) + worstCaseCredits > b.creditCap) return { ok: false, reason: 'budget_blocked' };
    return { ok: true };
  }
  record(provider: string, credits: number): void {
    if (this.state.month !== this.monthKey()) this.state = { month: this.monthKey(), used: {} };
    this.state.used[provider] = +(this.used(provider) + credits).toFixed(6);
    const b = this.budgets[provider];
    const key = `${provider}|${b?.account ?? 'conta-1'}`;
    this.state.byAccount ??= {};
    this.state.byAccount[key] = +((this.state.byAccount[key] ?? 0) + credits).toFixed(6);
    if (b?.alertAt !== undefined && this.state.byAccount[key]! >= b.alertAt) {
      this.state.alerts ??= [];
      if (!this.state.alerts.some((a) => a.key === key)) this.state.alerts.push({ at: this.now().toISOString(), key, used: this.state.byAccount[key]!, alertAt: b.alertAt });
    }
    if (this.ledgerPath) {
      mkdirSync(dirname(this.ledgerPath), { recursive: true });
      writeFileSync(this.ledgerPath, JSON.stringify(this.state, null, 2));
    }
  }
  estimateUsd(provider: string, credits: number): number {
    return +(credits * (this.budgets[provider]?.usdPerCredit ?? 0)).toFixed(6);
  }
  snapshot(): LedgerState {
    return JSON.parse(JSON.stringify(this.state));
  }
}
