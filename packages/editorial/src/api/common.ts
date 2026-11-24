import type { z } from 'zod';
import { apiError } from '@ln/contracts';
import type { ApiError } from '@ln/contracts';
import type { JobQueue } from '../pipeline/queue';
import type { SourceRegistry } from '../sources/registry';
import type { EditorialStore } from './store';
import type { PublishedArticleLookup } from './published-lookup';

/** Tipos e utilitários comuns dos handlers (contexto, RBAC por papel de @ln/auth, envelope de resposta, auditoria). */

export interface Actor { userId: string; roles: readonly string[]; mfa: boolean }
export interface HandlerCtx {
  actor: Actor | null;
  store: EditorialStore;
  now: () => Date;
  newId: () => string;
  /** Opcional: só `requestRecheck` usa. A fila apenas enfileira; o gateway de modelos fica no worker. */
  queue?: JobQueue;
  /** Cadastro de fontes (imutável). Necessário aos handlers de fontes. */
  sources?: SourceRegistry;
  /** Consulta de matérias publicadas (ADR-019 §c): âncora dos casos de correção/resposta. Obrigatória para abrir caso. */
  published?: PublishedArticleLookup;
  /** URL base do portal (ex.: https://loyaltynews.example), para montar /noticia/{slug} na preservação de evidência. */
  siteBaseUrl?: string;
}
export interface ApiResponse<T> { status: number; body: T | ApiError }

// ---------- autorização (RBAC) ----------
export type Action =
  | 'queue.list' | 'article.read' | 'article.review' | 'factcheck.read' | 'factcheck.recheck'
  | 'correction.list' | 'correction.manage' | 'correction.verify_requester' | 'correction.ack_legal'
  | 'source.read' | 'source.review' | 'source.enable' | 'source.disable' | 'pauta.read' | 'pauta.submit' | 'piloto.read' | 'piloto.map' | 'piloto.leitura' | 'piloto.import';

/** Papéis de @ln/auth (stub do scaffold): admin, editor_chefe, editor, revisor, comercial, leitor. `comercial`/`leitor` não têm acesso editorial. */
export const ACTION_ROLES: Readonly<Record<Action, readonly string[]>> = {
  'queue.list': ['admin', 'editor_chefe', 'editor', 'revisor'],
  'article.read': ['admin', 'editor_chefe', 'editor', 'revisor'],
  'article.review': ['admin', 'editor_chefe', 'revisor'],
  'factcheck.read': ['admin', 'editor_chefe', 'editor', 'revisor'],
  'factcheck.recheck': ['admin', 'editor_chefe', 'revisor'],
  'correction.list': ['admin', 'editor_chefe', 'editor', 'revisor'],
  'correction.manage': ['admin', 'editor_chefe'],
  'correction.verify_requester': ['admin', 'editor_chefe'],
  // Ciência do caso jurídico = ato do responsável (nível admin); agente/editor não decide caso jurídico.
  'correction.ack_legal': ['admin'],
  'source.read': ['admin', 'editor_chefe', 'editor', 'revisor'],
  // Revisar termos/URL e habilitar são atos humanos; desabilitar (kill) é permitido a mais papéis, por segurança.
  'source.review': ['admin', 'editor_chefe', 'revisor'],
  'source.enable': ['admin', 'editor_chefe'],
  'source.disable': ['admin', 'editor_chefe', 'revisor'],
  // Pauta autoral (DP-29): quem propõe é a redação; revisor lê. A aprovação da matéria segue o fluxo de revisão comum.
  'pauta.read': ['admin', 'editor_chefe', 'editor', 'revisor'],
  'pauta.submit': ['admin', 'editor_chefe', 'editor'],
  // Piloto de 10 matérias: leitor 1 = proprietário (admin/editor_chefe), leitor 2 = revisor (QA 3); o fino está em pilot-handlers.
  'piloto.read': ['admin', 'editor_chefe', 'editor', 'revisor'],
  'piloto.map': ['admin', 'editor_chefe'],
  'piloto.leitura': ['admin', 'editor_chefe', 'revisor'],
  // Importação da folha do leitor 2 (lida fora do Studio): quem importa é o leitor 1 (proprietário).
  'piloto.import': ['admin', 'editor_chefe'],
};

export function authorize(ctx: HandlerCtx, action: Action): ApiError | Actor {
  const a = ctx.actor;
  if (!a) return apiError('UNAUTHENTICATED', 'sessão ausente');
  if (!a.mfa) return apiError('MFA_REQUIRED', 'MFA obrigatório');
  if (!a.roles.some((r) => ACTION_ROLES[action].includes(r))) return apiError('FORBIDDEN', `papel sem permissão para ${action}`);
  return a;
}
export const isErr = (x: ApiError | Actor): x is ApiError => 'error' in x;
const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, MFA_REQUIRED: 401, FORBIDDEN: 403, INVALID_INPUT: 400, NOT_FOUND: 404, CONFLICT: 409, BLOCKED: 409, UNAVAILABLE: 503 };
export const fail = (e: ApiError): ApiResponse<never> => ({ status: STATUS[e.error.code] ?? 400, body: e });
export const ok = <T>(body: T, status = 200): ApiResponse<T> => ({ status, body });

export function parse<S extends z.ZodType>(schema: S, input: unknown): { data: z.infer<S> } | ApiError {
  const r = schema.safeParse(input);
  return r.success ? { data: r.data } : apiError('INVALID_INPUT', 'entrada inválida', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
}
export const bad = <T>(e: { data: T } | ApiError): e is ApiError => 'error' in e;
export const audit = async (ctx: HandlerCtx, userId: string | null, action: string, target: string, detail?: string) =>
  ctx.store.appendAudit({ at: ctx.now().toISOString(), userId, action, target, ...(detail ? { detail } : {}) });

