import { createHash } from 'node:crypto';
import type { LiveOptions } from './live';
import type { PostPayload, PublishReceipt } from './port';

// Mapeamento de `PostPayload` para os argumentos de `create_post` do mLabs, SOMENTE COMO RASCUNHO. Os campos vêm do
// esquema documentado da própria ferramenta (leitura do esquema em 23/11/2026; nenhuma chamada feita): `status: 'draft'`
// "não agenda" e não publica; o rascunho só vira post quando uma pessoa o efetiva na mLabs. Este mapeador NUNCA emite
// `scheduled` nem `pending_approval`, nem `scheduledAt`: agendar é decisão do proprietário, depois de R5-02.
// O comportamento real (o rascunho aparece? a resposta traz `scheduleId`?) NÃO foi verificado: depende de teste em página de teste.

export class DraftMappingError extends Error {
  readonly reason: 'midia_nao_enviada' | 'mencao_linkedin_nao_suportada' | 'titulo_documento_ausente' | 'resposta_inesperada' | 'perfil_ausente';
  constructor(reason: DraftMappingError['reason'], message: string) {
    super(message);
    this.name = 'DraftMappingError';
    this.reason = reason;
  }
}

/** Mídia já enviada ao mLabs (upload_media/get_media_upload), indexada pela referência do criativo (`imageRef`). */
export interface UploadedMedia {
  imageIds?: string[];
  /** LinkedIn aceita PDF/Word/PPT (carrossel como documento). Exige `documentTitle` (≤ 100). */
  documentIds?: string[];
  documentTitle?: string;
}

export interface DraftMapperOptions {
  /** Id opaco do perfil (`ext_…`, de list_profiles). */
  profileId: string;
  /** Chave real do canal (de list_channels). Padrão: `linkedin` (página). */
  channelSourceKey?: 'linkedin' | 'linkedin_personal';
  /** Uploads concluídos, por `imageRef`. Sem upload para o `imageRef`, o mapeamento recusa (sem imagem aprovada não envia). */
  uploads: Record<string, UploadedMedia>;
  now?: () => string;
}

/** `requestId` do mLabs: 16–128 caracteres `[a-zA-Z0-9_-]`; derivado da chave de idempotência (reenvio = mesmo id). */
export function requestIdFor(idempotencyKey: string): string {
  return `ln-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 40)}`;
}

export function linkedinDraftMapper(opts: DraftMapperOptions): NonNullable<LiveOptions['payloadMapper']> {
  if (!opts.profileId.trim()) throw new DraftMappingError('perfil_ausente', 'profileId obrigatório');
  const channel = opts.channelSourceKey ?? 'linkedin';
  const now = opts.now ?? (() => new Date().toISOString());
  return {
    create(payload: PostPayload, idempotencyKey: string) {
      if (payload.mentions.length > 0) {
        // `mentions` do create_post é people-tag de Instagram; não há campo de menção para LinkedIn: texto puro.
        throw new DraftMappingError('mencao_linkedin_nao_suportada', 'create_post não tem menção para LinkedIn; use texto puro');
      }
      const media = opts.uploads[payload.imageRef];
      if (!media || ((media.imageIds?.length ?? 0) === 0 && (media.documentIds?.length ?? 0) === 0)) {
        throw new DraftMappingError('midia_nao_enviada', `mídia de ${payload.imageRef} ainda não foi enviada ao mLabs (upload_media)`);
      }
      const args: Record<string, unknown> = {
        profileId: opts.profileId,
        content: payload.text,
        channels: [channel],
        status: 'draft', // nunca 'scheduled' nem 'pending_approval'
        requestId: requestIdFor(idempotencyKey),
      };
      if (media.imageIds?.length) args.imageIds = media.imageIds;
      if (media.documentIds?.length) {
        const title = media.documentTitle?.trim();
        if (!title) throw new DraftMappingError('titulo_documento_ausente', 'documento LinkedIn exige título (≤ 100)');
        args.documentIds = media.documentIds;
        args.documentTitles = [{ channelSourceKey: channel, text: title.slice(0, 100) }];
      }
      return { tool: 'create_post', args };
    },

    toReceipt(raw: unknown, payload: PostPayload, idempotencyKey: string): PublishReceipt {
      const scheduleId = findScheduleId(raw);
      if (!scheduleId) throw new DraftMappingError('resposta_inesperada', 'a resposta de create_post não trouxe scheduleId');
      return {
        id: scheduleId,
        channel: payload.channel,
        mode: 'live',
        simulated: false,
        createdAt: now(),
        status: 'draft',
        idempotencyKey,
      };
    },
  };
}

/** O formato exato da resposta NÃO foi verificado: procura `scheduleId` em formas plausíveis; se não achar, recusa. */
function findScheduleId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  for (const cand of [o.scheduleId, (o.schedule as Record<string, unknown> | undefined)?.id, (o.data as Record<string, unknown> | undefined)?.scheduleId]) {
    if (typeof cand === 'string' && cand.length > 0 && cand.length <= 200) return cand;
  }
  return null;
}
