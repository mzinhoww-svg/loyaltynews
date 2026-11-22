/**
 * Porta do gateway de modelos. A implementação real vive em packages/modelops (Backend + FinOps) e é a ÚNICA
 * via de chamada a modelos tarifados. Este pacote nunca importa SDK de provedor nem faz fetch a APIs de modelo.
 * Alinhado a ADR-015 (degraus de orçamento) e model.policy.json (rotas economy/review/premium).
 */

export type TaskClass = 'triage' | 'context' | 'draft' | 'factcheck' | 'review' | 'social_pack';
export type RouteClass = 'economy' | 'review' | 'premium';
/** Workflow que origina a chamada; o gateway usa para aplicar a reserva de auditoria (ADR-015). */
export type WorkflowId = 'WF01' | 'WF02' | 'WF04' | 'WF08' | 'WF18';

export interface GatewayRequest {
  taskClass: TaskClass;
  route: RouteClass;
  workflow: WorkflowId;
  /** Idempotência: mesma chave não gera nova cobrança nem nova reserva. */
  idempotencyKey: string;
  promptVersion: string;
  /** Somente conteúdo público saneado (classe de dado 'public'). Dados pessoais/sigilosos são proibidos aqui. */
  dataClass: 'public';
  /** Provedores que NÃO podem atender (fact-check independente do redator). */
  excludeProviders: string[];
  input: unknown;
}

export type RefusalCode =
  | 'budget_exhausted' | 'budget_step_blocked' | 'kill_switch' | 'unknown_rate' | 'model_disabled'
  | 'no_independent_provider' | 'restricted_data';

export type GatewayResponse =
  | { ok: true; provider: string; model: string; output: unknown; usage: { inputTokens: number; outputTokens: number; costMicrosUsd: number } }
  | { ok: false; refusal: RefusalCode; detail?: string };

export interface ModelGateway {
  invoke(req: GatewayRequest): Promise<GatewayResponse>;
}

/** Gateway padrão: recusa tudo. Garante que, sem modelops homologado, nenhuma chamada tarifada ocorre. */
export class RefusingGateway implements ModelGateway {
  async invoke(): Promise<GatewayResponse> {
    return { ok: false, refusal: 'model_disabled', detail: 'sem gateway configurado (R2-07/08 pendentes)' };
  }
}
