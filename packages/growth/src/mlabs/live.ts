import {
  READ_ONLY_TOOLS,
  type MlabsAdapter,
  type MlabsChannel,
  type PostLimits,
  type PostPayload,
  type PublishReceipt,
} from './port.ts';

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

export interface LiveOptions {
  transport: McpTransport;
  /** Confirmação explícita; sem ela o construtor recusa (o padrão do produto é o simulado). */
  liveAck: 'I_UNDERSTAND_THIS_PUBLISHES_FOR_REAL';
  /**
   * Mapeamento do payload para os argumentos reais de create_post/update_post/delete_post.
   * Depende de R1-05/R5-02 (capacidades do mLabs ainda não validadas em escrita): NÃO inventado aqui.
   */
  payloadMapper?: {
    create(payload: PostPayload, idempotencyKey: string): { tool: string; args: Record<string, unknown> };
    toReceipt(raw: unknown, payload: PostPayload, idempotencyKey: string): PublishReceipt;
  };
}

/** Adaptador real. Não é instanciado por nenhum fluxo padrão; só após gate R5-02 e a flag de publicação. */
export class LiveMlabsAdapter implements MlabsAdapter {
  readonly mode = 'live' as const;
  private readonly opts: LiveOptions;

  constructor(opts: LiveOptions) {
    if (opts.liveAck !== 'I_UNDERSTAND_THIS_PUBLISHES_FOR_REAL') {
      throw new Error('LiveMlabsAdapter exige liveAck explícito');
    }
    this.opts = opts;
  }

  async listChannels(): Promise<MlabsChannel[]> {
    const raw = await readOnlyTransport(this.opts.transport).call('list_channels', {});
    return Array.isArray(raw) ? (raw as MlabsChannel[]) : [];
  }

  async getPostLimits(channelId?: string): Promise<PostLimits> {
    const raw = await readOnlyTransport(this.opts.transport).call(
      'get_post_limits',
      channelId ? { channelId } : {},
    );
    return { raw };
  }

  async listTemplates(): Promise<unknown[]> {
    const raw = await readOnlyTransport(this.opts.transport).call('list_templates', {});
    return Array.isArray(raw) ? raw : [];
  }

  async createPost(payload: PostPayload, idempotencyKey: string): Promise<PublishReceipt> {
    const mapper = this.opts.payloadMapper;
    if (!mapper) {
      throw new Error('mapeamento de create_post não definido (depende de R1-05/R5-02; não validado)');
    }
    const { tool, args } = mapper.create(payload, idempotencyKey);
    const raw = await this.opts.transport.call(tool, args);
    return mapper.toReceipt(raw, payload, idempotencyKey);
  }

  async updatePost(): Promise<PublishReceipt> {
    throw new Error('updatePost real não implementado: capacidade de edição não confirmada (R5-02)');
  }

  async deletePost(): Promise<PublishReceipt> {
    throw new Error('deletePost real não implementado: capacidade de exclusão não confirmada (R5-02)');
  }
}
