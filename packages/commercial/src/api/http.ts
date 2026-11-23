// Tipos e utilitários HTTP-agnósticos dos handlers. O Backend traduz HttpResult para NextResponse; nada aqui importa Next.
import { z } from 'zod';
import { apiError, type ApiError } from '@ln/contracts';
import { CampaignError } from '../campaigns';
import { CrmError } from '../crm';
import { InventoryError } from '../inventory';
import { MetricError } from '../metrics';
import { ReportError } from '../report';
import type { CommercialCtx } from '../state';

export interface HttpResult<T = unknown> { status: number; body: T | ApiError }
export type Handler<I = unknown, O = unknown> = (ctx: CommercialCtx, input: I) => HttpResult<O>;

export const ok = <T>(body: T, status = 200): HttpResult<T> => ({ status, body });
export const fail = (status: number, code: string, message: string, details?: unknown): HttpResult<never> => ({ status, body: apiError(code, message, details) });
export const isError = (r: HttpResult): boolean => r.status >= 400;

const INVENTORY_STATUS: Record<InventoryError['code'], number> = {
  POSITION_UNKNOWN: 404, POSITION_NOT_CONFIGURED: 409, INVALID_PERIOD: 422, MIN_CONTRACT: 422, NO_SLOT: 409, TAKEOVER_BLOCK: 409, TAKEOVER_CONFLICT: 409,
};
const CAMPAIGN_STATUS: Record<CampaignError['code'], number> = {
  BAD_TRANSITION: 409, NO_RESERVATION: 422, INVALID_RESERVATION: 422, NOT_FOUND: 404, NO_APPROVED_CREATIVE: 422,
  SALE_NOT_ENABLED: 409, FORMAT_NOT_AVAILABLE: 409, NO_CONFIRMED_RESERVATION: 409,
  NO_POSITIONS: 422, POSITION_NOT_IN_CAMPAIGN: 422, BAD_STATE: 409,
};
const CRM_STATUS: Record<CrmError['code'], number> = {
  INVALID_LEAD: 422, NOT_FOUND: 404, BAD_STAGE: 409, LOST_REASON_REQUIRED: 422,
  INVALID_ACCOUNT: 422, DUPLICATE_ACCOUNT: 409, INVALID_CONTACT: 422, DUPLICATE_CONTACT: 409,
};

/** Valida a entrada com zod e executa; erros de domínio viram o envelope ApiError. Nenhuma exceção escapa. */
export function define<S extends z.ZodType, O>(
  opts: { schema: S; auth: 'public' | 'studio' },
  run: (ctx: CommercialCtx, input: z.output<S>) => HttpResult<O>,
): Handler<unknown, O> {
  return (ctx, raw) => {
    if (opts.auth === 'studio') {
      if (!ctx.actor) return fail(401, 'UNAUTHENTICATED', 'Autenticação obrigatória.');
      if (!ctx.actor.canManageCommercial) return fail(403, 'FORBIDDEN', 'Sem permissão para o módulo comercial.');
    }
    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) return fail(400, 'VALIDATION_ERROR', 'Entrada inválida.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    try {
      return run(ctx, parsed.data);
    } catch (e) {
      if (e instanceof InventoryError) return fail(INVENTORY_STATUS[e.code], e.code, e.message);
      if (e instanceof CampaignError) return fail(CAMPAIGN_STATUS[e.code], e.code, e.message);
      if (e instanceof CrmError) return fail(CRM_STATUS[e.code], e.code, e.message);
      if (e instanceof MetricError) return fail(422, e.code, e.message);
      if (e instanceof ReportError) return fail(422, e.code, e.message);
      return fail(500, 'INTERNAL_ERROR', 'Erro interno no módulo comercial.'); // sem vazar detalhes
    }
  };
}
