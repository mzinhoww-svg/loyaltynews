import type { GrowthFlags } from '../flags';
import type { Actor } from '../types';
import { READ_ONLY_TOOLS, type PostPayload, type PublishReceipt } from './port';

// Parte PÚBLICA do adaptador real: transporte somente-leitura, erro e a confirmação explícita. O adaptador em si
// (classe e construtor) vive em `live-adapter.internal.ts` e só é instanciado por `createSocialPublisher`.

/** Cliente MCP mínimo, injetado por quem tem a credencial (nunca criado aqui; sem segredo no código). */
export interface McpTransport {
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Transporte que só deixa passar ferramentas de LEITURA. Usado na validação de capacidades:
 * qualquer tentativa de escrita lança erro antes de tocar o mLabs.
 */
export function readOnlyTransport(inner: McpTransport): McpTransport {
  const allowed = new Set<string>(READ_ONLY_TOOLS);
  return {
    async call(tool, args) {
      if (!allowed.has(tool)) {
        throw new Error(`ferramenta mLabs fora da lista de leitura: ${tool}`);
      }
      return inner.call(tool, args);
    },
  };
}

/** Recusa do adaptador real: flag, identidade ou confirmação ausentes. Nada chegou ao transporte. */
export class LiveAdapterRefused extends Error {
  readonly reason: 'flag_desligada' | 'identidade_nao_autorizada' | 'live_ack_ausente' | 'mapeamento_ausente' | 'capacidade_nao_confirmada';
  constructor(reason: LiveAdapterRefused['reason'], message?: string) {
    super(message ?? `adaptador real recusou: ${reason}`);
    this.name = 'LiveAdapterRefused';
    this.reason = reason;
  }
}

export const LIVE_ACK = 'I_UNDERSTAND_THIS_PUBLISHES_FOR_REAL' as const;

/** Configuração do modo real do publicador. O transporte vai para campo privado e nunca é devolvido. */
export interface LiveOptions {
  /** Cliente MCP real. */
  transport: McpTransport;
  /** Confirmação explícita. */
  liveAck: typeof LIVE_ACK;
  /** Identidade sob a qual o adaptador opera. Só `publisher_social` (ADR-008). */
  actor: Actor;
  /**
   * Flags LIDAS A CADA OPERAÇÃO (função, não valor): desligar a flag em tempo de execução bloqueia a próxima
   * chamada. Sem `growth_linkedin_live` ligada, nada passa.
   */
  flags: () => GrowthFlags;
  /**
   * Mapeamento do payload para os argumentos reais de create_post.
   * Depende de R1-05/R5-02 (capacidades do mLabs ainda não validadas em escrita): NÃO inventado aqui.
   */
  payloadMapper?: {
    create(payload: PostPayload, idempotencyKey: string): { tool: string; args: Record<string, unknown> };
    toReceipt(raw: unknown, payload: PostPayload, idempotencyKey: string): PublishReceipt;
  };
}
