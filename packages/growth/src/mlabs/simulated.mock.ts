// MOCK — adaptador simulado do mLabs. INTERNO: só `createSocialPublisher` o instancia; não é exportado pelo pacote. É o padrão: nada sai do processo, nada é enviado ao mLabs.
// Os canais e limites abaixo são dados de TESTE, não refletem a conta real (ver docs/mlabs-capabilities.md).
import type {
  MlabsChannel,
  PostLimits,
  PostPayload,
  PublishReceipt,
} from './port';
import type { MlabsAdapter } from './adapter-types.internal';
import { WriteGate, type WriteCapability } from './write-gate.internal';

export class SimulatedMlabsAdapter implements MlabsAdapter {
  readonly mode = 'simulated' as const;
  readonly MOCK = true as const;
  private seq = 0;
  private readonly posts = new Map<string, { payload: PostPayload; receipt: PublishReceipt }>();
  private readonly now: () => string;
  readonly #gate = new WriteGate();

  constructor(now: () => string = () => new Date().toISOString()) {
    this.now = now;
  }

  bindWriteAuthority(cap: WriteCapability): void {
    this.#gate.bind(cap);
  }

  async listChannels(): Promise<MlabsChannel[]> {
    return [{ id: 'MOCK-linkedin-1', network: 'linkedin', name: 'MOCK — página de teste' }];
  }

  async getPostLimits(): Promise<PostLimits> {
    return { raw: { MOCK: true, note: 'limites simulados; confira com get_post_limits real' } };
  }

  async listTemplates(): Promise<unknown[]> {
    return [];
  }

  async createPost(cap: WriteCapability, payload: PostPayload, idempotencyKey: string): Promise<PublishReceipt> {
    this.#gate.assert(cap);
    this.seq += 1;
    const receipt: PublishReceipt = {
      id: `SIM-${String(this.seq).padStart(6, '0')}`,
      channel: payload.channel,
      mode: 'simulated',
      simulated: true,
      createdAt: this.now(),
      status: 'draft', // o fluxo é só rascunho: nada agenda nem publica
      idempotencyKey,
    };
    this.posts.set(receipt.id, { payload: structuredClone(payload), receipt });
    return receipt;
  }

  async updatePost(
    cap: WriteCapability,
    receiptId: string,
    patch: Partial<Pick<PostPayload, 'text' | 'scheduleAt'>>,
  ): Promise<PublishReceipt> {
    this.#gate.assert(cap);
    const entry = this.posts.get(receiptId);
    if (!entry) throw new Error(`post simulado inexistente: ${receiptId}`);
    entry.payload = { ...entry.payload, ...patch };
    entry.receipt = { ...entry.receipt, status: 'edited' };
    return entry.receipt;
  }

  async deletePost(cap: WriteCapability, receiptId: string): Promise<PublishReceipt> {
    this.#gate.assert(cap);
    const entry = this.posts.get(receiptId);
    if (!entry) throw new Error(`post simulado inexistente: ${receiptId}`);
    entry.receipt = { ...entry.receipt, status: 'deleted' };
    return entry.receipt;
  }

  /** Só para testes: o que teria sido enviado. */
  inspect(receiptId: string): PostPayload | undefined {
    return this.posts.get(receiptId)?.payload;
  }

  get count(): number {
    return this.posts.size;
  }
}
