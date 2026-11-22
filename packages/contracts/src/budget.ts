import { z } from 'zod';
import { Id, IsoDateTime } from './common';

/** Teto agregado mensal das APIs tarifadas (D11/DP-04), em micros de USD. Imutável por agentes. */
export const HARD_MONTHLY_CAP_MICROUSD = 50_000_000 as const;

/** Degraus (DP-04): o que para em cada nível. */
export const BUDGET_STEPS_MICROUSD = {
  premiumStop: 35_000_000,
  alertNonEssentialStop: 40_000_000,
  auditErrataOnly: 42_000_000,
  hardStop: 50_000_000,
} as const;

/** Divisão provisória (DP-04), em micros de USD. Reserva de 8 exclusiva de auditoria e errata. */
export const BUDGET_ALLOCATION_MICROUSD = {
  openai: 20_000_000,
  anthropic: 22_000_000,
  anthropicEscalationSublimit: 5_000_000,
  images: 0,
  deepseek: 0,
  auditErrataReserve: 8_000_000,
} as const;

/** Mês contábil no fuso America/Sao_Paulo (AAAA-MM). */
export const MonthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Reserva atômica antes da chamada (ADR-006/015); conciliada pelo custo real depois. */
export const BudgetReservation = z
  .object({
    id: Id,
    taskId: Id,
    idempotencyKey: z.string().min(8),
    monthKey: MonthKey,
    route: z.string().min(1),
    provider: z.enum(['anthropic', 'openai', 'deepseek']),
    model: z.string().min(1),
    maxEstimatedMicrousd: z.number().int().nonnegative(),
    state: z.enum(['reservada', 'conciliada', 'liberada', 'recusada']),
    actualMicrousd: z.number().int().nonnegative().optional(),
    generationId: z.string().min(1).optional(),
    reservedAt: IsoDateTime,
  })
  .refine((r) => r.state !== 'conciliada' || (r.actualMicrousd !== undefined && r.generationId !== undefined), {
    message: 'reserva conciliada exige custo real e generation id',
    path: ['state'],
  });
export type BudgetReservation = z.infer<typeof BudgetReservation>;
