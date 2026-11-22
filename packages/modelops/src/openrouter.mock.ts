// MOCK: cliente simulado do OpenRouter. Nenhuma chamada de rede. Usado por padrão e nos testes.
// Respostas são sintéticas e marcadas com provider_name "SIMULADO": nunca são dado real.
import type { OpenRouterBody, OpenRouterClient, OpenRouterResponse } from './openrouter.ts';

export interface SimulatedOptions {
  failFirst?: number; // quantas chamadas falham antes de responder
  costUsd?: number; // custo informado em cada resposta
  omitGeneration?: boolean; // remove a evidência de geração
  responseModel?: string; // força o modelo que "respondeu" (para testar autor distinto)
}

export class SimulatedOpenRouterClient implements OpenRouterClient {
  readonly calls: OpenRouterBody[] = [];
  private failuresLeft: number;
  private readonly opts: SimulatedOptions;

  constructor(opts: SimulatedOptions = {}) {
    this.opts = opts;
    this.failuresLeft = opts.failFirst ?? 0;
  }

  async chat(body: OpenRouterBody): Promise<OpenRouterResponse> {
    this.calls.push(body);
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error('SIMULADO: falha de provedor');
    }
    const model = this.opts.responseModel ?? body.model;
    const cost = this.opts.costUsd ?? 0.5;
    const id = `sim-${this.calls.length}`;
    const response: OpenRouterResponse = {
      id,
      model,
      choices: [{ message: { content: 'SIMULADO' } }],
      usage: { cost, prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } },
    };
    if (!this.opts.omitGeneration) {
      response.generation = { model, provider_name: 'SIMULADO', total_cost: cost, upstream_id: id };
    }
    return response;
  }
}
