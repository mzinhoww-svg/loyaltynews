import { channelFlag, DEFAULT_FLAGS, type GrowthFlags } from '../flags';
import { toPlainText, validateCopy, type MentionPlan } from '../copy/engine';
import type { MlabsAdapter } from '../mlabs/adapter-types.internal';
import type { LiveOptions } from '../mlabs/live';
import { buildLiveAdapter } from '../mlabs/live-adapter.internal';
import type { MlabsReadPort, PostPayload, PublishReceipt } from '../mlabs/port';
import { SimulatedMlabsAdapter } from '../mlabs/simulated.mock';
import { mintWriteCapability } from '../mlabs/write-gate.internal';
import type { UploadedMedia } from '../mlabs/create-post-draft';
import { MediaUploadError, MlabsRasterUploader, type PutBytes, type RasterizerPort, type UploadLedger } from '../pipeline/raster-upload';
import type { Actor, Article, Channel, CreativeAsset } from '../types';

export interface AuditEntry {
  ts: string;
  actorId: string;
  actorRole: string;
  action: 'publish' | 'edit' | 'delete' | 'upload_media';
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

type FlagSource = GrowthFlags | (() => GrowthFlags);

/** Envio de mídia do criativo (R5-02). Sem isto o publicador recusa `uploadMedia` (`rasterizador_ausente`). */
export interface MediaConfig {
  /** Rasterizador SVG→PNG (UI/UX: `rasterizeCreative`, que usa sharp e por isso é injetado, não importado aqui). */
  rasterizer: RasterizerPort;
  /** PUT dos bytes. Só testes injetam; o modo real usa `fetch` (HTTPS público, sem redirecionamento). */
  putBytes?: PutBytes;
  ledger?: UploadLedger;
  /** Idade máxima de uma entrada do registro de envios (padrão 24 h). */
  ledgerMaxAgeMs?: number;
  /** Só vale no modo simulado: no modo real, criativo mock nunca sobe. */
  allowMock?: boolean;
}

interface CommonConfig {
  /** Valor fixo ou função lida a cada operação. Padrão: tudo desligado. */
  flags?: FlagSource;
  now?: () => string;
  media?: MediaConfig;
}

/** Modo simulado (padrão do produto): nada sai do processo. */
export interface SimulatedPublisherConfig extends CommonConfig {
  mode: 'simulated';
}

/** Modo real: exige liveAck, ator `publisher_social` e flag `growth_linkedin_live` ligada (conferidos dentro do adaptador). */
export interface LivePublisherConfig extends CommonConfig {
  mode: 'live';
  transport: LiveOptions['transport'];
  liveAck: LiveOptions['liveAck'];
  actor: LiveOptions['actor'];
  /** Obrigatória no modo real, e lida a cada operação. */
  flags: () => GrowthFlags;
  payloadMapper?: LiveOptions['payloadMapper'];
}

export type PublisherConfig = SimulatedPublisherConfig | LivePublisherConfig;

/** Visão SOMENTE LEITURA do que o adaptador simulado recebeu. Existe apenas no modo simulado. */
export interface SimulatedView {
  readonly count: number;
  inspect(receiptId: string): PostPayload | undefined;
}

/**
 * Único caminho de publicação (ADR-008). O adaptador do mLabs é criado DENTRO de `createSocialPublisher`, junto com a
 * capability de escrita, e nunca sai de lá: o objeto devolvido não tem `createPost` nem referência ao adaptador.
 * Fluxo de `publish`: identidade → flag do canal → gates da matéria → imagem aprovada → regras de copy →
 * idempotência → adaptador. Toda recusa é registrada na auditoria.
 */
export interface SocialPublisher {
  readonly mode: 'simulated' | 'live';
  /** Cópia da trilha de auditoria (recusas e aceites). */
  readonly audit: readonly AuditEntry[];
  /** Leituras do mLabs (sem escrita). No modo real, passam pela guarda de flag e identidade do adaptador. */
  readonly reads: MlabsReadPort;
  /** Só no modo simulado. */
  readonly simulated?: SimulatedView;
  publish(actor: Actor, req: PublishRequest): Promise<PublishReceipt>;
  /**
   * Envia o criativo ao mLabs (SVG → PNG → prepare_media_upload → PUT → get_media_upload) e devolve o id da imagem para o rascunho.
   * É ESCRITA no mLabs: mesma identidade, mesma flag e mesma capability do `publish`; auditada; desligada por padrão.
   */
  uploadMedia(actor: Actor, asset: CreativeAsset, imageRef: string): Promise<UploadedMedia>;
  edit(actor: Actor, channel: Channel, receiptId: string, text: string): Promise<PublishReceipt>;
  remove(actor: Actor, channel: Channel, receiptId: string): Promise<PublishReceipt>;
}

/**
 * Cria o publicador e, no mesmo passo, o adaptador (simulado ou real) e a capability que só este publicador possui.
 * Não há outra forma de obter um adaptador com escrita: nem a classe, nem `mintWriteCapability`, nem `bindWriteAuthority`
 * são exportados pelo pacote (teste `public-surface.test.ts`).
 */
export function createSocialPublisher(config: PublisherConfig): SocialPublisher {
  const flagSource: FlagSource = config.flags ?? DEFAULT_FLAGS;
  const getFlags = (): GrowthFlags => (typeof flagSource === 'function' ? flagSource() : flagSource);
  const now = config.now ?? (() => new Date().toISOString());

  let adapter: MlabsAdapter;
  let simulatedView: SimulatedView | undefined;
  if (config.mode === 'simulated') {
    const sim = new SimulatedMlabsAdapter(now);
    adapter = sim;
    simulatedView = {
      get count() {
        return sim.count;
      },
      inspect: (id) => sim.inspect(id),
    };
  } else {
    adapter = buildLiveAdapter({
      transport: config.transport,
      liveAck: config.liveAck,
      actor: config.actor,
      flags: config.flags,
      payloadMapper: config.payloadMapper,
    });
  }
  const cap = mintWriteCapability();
  adapter.bindWriteAuthority(cap); // capability nova num adaptador recém-criado: sempre vincula

  let uploader: MlabsRasterUploader | undefined;
  const receipts = new Map<string, PublishReceipt>();
  const auditLog: AuditEntry[] = [];

  function refuse(actor: Actor, action: AuditEntry['action'], channel: Channel, reason: string, articleId?: string): never {
    auditLog.push({ ts: now(), actorId: actor.id, actorRole: actor.role, action, channel, outcome: 'refused', reason, articleId });
    throw new PublishRefused(reason);
  }

  function guard(actor: Actor, action: AuditEntry['action'], channel: Channel, articleId?: string): void {
    if (actor.role !== 'publisher_social') refuse(actor, action, channel, 'identidade_nao_autorizada', articleId);
    const flags = getFlags();
    // Canais adiados: chave desligada → recusa, mesmo para a identidade de publicação.
    if (channel !== 'linkedin' && !flags[channelFlag(channel)]) {
      refuse(actor, action, channel, `canal_desligado:${channel}`, articleId);
    }
    // Adaptador real só com a flag de publicação ligada.
    if (adapter.mode === 'live' && !flags.growth_linkedin_live) {
      refuse(actor, action, channel, 'publicacao_real_desligada', articleId);
    }
  }

  const reads: MlabsReadPort = Object.freeze({
    mode: adapter.mode,
    listChannels: () => adapter.listChannels(),
    getPostLimits: (channelId?: string) => adapter.getPostLimits(channelId),
    listTemplates: () => adapter.listTemplates(),
  });

  const publisher: SocialPublisher = {
    mode: adapter.mode,
    get audit() {
      return [...auditLog];
    },
    reads,
    simulated: simulatedView,

    async publish(actor, req) {
      const { article, channel } = req;
      guard(actor, 'publish', channel, article.id);

      const existing = receipts.get(req.idempotencyKey);
      if (existing) return existing; // reenvio não duplica

      if (!article.gatesPassed) refuse(actor, 'publish', channel, 'gates_automaticos_pendentes', article.id);
      if (!article.approvedImage || !req.imageRef) refuse(actor, 'publish', channel, 'sem_imagem_aprovada', article.id);

      const mentions = req.mentions ?? [];
      const violations = validateCopy(req.text, article, mentions, { requireLink: channel !== 'instagram' });
      if (violations.length) {
        refuse(actor, 'publish', channel, `copy_invalida:${violations.map((v) => v.rule).join('+')}`, article.id);
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
      const receipt = await adapter.createPost(cap, payload, req.idempotencyKey);
      receipts.set(req.idempotencyKey, receipt);
      auditLog.push({
        ts: now(), actorId: actor.id, actorRole: actor.role, action: 'publish', channel, outcome: 'accepted',
        articleId: article.id, receiptId: receipt.id,
      });
      return receipt;
    },

    async uploadMedia(actor, asset, imageRef) {
      guard(actor, 'upload_media', 'linkedin');
      const media = config.media;
      if (!media) refuse(actor, 'upload_media', 'linkedin', 'rasterizador_ausente');
      uploader ??= new MlabsRasterUploader({
        rasterizer: media.rasterizer,
        port: adapter.mediaUploadPort(cap, media.putBytes),
        ledger: media.ledger,
        ledgerMaxAgeMs: media.ledgerMaxAgeMs,
        now: () => new Date(now()),
        allowMock: config.mode === 'simulated' && media.allowMock === true,
      });
      try {
        const r = await uploader.upload(asset, imageRef);
        auditLog.push({ ts: now(), actorId: actor.id, actorRole: actor.role, action: 'upload_media', channel: 'linkedin', outcome: 'accepted', receiptId: imageRef });
        return r;
      } catch (e) {
        const reason = e instanceof MediaUploadError ? e.reason : 'falha_no_envio_de_midia';
        auditLog.push({ ts: now(), actorId: actor.id, actorRole: actor.role, action: 'upload_media', channel: 'linkedin', outcome: 'refused', reason, receiptId: imageRef });
        throw e;
      }
    },

    async edit(actor, channel, receiptId, text) {
      guard(actor, 'edit', channel);
      const r = await adapter.updatePost(cap, receiptId, { text });
      auditLog.push({ ts: now(), actorId: actor.id, actorRole: actor.role, action: 'edit', channel, outcome: 'accepted', receiptId });
      return r;
    },

    async remove(actor, channel, receiptId) {
      guard(actor, 'delete', channel);
      const r = await adapter.deletePost(cap, receiptId);
      auditLog.push({ ts: now(), actorId: actor.id, actorRole: actor.role, action: 'delete', channel, outcome: 'accepted', receiptId });
      return r;
    },
  };
  return Object.freeze(publisher);
}

/** A identidade de publicação única do serviço. Redação/design/growth_agent nunca recebem este ator. */
export const PUBLISHER_SOCIAL: Actor = Object.freeze({ id: 'publisher_social', role: 'publisher_social' });
