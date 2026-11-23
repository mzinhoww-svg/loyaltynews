import type { GatewayRequest, GatewayResponse, ModelGateway, RefusalCode, RouteClass, TaskClass, WorkflowId } from '../gateway';
import { buildMessages, estimateTokens, MAX_OUTPUT_TOKENS, parseModelJson } from './prompts';
import type { ChatMessage } from './prompts';

/**
 * Gateway LLM da fábrica: transforma a requisição do pipeline em mensagens de chat e a resposta de texto em JSON.
 * A chamada em si (orçamento, roteamento, provedor) é de um `ChatTransport` — em produção, o adaptador de
 * `packages/modelops` na composição (apps/workers); este pacote não importa modelops nem faz rede.
 */

export interface ChatRequest {
  taskClass: TaskClass; route: RouteClass; workflow: WorkflowId; idempotencyKey: string; promptVersion: string;
  /** Provedores que NÃO podem responder (checagem independente do redator). */
  excludeProviders: string[];
  messages: ChatMessage[];
  estimate: { promptTokens: number; maxOutputTokens: number };
}
export type ChatResult =
  | { ok: true; provider: string; model: string; text: string; usage: { inputTokens: number; outputTokens: number; costMicrosUsd: number } }
  | { ok: false; refusal: RefusalCode; detail?: string };
export interface ChatTransport { chat(req: ChatRequest): Promise<ChatResult> }

export function createLlmGateway(transport: ChatTransport): ModelGateway {
  return {
    async invoke(req: GatewayRequest): Promise<GatewayResponse> {
      const messages = buildMessages(req);
      const r = await transport.chat({
        taskClass: req.taskClass, route: req.route, workflow: req.workflow, idempotencyKey: req.idempotencyKey, promptVersion: req.promptVersion,
        excludeProviders: req.excludeProviders, messages, estimate: { promptTokens: estimateTokens(messages), maxOutputTokens: MAX_OUTPUT_TOKENS[req.taskClass] },
      });
      if (!r.ok) return r;
      // Texto que não é JSON de objeto vira `null`: o estágio recusa como invalid_model_output (nunca presumimos o conteúdo).
      return { ok: true, provider: r.provider, model: r.model, output: parseModelJson(r.text), usage: r.usage };
    },
  };
}
