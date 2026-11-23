// MOCK — gateway de modelos SIMULADO. Espelha o catálogo do modelops para as tarefas sociais (determinísticas) e
// falha fechado para qualquer outra. Nunca chama modelo, nunca gasta orçamento.
import type { GatewayDecision, GatewayRequest, ModelGatewayPort } from './gateway';

const DETERMINISTIC = new Set(['creative_composition', 'social_publish']);

export class SimulatedGateway implements ModelGatewayPort {
  readonly MOCK = true as const;
  readonly calls: GatewayRequest[] = [];
  /** Simula o kill switch global do modelops. */
  killGlobal = false;

  async decide(req: GatewayRequest): Promise<GatewayDecision> {
    this.calls.push(req);
    if (this.killGlobal) return { status: 'blocked', reason: 'kill_global' };
    if (DETERMINISTIC.has(req.task)) return { status: 'deterministic' };
    return { status: 'blocked', reason: 'unknown_task', detail: req.task };
  }
}
