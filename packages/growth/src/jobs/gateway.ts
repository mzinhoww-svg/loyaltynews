// Porta do gateway de modelos (packages/modelops, Frente 11), no formato mínimo que o Growth precisa.
// O gateway real expõe `route(policy, request)` e `callModel(deps, call)`; quando o pacote @ln/modelops for mesclado,
// um adaptador fino mapeia `route()` para `decide()`. Até lá, o Growth só conhece esta porta e uma versão SIMULADA.

export interface GatewayRequest {
  /** Id de tarefa do catálogo do modelops (ex.: `creative_composition`, `social_publish`). */
  task: string;
  dataClasses: readonly string[];
  /** Trabalho editorial ainda não publicado. */
  unpublished: boolean;
  mode: 'production' | 'simulation';
  now: Date;
}

export type GatewayDecision =
  | { status: 'deterministic' }
  | { status: 'blocked'; reason: string; detail?: string }
  | { status: 'model'; model: string };

export interface ModelGatewayPort {
  decide(req: GatewayRequest): Promise<GatewayDecision>;
}

/**
 * Tarefas do pacote social. No catálogo do modelops ambas são determinísticas (sem token): o job NÃO chama modelo.
 * O job pergunta ao gateway mesmo assim para respeitar kill switch e falhar fechado se o catálogo mudar.
 */
export const SOCIAL_PACKAGE_TASKS = ['creative_composition', 'social_publish'] as const;
