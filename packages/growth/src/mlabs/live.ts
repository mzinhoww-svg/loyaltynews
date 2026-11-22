import type { GrowthFlags } from '../flags';
import type { Actor } from '../types';
import {
  READ_ONLY_TOOLS,
  type MlabsAdapter,
  type MlabsChannel,
  type PostLimits,
  type PostPayload,
  type PublishReceipt,
} from './port';

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

export interface LiveOptions {
  /** Cliente MCP real. Fica em campo privado (#) do adaptador: nunca é exposto nem devolvido. */
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

// Token de módulo: só `createLiveMlabsAdapter` o possui. Sem ele, o construtor lança (TypeScript `private` some em
// tempo de execução; o token garante a fronteira também em JavaScript).
const FACTORY_TOKEN = Symbol('live-mlabs-adapter-factory');

/**
 * Adaptador real do mLabs. NÃO é exportado como classe (nem do módulo nem do índice do pacote): a única forma de
 * obtê-lo é `createLiveMlabsAdapter`, que exige as TRÊS condições (liveAck, identidade publisher_social e flag
 * ligada). A flag e a identidade são conferidas aqui dentro, na criação e antes de CADA leitura/escrita, e o
 * transporte cru nunca sai do objeto.
 */
class LiveMlabsAdapter implements MlabsAdapter {
  readonly mode = 'live' as const;
  readonly #transport: McpTransport;
  readonly #actor: Actor;
  readonly #flags: () => GrowthFlags;
  readonly #mapper: LiveOptions['payloadMapper'];

  private constructor(token: symbol, opts: LiveOptions) {
    if (token !== FACTORY_TOKEN) {
      throw new LiveAdapterRefused('identidade_nao_autorizada', 'use createLiveMlabsAdapter');
    }
    this.#transport = opts.transport;
    this.#actor = Object.freeze({ ...opts.actor });
    this.#flags = opts.flags;
    this.#mapper = opts.payloadMapper;
  }

  static create(opts: LiveOptions): LiveMlabsAdapter {
    return new LiveMlabsAdapter(FACTORY_TOKEN, opts);
  }

  /** Confere as condições antes de qualquer chamada ao transporte. */
  #guard(): void {
    if (this.#actor.role !== 'publisher_social') throw new LiveAdapterRefused('identidade_nao_autorizada');
    if (this.#flags().growth_linkedin_live !== true) throw new LiveAdapterRefused('flag_desligada');
  }

  async listChannels(): Promise<MlabsChannel[]> {
    this.#guard();
    const raw = await readOnlyTransport(this.#transport).call('list_channels', {});
    return Array.isArray(raw) ? (raw as MlabsChannel[]) : [];
  }

  async getPostLimits(channelId?: string): Promise<PostLimits> {
    this.#guard();
    const raw = await readOnlyTransport(this.#transport).call('get_post_limits', channelId ? { channelId } : {});
    return { raw };
  }

  async listTemplates(): Promise<unknown[]> {
    this.#guard();
    const raw = await readOnlyTransport(this.#transport).call('list_templates', {});
    return Array.isArray(raw) ? raw : [];
  }

  async createPost(payload: PostPayload, idempotencyKey: string): Promise<PublishReceipt> {
    this.#guard();
    const mapper = this.#mapper;
    if (!mapper) {
      throw new LiveAdapterRefused('mapeamento_ausente', 'mapeamento de create_post não definido (depende de R1-05/R5-02; não validado)');
    }
    const { tool, args } = mapper.create(payload, idempotencyKey);
    const raw = await this.#transport.call(tool, args);
    return mapper.toReceipt(raw, payload, idempotencyKey);
  }

  async updatePost(): Promise<PublishReceipt> {
    this.#guard();
    throw new LiveAdapterRefused('capacidade_nao_confirmada', 'updatePost real não implementado: capacidade de edição não confirmada (R5-02)');
  }

  async deletePost(): Promise<PublishReceipt> {
    this.#guard();
    throw new LiveAdapterRefused('capacidade_nao_confirmada', 'deletePost real não implementado: capacidade de exclusão não confirmada (R5-02)');
  }
}

/**
 * Única fábrica do adaptador real. Recusa (lança `LiveAdapterRefused`) se faltar qualquer uma das três condições:
 * `liveAck`, ator `publisher_social` e flag `growth_linkedin_live` ligada no momento da criação.
 * Nenhum fluxo padrão a chama; o padrão do produto é o adaptador simulado.
 */
export function createLiveMlabsAdapter(opts: LiveOptions): MlabsAdapter {
  if (opts.liveAck !== LIVE_ACK) throw new LiveAdapterRefused('live_ack_ausente');
  if (opts.actor?.role !== 'publisher_social') throw new LiveAdapterRefused('identidade_nao_autorizada');
  if (opts.flags().growth_linkedin_live !== true) throw new LiveAdapterRefused('flag_desligada');
  return LiveMlabsAdapter.create(opts);
}
