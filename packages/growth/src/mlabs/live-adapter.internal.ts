// INTERNO: não reexportado pelo índice nem por subpath. Só `createSocialPublisher` chama `buildLiveAdapter`, e no mesmo
// passo minta e vincula a capability de escrita. Fora do pacote não existe como obter este adaptador.
import type { MlabsChannel, PostLimits, PostPayload, PublishReceipt } from './port';
import type { MlabsAdapter } from './adapter-types.internal';
import { LIVE_ACK, LiveAdapterRefused, readOnlyTransport, type LiveOptions, type McpTransport } from './live';
import type { MediaUploadPort, PutBytes } from '../pipeline/raster-upload';
import { buildLiveMediaPort } from './media-port.internal';
import { WriteGate, type WriteCapability } from './write-gate.internal';

class LiveMlabsAdapter implements MlabsAdapter {
  readonly mode = 'live' as const;
  readonly #transport: McpTransport;
  readonly #actor: LiveOptions['actor'];
  readonly #flags: LiveOptions['flags'];
  readonly #mapper: LiveOptions['payloadMapper'];
  readonly #gate = new WriteGate();

  constructor(opts: LiveOptions) {
    this.#transport = opts.transport;
    this.#actor = Object.freeze({ ...opts.actor });
    this.#flags = opts.flags;
    this.#mapper = opts.payloadMapper;
  }

  bindWriteAuthority(cap: WriteCapability): void {
    this.#gate.bind(cap);
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

  async createPost(cap: WriteCapability, payload: PostPayload, idempotencyKey: string): Promise<PublishReceipt> {
    this.#gate.assert(cap); // 1º: só o publicador vinculado escreve
    this.#guard();
    const mapper = this.#mapper;
    if (!mapper) {
      throw new LiveAdapterRefused('mapeamento_ausente', 'mapeamento de create_post não definido (depende de R1-05/R5-02; não validado)');
    }
    const { tool, args } = mapper.create(payload, idempotencyKey);
    const raw = await this.#transport.call(tool, args);
    return mapper.toReceipt(raw, payload, idempotencyKey);
  }

  mediaUploadPort(cap: WriteCapability, putBytes?: PutBytes): MediaUploadPort {
    this.#gate.assert(cap);
    this.#guard();
    return buildLiveMediaPort({ transport: this.#transport, guard: () => this.#guard(), putBytes });
  }

  async updatePost(cap: WriteCapability): Promise<PublishReceipt> {
    this.#gate.assert(cap);
    this.#guard();
    throw new LiveAdapterRefused('capacidade_nao_confirmada', 'updatePost real não implementado: capacidade de edição não confirmada (R5-02)');
  }

  async deletePost(cap: WriteCapability): Promise<PublishReceipt> {
    this.#gate.assert(cap);
    this.#guard();
    throw new LiveAdapterRefused('capacidade_nao_confirmada', 'deletePost real não implementado: capacidade de exclusão não confirmada (R5-02)');
  }
}

/**
 * Cria o adaptador real. Recusa (lança `LiveAdapterRefused`) se faltar qualquer uma das três condições: `liveAck`,
 * ator `publisher_social` e flag `growth_linkedin_live` ligada no momento da criação.
 */
export function buildLiveAdapter(opts: LiveOptions): MlabsAdapter {
  if (opts.liveAck !== LIVE_ACK) throw new LiveAdapterRefused('live_ack_ausente');
  if (opts.actor?.role !== 'publisher_social') throw new LiveAdapterRefused('identidade_nao_autorizada');
  if (opts.flags().growth_linkedin_live !== true) throw new LiveAdapterRefused('flag_desligada');
  return new LiveMlabsAdapter(opts);
}
