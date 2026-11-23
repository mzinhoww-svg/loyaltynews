import { apiError, type ApiError } from '@ln/contracts';
import { z } from 'zod';
import {
  buildReport, dayOf, DEFAULT_K, emptyReport, METHODOLOGY_VERSION, RETENTION_DAYS, SOURCE, type AggregateStore, type AnalyticsReport,
} from './aggregate';
import { optedOutBySignal, type PrivacyPolicyState, type PrivacySignals } from './consent';
import { classifyReferrer, CollectEventSchema, deviceClass, normalizePath } from './event';

// Handlers PUROS da medição do portal. Sem Next, sem relógio global, sem I/O próprio. A rota HTTP (Backend/Frontend) só
// adapta Request/Response. A assinatura da coleta NÃO recebe IP, cabeçalhos, cookies nem user agent: quem os tem é a camada
// HTTP, que não deve registrá-los (ver docs/DECISAO). Aqui só chegam o corpo e dois sinais booleanos de privacidade.

export interface AnalyticsFlags {
  /** `analytics` de @ln/contracts (desligada por padrão). */
  analytics: boolean;
}

export interface AnalyticsDeps {
  store: AggregateStore;
  flags: () => AnalyticsFlags;
  /** Política de privacidade vigente. Sem versão publicada, a coleta é recusada (falha fechada). */
  policy: () => PrivacyPolicyState;
  now: () => Date;
  /** Hosts do próprio portal (referência interna). */
  ownHosts: readonly string[];
  k?: number;
}

export interface HandlerResult<T> {
  status: number;
  body: T | ApiError;
}

const ok = <T>(status: number, body: T): HandlerResult<T> => ({ status, body });
const fail = (status: number, code: string, message: string, details?: unknown): HandlerResult<never> => ({
  status,
  body: apiError(code, message, details),
});

export const MAX_BODY_BYTES = 1024;

export interface CollectRequest {
  /** Corpo cru (JSON). */
  body: string;
  /** Só booleanos derivados dos cabeçalhos Sec-GPC e DNT. */
  signals?: PrivacySignals;
}

export interface CollectOutcome {
  counted: boolean;
  reason?: 'sinal_de_privacidade';
}

/**
 * Conta uma visualização de página no agregado. 204 em sucesso e quando o sinal de privacidade pede para não medir
 * (nada é contado); 404 com a flag desligada (sem efeito); 503 sem política publicada (sem efeito); 413/400 em corpo inválido.
 * Nunca ecoa o conteúdo recebido nas respostas.
 */
export async function handleCollect(deps: AnalyticsDeps, req: CollectRequest): Promise<HandlerResult<CollectOutcome>> {
  if (!deps.flags().analytics) return fail(404, 'ANALYTICS_OFF', 'medição desligada');
  if (!deps.policy().currentVersion) return fail(503, 'POLICY_UNPUBLISHED', 'sem política de privacidade publicada: medição indisponível');
  if (typeof req.body !== 'string' || Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) {
    return fail(413, 'PAYLOAD_TOO_LARGE', 'corpo grande demais');
  }
  if (optedOutBySignal(req.signals)) return ok(204, { counted: false, reason: 'sinal_de_privacidade' });

  let json: unknown;
  try {
    json = JSON.parse(req.body);
  } catch {
    return fail(400, 'VALIDATION_ERROR', 'corpo não é JSON');
  }
  const p = CollectEventSchema.safeParse(json);
  if (!p.success) {
    // Só os NOMES dos campos problemáticos; nunca os valores.
    const fields = [...new Set(p.error.issues.flatMap((i) => (i.code === 'unrecognized_keys' ? ['(campo não permitido)'] : [i.path.join('.') || '(raiz)'])))];
    return fail(400, 'VALIDATION_ERROR', 'evento inválido', fields);
  }
  const path = normalizePath(p.data.path);
  if (!path) return fail(400, 'VALIDATION_ERROR', 'evento inválido', ['path']);

  await deps.store.increment({
    day: dayOf(deps.now()),
    path,
    ref: classifyReferrer(p.data.ref, deps.ownHosts),
    device: deviceClass(p.data.w),
  });
  return ok(204, { counted: true });
}

export interface Caller {
  id: string;
  permissions: readonly string[];
}

export const ANALYTICS_PERMISSIONS = { read: 'analytics:read' } as const;

const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ReportQuerySchema = z.object({ from: DaySchema, to: DaySchema });
export const MAX_REPORT_DAYS = 400;

/**
 * Relatório agregado de um período. Exige `analytics:read`. Com a coleta desligada, ou sem dados, devolve `unavailable`
 * com o motivo e `totalViews: null`: nunca um zero que pareça medição (Blueprint: jamais números fictícios).
 */
export async function getAnalyticsReport(deps: AnalyticsDeps, caller: Caller, rawQuery: unknown): Promise<HandlerResult<AnalyticsReport>> {
  if (!caller.permissions.includes(ANALYTICS_PERMISSIONS.read)) return fail(403, 'FORBIDDEN', 'sem permissão analytics:read');
  const q = ReportQuerySchema.safeParse(rawQuery);
  if (!q.success) return fail(400, 'VALIDATION_ERROR', 'período inválido', q.error.issues.map((i) => i.path.join('.')));
  const { from, to } = q.data;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) return fail(400, 'VALIDATION_ERROR', 'período invertido', ['to']);
  if (days > MAX_REPORT_DAYS) return fail(400, 'VALIDATION_ERROR', `período maior que ${MAX_REPORT_DAYS} dias`, ['to']);

  const fetchedAt = deps.now().toISOString();
  const k = deps.k ?? DEFAULT_K;
  if (!deps.flags().analytics) return ok(200, emptyReport({ from, to, fetchedAt, reason: 'coleta desligada (flag)', k }));
  return ok(200, buildReport(await deps.store.rows(from, to), { from, to, fetchedAt, k }));
}

/** Aplica a retenção dos agregados (padrão ~26 meses). Devolve quantas linhas apagou. */
export async function applyRetention(deps: Pick<AnalyticsDeps, 'store' | 'now'>, days: number = RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - days * 86_400_000);
  return deps.store.purgeBefore(dayOf(cutoff));
}

export { METHODOLOGY_VERSION, SOURCE };
