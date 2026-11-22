import { channelFlag, DEFAULT_FLAGS, type GrowthFlags } from '../flags.ts';
import { toPlainText, validateCopy, type MentionPlan } from '../copy/engine.ts';
import type { MlabsAdapter, PostPayload, PublishReceipt } from '../mlabs/port.ts';
import type { Actor, Article, Channel } from '../types.ts';

export interface AuditEntry {
  ts: string;
  actorId: string;
  actorRole: string;
  action: 'publish' | 'edit' | 'delete';
  channel: Channel;
  outcome: 'accepted' | 'refused';
  reason?: string;
  articleId?: string;
  receiptId?: string;
}

export class PublishRefused extends Error {
  readonly reason: string;
  constructor(reason: string, message?: string) {
    super(message ?? `publicação recusada: ${reason}`);
    this.name = 'PublishRefused';
    this.reason = reason;
  }
}

export interface PublishRequest {
  article: Article;
  channel: Channel;
  text: string;
  mentions?: MentionPlan[];
  /** Chave de idempotência (ex.: `${article.id}:${channel}:v1`). Reenvio com a mesma chave não duplica. */
  idempotencyKey: string;
  /** Imagem aprovada que acompanha o post. */
  imageRef?: string;
  scheduleAt?: string;
  /** Capacidade do mLabs para menção em texto: `false` força o fallback texto puro. */
  mentionsSupported?: boolean;
}

export interface PublisherOptions {
  adapter: MlabsAdapter;
  flags?: GrowthFlags;
  now?: () => string;
}

/**
 * Único caminho de publicação (ADR-008). Só a identidade `publisher_social` passa. Fluxo:
 * identidade → flag do canal → gates da matéria → imagem aprovada → regras de copy → idempotência → adaptador.
 * Toda recusa é registrada na auditoria. Com o adaptador simulado (padrão), nada vai ao mLabs.
 */
export class SocialPublisher {
  private readonly adapter: MlabsAdapter;
  private readonly flags: GrowthFlags;
  private readonly now: () => string;
  private readonly receipts = new Map<string, PublishReceipt>();
  readonly audit: AuditEntry[] = [];

  constructor(opts: PublisherOptions) {
    this.adapter = opts.adapter;
    this.flags = opts.flags ?? { ...DEFAULT_FLAGS };
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private refuse(
    actor: Actor,
    action: AuditEntry['action'],
    channel: Channel,
    reason: string,
    articleId?: string,
  ): never {
    this.audit.push({
      ts: this.now(),
      actorId: actor.id,
      actorRole: actor.role,
      action,
      channel,
      outcome: 'refused',
      reason,
      articleId,
    });
    throw new PublishRefused(reason);
  }

  private guard(actor: Actor, action: AuditEntry['action'], channel: Channel, articleId?: string): void {
    if (actor.role !== 'publisher_social') {
      this.refuse(actor, action, channel, 'identidade_nao_autorizada', articleId);
    }
    // Canais adiados: chave desligada → recusa, mesmo para a identidade de publicação.
    if (channel !== 'linkedin' && !this.flags[channelFlag(channel)]) {
      this.refuse(actor, action, channel, `canal_desligado:${channel}`, articleId);
    }
    // Adaptador real só com a flag de publicação ligada.
    if (this.adapter.mode === 'live' && !this.flags.growth_linkedin_live) {
      this.refuse(actor, action, channel, 'publicacao_real_desligada', articleId);
    }
  }

  async publish(actor: Actor, req: PublishRequest): Promise<PublishReceipt> {
    const { article, channel } = req;
    this.guard(actor, 'publish', channel, article.id);

    const existing = this.receipts.get(req.idempotencyKey);
    if (existing) return existing; // reenvio não duplica

    if (!article.gatesPassed) this.refuse(actor, 'publish', channel, 'gates_automaticos_pendentes', article.id);
    if (!article.approvedImage || !req.imageRef) {
      this.refuse(actor, 'publish', channel, 'sem_imagem_aprovada', article.id);
    }

    const mentions = req.mentions ?? [];
    const violations = validateCopy(req.text, article, mentions);
    if (violations.length) {
      this.refuse(actor, 'publish', channel, `copy_invalida:${violations.map((v) => v.rule).join('+')}`, article.id);
    }

    const useMentions = req.mentionsSupported === true && mentions.length > 0;
    const payload: PostPayload = {
      channel,
      text: useMentions ? req.text : toPlainText(req.text), // fallback texto puro
      imageRef: req.imageRef!,
      link: undefined,
      mentions: useMentions ? mentions.map((m) => ({ name: m.name, ref: m.ref })) : [],
      scheduleAt: req.scheduleAt,
    };
    const receipt = await this.adapter.createPost(payload, req.idempotencyKey);
    this.receipts.set(req.idempotencyKey, receipt);
    this.audit.push({
      ts: this.now(),
      actorId: actor.id,
      actorRole: actor.role,
      action: 'publish',
      channel,
      outcome: 'accepted',
      articleId: article.id,
      receiptId: receipt.id,
    });
    return receipt;
  }

  async edit(actor: Actor, channel: Channel, receiptId: string, text: string): Promise<PublishReceipt> {
    this.guard(actor, 'edit', channel);
    const r = await this.adapter.updatePost(receiptId, { text });
    this.audit.push({ ts: this.now(), actorId: actor.id, actorRole: actor.role, action: 'edit', channel, outcome: 'accepted', receiptId });
    return r;
  }

  async remove(actor: Actor, channel: Channel, receiptId: string): Promise<PublishReceipt> {
    this.guard(actor, 'delete', channel);
    const r = await this.adapter.deletePost(receiptId);
    this.audit.push({ ts: this.now(), actorId: actor.id, actorRole: actor.role, action: 'delete', channel, outcome: 'accepted', receiptId });
    return r;
  }
}

/** A identidade de publicação única do serviço. Redação/design/growth_agent nunca recebem este ator. */
export const PUBLISHER_SOCIAL: Actor = Object.freeze({ id: 'publisher_social', role: 'publisher_social' });
