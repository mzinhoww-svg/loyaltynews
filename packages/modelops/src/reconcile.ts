// G4.2 — conciliação do ledger com o provedor (`GET /api/v1/generation?id=`) e replay mensal com tolerância.
// O ledger grava o custo real que a resposta informou; o provedor é a fonte da cobrança. Aqui cada reserva conciliada é conferida contra a
// geração do provedor e o mês inteiro só "fecha" se a divergência total ficar dentro da tolerância (padrão 1%) e NADA ficar sem prova.
// Falha fechada: geração não encontrada, leitura com erro, formato inesperado ou commit sem id de geração = "não verificado" = não fecha.
// Só leitura: nada aqui grava no ledger nem chama modelo (a consulta de geração é gratuita).
import type { BudgetGate } from './budget';
import type { ReconcileProbe } from './gateway';
import { microToUsd, usdToMicro } from './money';

export const OPENROUTER_GENERATION_URL = 'https://openrouter.ai/api/v1/generation';

export interface GenerationRecord {
  id: string;
  /** Custo cobrado pelo provedor, em US$. */
  costUsd: number;
  model?: string;
}

/** `null` = o provedor não conhece a geração (HTTP 404). Qualquer outra falha lança (e o chamador trata como "não verificado"). */
export type GenerationReader = (generationId: string) => Promise<GenerationRecord | null>;

export function createOpenRouterGenerationReader(key: string, fetchImpl: typeof fetch): GenerationReader {
  return async (generationId) => {
    const res = await fetchImpl(`${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(generationId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`leitura de geração: HTTP ${res.status}`); // a mensagem não traz a chave nem o id
    const json = (await res.json()) as { data?: { id?: unknown; total_cost?: unknown; model?: unknown } };
    const d = json.data;
    if (!d || typeof d.total_cost !== 'number' || !Number.isFinite(d.total_cost) || d.total_cost < 0) throw new Error('leitura de geração: formato inesperado');
    return { id: typeof d.id === 'string' ? d.id : generationId, costUsd: d.total_cost, ...(typeof d.model === 'string' ? { model: d.model } : {}) };
  };
}

/**
 * Sonda para `reconcilePending` de uma reserva pendente cujo id de geração se conhece: geração encontrada = cobrada (custo do provedor);
 * não encontrada ou leitura com erro = continua pendente. "Não cobrada" só vem de evidência humana/registrada, nunca da ausência de leitura.
 */
export function generationProbe(read: GenerationReader, generationId: string): ReconcileProbe {
  return async () => {
    try {
      const g = await read(generationId);
      if (!g) return { kind: 'unknown' };
      return { kind: 'charged', costUsd: g.costUsd, generationId };
    } catch {
      return { kind: 'unknown' };
    }
  };
}

export interface ReconcileItem {
  reservationId: string;
  generationId?: string;
  ledgerMicro: number;
  providerMicro?: number;
  reason?: string;
}

export interface MonthReconciliation {
  monthKey: string;
  toleranceMicroPct: number; // tolerância em % (ex.: 1 = 1%)
  /** Reservas conciliadas do mês. */
  committed: number;
  /** Conferidas com o provedor. */
  verified: number;
  ledgerMicro: number;
  providerMicro: number;
  /** |ledger − provedor| / provedor, em %, sobre o que foi conferido (0 se o provedor cobrou 0 e o ledger também). */
  divergencePct: number;
  /** Itens sem prova (sem id de geração, não encontrada, leitura com erro): o mês não fecha enquanto houver. */
  unverified: ReconcileItem[];
  /** Itens conferidos cuja diferença individual passa da tolerância. */
  mismatches: ReconcileItem[];
  /** Verdadeiro só com tudo conferido, divergência total ≤ tolerância e nenhum item fora dela. */
  closed: boolean;
}

/** Replay do mês: confere cada reserva conciliada com a geração do provedor. `tolerancePct` padrão 1. */
export async function reconcileMonth(gate: BudgetGate, read: GenerationReader, month: string, tolerancePct = 1): Promise<MonthReconciliation> {
  const states = await gate.committedOf(month);
  const unverified: ReconcileItem[] = [];
  const mismatches: ReconcileItem[] = [];
  let ledgerMicro = 0;
  let providerMicro = 0;
  let verified = 0;
  for (const s of states) {
    if (!s.generationId) {
      unverified.push({ reservationId: s.id, ledgerMicro: s.actualMicro, reason: 'commit sem id de geração (sem prova de cobrança)' });
      continue;
    }
    let g: Awaited<ReturnType<GenerationReader>>;
    try {
      g = await read(s.generationId);
    } catch (e) {
      unverified.push({ reservationId: s.id, generationId: s.generationId, ledgerMicro: s.actualMicro, reason: `leitura falhou: ${e instanceof Error ? e.message : 'erro'}` });
      continue;
    }
    if (!g) {
      unverified.push({ reservationId: s.id, generationId: s.generationId, ledgerMicro: s.actualMicro, reason: 'provedor não conhece a geração' });
      continue;
    }
    const p = usdToMicro(g.costUsd);
    verified += 1;
    ledgerMicro += s.actualMicro;
    providerMicro += p;
    const diff = Math.abs(s.actualMicro - p);
    if (diff > 0 && (p === 0 || (diff / p) * 100 > tolerancePct)) {
      mismatches.push({ reservationId: s.id, generationId: s.generationId, ledgerMicro: s.actualMicro, providerMicro: p, reason: 'custo do ledger difere do cobrado pelo provedor' });
    }
  }
  const totalDiff = Math.abs(ledgerMicro - providerMicro);
  const divergencePct = providerMicro === 0 ? (totalDiff === 0 ? 0 : 100) : (totalDiff / providerMicro) * 100;
  return {
    monthKey: month,
    toleranceMicroPct: tolerancePct,
    committed: states.length,
    verified,
    ledgerMicro,
    providerMicro,
    divergencePct,
    unverified,
    mismatches,
    closed: unverified.length === 0 && mismatches.length === 0 && divergencePct <= tolerancePct,
  };
}

/** Texto curto do resultado (CLI/Studio). */
export function describeReconciliation(r: MonthReconciliation): string {
  const head = `${r.monthKey}: ${r.closed ? 'FECHADO' : 'NÃO FECHA'} — ${r.verified}/${r.committed} conferidas, ledger US$ ${microToUsd(r.ledgerMicro).toFixed(6)} × provedor US$ ${microToUsd(r.providerMicro).toFixed(6)}, divergência ${r.divergencePct.toFixed(3)}% (tolerância ${r.toleranceMicroPct}%)`;
  const tail = [...(r.unverified.length ? [`${r.unverified.length} sem prova`] : []), ...(r.mismatches.length ? [`${r.mismatches.length} divergentes`] : [])];
  return tail.length ? `${head}; ${tail.join(', ')}` : head;
}
