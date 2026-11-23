// MOCK — mLabs SIMULADO no nível do transporte MCP. Serve para exercitar o caminho real do adaptador (mapeador → create_post)
// sem tocar a conta. Valida os argumentos de `create_post` contra o ESQUEMA DOCUMENTADO da ferramenta (lido em 23/11/2026):
// campos fechados, obrigatórios, `status`, `scheduledAt` futuro para agendar, título de documento LinkedIn, XOR de link e mídia,
// `requestId`. A FORMA DA RESPOSTA (`scheduleId`, `status`) é um palpite: NÃO prova o formato real (R5-02).
import { createHash } from 'node:crypto';
import type { McpTransport } from './live';

const ALLOWED_KEYS = new Set([
  'advancedConfigs', 'altTextItems', 'alternativeText', 'audioConfigurations', 'channels', 'collabs', 'commentSettings', 'content',
  'contentAiGenerated', 'documentIds', 'documentTitles', 'dontShareFeed', 'firstComment', 'googleMyBusiness', 'igtvPreview', 'image360',
  'imageIds', 'imageObjects', 'locations', 'madeForKids', 'mediaUrls', 'mentions', 'paidPartnerships', 'pinterestBoards', 'products',
  'profileId', 'requestId', 'scheduleMediaConfigs', 'scheduleMessages', 'scheduledAt', 'shareFlags', 'status', 'storyStickers',
  'surveys', 'threadsTemporary', 'tiktokOptions', 'trialReels', 'urlData', 'videoIds', 'videoObjects', 'videoTitles', 'youtubeOptions',
]);
const STATUSES = new Set(['draft', 'scheduled', 'pending_approval']);
const REQUEST_ID_RE = /^[a-zA-Z0-9_-]{16,128}$/;
const LINKEDIN = new Set(['linkedin', 'linkedin_personal']);

export class SimulatedSchemaError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`create_post inválido segundo o esquema documentado: ${problems.join('; ')}`);
    this.name = 'SimulatedSchemaError';
    this.problems = problems;
  }
}

export interface SimulatedPost {
  scheduleId: string;
  requestId: string | undefined;
  status: 'draft' | 'scheduled' | 'pending_approval';
  args: Record<string, unknown>;
}

/** Valida `create_post` contra o esquema documentado. Devolve a lista de problemas (vazia = válido). */
export function validateCreatePostArgs(args: Record<string, unknown>, now: Date): string[] {
  const p: string[] = [];
  for (const k of Object.keys(args)) if (!ALLOWED_KEYS.has(k)) p.push(`campo não documentado: ${k}`);
  if (typeof args.profileId !== 'string' || !args.profileId) p.push('profileId obrigatório');
  if (typeof args.content !== 'string') p.push('content obrigatório (string)');
  const channels = args.channels;
  if (!Array.isArray(channels) || channels.length === 0 || channels.some((c) => typeof c !== 'string' || !c)) p.push('channels obrigatório (lista de chaves)');
  const status = args.status;
  if (status !== undefined && (typeof status !== 'string' || !STATUSES.has(status))) p.push('status fora de draft|scheduled|pending_approval');
  if (status === 'scheduled' || status === 'pending_approval') {
    const at = typeof args.scheduledAt === 'string' ? Date.parse(args.scheduledAt) : NaN;
    if (!Number.isFinite(at) || at <= now.getTime()) p.push(`${String(status)} exige scheduledAt futuro`);
  }
  if (args.requestId !== undefined && (typeof args.requestId !== 'string' || !REQUEST_ID_RE.test(args.requestId))) p.push('requestId deve ter 16–128 caracteres [a-zA-Z0-9_-]');
  const chans = Array.isArray(channels) ? (channels as string[]) : [];
  const hasLinkedIn = chans.some((c) => LINKEDIN.has(c));
  const docs = Array.isArray(args.documentIds) ? args.documentIds : [];
  if (hasLinkedIn && docs.length > 0) {
    const titles = Array.isArray(args.documentTitles) ? (args.documentTitles as { text?: unknown }[]) : [];
    if (titles.length === 0 || titles.some((t) => typeof t.text !== 'string' || !t.text || t.text.length > 100)) p.push('documento LinkedIn exige documentTitles (texto ≤ 100)');
  }
  const hasMedia = ['imageIds', 'videoIds', 'documentIds', 'mediaUrls'].some((k) => Array.isArray(args[k]) && (args[k] as unknown[]).length > 0);
  if (hasLinkedIn && args.urlData !== undefined && hasMedia) p.push('urlData e mídia são exclusivos no LinkedIn');
  if (hasLinkedIn && typeof args.content === 'string' && args.content.length > 3000) p.push('content do LinkedIn acima de 3000 caracteres');
  return p;
}

// Mídia (prepare_media_upload / get_media_upload): argumentos conferidos contra o esquema lido em 23/11/2026 (filename, mimeType, sizeBytes EXATO,
// sha256 opcional, channels; resposta com uploadUrl, método e cabeçalhos a respeitar, autorização de 10 min). A FORMA DAS RESPOSTAS é um palpite.
const MEDIA_KEYS = new Set(['filename', 'mimeType', 'sizeBytes', 'sha256', 'channels']);
const MEDIA_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function validatePrepareMediaArgs(args: Record<string, unknown>): string[] {
  const p: string[] = [];
  for (const k of Object.keys(args)) if (!MEDIA_KEYS.has(k)) p.push(`campo não documentado: ${k}`);
  if (typeof args.filename !== 'string' || !args.filename || args.filename.length > 255) p.push('filename obrigatório (≤ 255)');
  if (typeof args.mimeType !== 'string' || !MEDIA_MIMES.has(args.mimeType)) p.push('mimeType fora da lista');
  if (!Number.isInteger(args.sizeBytes) || (args.sizeBytes as number) <= 0) p.push('sizeBytes obrigatório (inteiro > 0)');
  if (args.sha256 !== undefined && (typeof args.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(args.sha256))) p.push('sha256 inválido');
  if (!Array.isArray(args.channels) || args.channels.length === 0) p.push('channels obrigatório');
  return p;
}

interface MediaSession {
  sizeBytes: number;
  sha256: string | undefined;
  mimeType: string;
  at: number;
  uploaded: boolean;
  polls: number;
}

export class SimulatedMlabsTransport implements McpTransport {
  readonly MOCK = true as const;
  readonly calls: { tool: string; args: Record<string, unknown> }[] = [];
  private readonly posts = new Map<string, SimulatedPost>();
  private readonly byRequestId = new Map<string, string>();
  private seq = 0;
  /** Falhas injetadas: as próximas N chamadas a `create_post` lançam (simula mLabs indisponível). */
  failNext = 0;
  private readonly now: () => Date;
  // ---- mídia simulada
  private readonly sessions = new Map<string, MediaSession>();
  private mediaSeq = 0;
  /** Contadores do envio de mídia (para os testes). */
  readonly media = { prepares: 0, puts: 0, polls: 0 };
  /** Falhas injetadas no envio de mídia. */
  mediaFail: { prepare?: boolean; putStatus?: number; processing?: 'failed' | 'never' } = {};

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  get all(): SimulatedPost[] {
    return [...this.posts.values()];
  }

  count(status: SimulatedPost['status']): number {
    return this.all.filter((p) => p.status === status).length;
  }

  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ tool, args: structuredClone(args) });
    if (tool === 'prepare_media_upload') return this.prepareMedia(args);
    if (tool === 'get_media_upload') return this.getMedia(args);
    if (tool.startsWith('list_') || tool.startsWith('get_')) return [];
    if (tool !== 'create_post') throw new Error(`ferramenta fora do simulador: ${tool}`);
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('mLabs indisponível (simulado)');
    }
    const problems = validateCreatePostArgs(args, this.now());
    if (problems.length) throw new SimulatedSchemaError(problems);
    const requestId = typeof args.requestId === 'string' ? args.requestId : undefined;
    // Idempotência documentada: mesmo requestId = mesmo resultado, sem criar outro post.
    const prior = requestId ? this.byRequestId.get(requestId) : undefined;
    if (prior) return this.response(this.posts.get(prior) as SimulatedPost);
    this.seq += 1;
    const post: SimulatedPost = {
      scheduleId: `SIM-SCH-${String(this.seq).padStart(4, '0')}`,
      requestId,
      status: (args.status as SimulatedPost['status'] | undefined) ?? (args.scheduledAt ? 'scheduled' : 'draft'),
      args: structuredClone(args),
    };
    this.posts.set(post.scheduleId, post);
    if (requestId) this.byRequestId.set(requestId, post.scheduleId);
    return this.response(post);
  }

  private prepareMedia(args: Record<string, unknown>) {
    if (this.mediaFail.prepare) throw new Error('mLabs indisponível (simulado): uploadUrl=https://exemplo.invalid/segredo');
    const problems = validatePrepareMediaArgs(args);
    if (problems.length) throw new SimulatedSchemaError(problems);
    this.media.prepares += 1;
    const uploadId = `SIM-UP-${String(++this.mediaSeq).padStart(4, '0')}`;
    this.sessions.set(uploadId, { sizeBytes: args.sizeBytes as number, sha256: args.sha256 as string | undefined, mimeType: args.mimeType as string, at: this.now().getTime(), uploaded: false, polls: 0 });
    return {
      uploadId, uploadUrl: `https://upload.simulado.example/${uploadId}?sig=simulada`, method: 'PUT',
      headers: { 'content-type': args.mimeType as string, 'if-none-match': '*' }, expiresAt: new Date(this.now().getTime() + 10 * 60_000).toISOString(), _mock: true,
    };
  }

  /** PUT simulado na `uploadUrl`: confere o que o armazenamento conferiria (tamanho EXATO, sha256, cabeçalhos devolvidos, 10 min). */
  readonly putBytes = async (url: string, method: string, headers: Record<string, string>, bytes: Uint8Array): Promise<number> => {
    this.media.puts += 1;
    if (this.mediaFail.putStatus !== undefined) return this.mediaFail.putStatus;
    const id = /\/(SIM-UP-\d+)\?/.exec(url)?.[1];
    const s = id ? this.sessions.get(id) : undefined;
    if (!s || method !== 'PUT') return 403;
    if (this.now().getTime() - s.at > 10 * 60_000) return 403;
    if (headers['content-type'] !== s.mimeType || headers['if-none-match'] !== '*') return 400;
    if (bytes.byteLength !== s.sizeBytes) return 400;
    if (s.sha256 && createHash('sha256').update(bytes).digest('hex') !== s.sha256) return 400;
    s.uploaded = true;
    return 200;
  };

  private getMedia(args: Record<string, unknown>) {
    this.media.polls += 1;
    const s = typeof args.uploadId === 'string' ? this.sessions.get(args.uploadId) : undefined;
    if (!s) throw new Error('uploadId desconhecido (simulado)');
    if (!s.uploaded || this.mediaFail.processing === 'failed') return { uploadId: args.uploadId, status: 'failed', _mock: true };
    s.polls += 1;
    if (this.mediaFail.processing === 'never' || s.polls < 2) return { uploadId: args.uploadId, status: s.polls === 1 ? 'pending' : 'processing', _mock: true };
    return { uploadId: args.uploadId, status: 'completed', media: { imageId: `SIM-IMG-${String(args.uploadId)}` }, _mock: true };
  }

  private response(p: SimulatedPost) {
    return { scheduleId: p.scheduleId, status: p.status, scheduleLink: { url: `https://simulado.invalid/agendamento/${p.scheduleId}` }, _mock: true };
  }
}
