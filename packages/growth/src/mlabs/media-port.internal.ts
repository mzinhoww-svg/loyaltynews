// INTERNO: não reexportado pelo índice nem por subpath. Transporte REAL de mídia do mLabs (R5-02): `prepare_media_upload` (ESCRITA) →
// PUT dos bytes na URL assinada → `get_media_upload` (leitura). Só o adaptador real o cria, e só com a capability do publicador;
// cada chamada reconfere identidade `publisher_social` e a flag `growth_linkedin_live` (contrato: linkedinPublicacao).
// ESTADO: desligado por padrão e testado SOMENTE contra o mLabs simulado. Nenhuma chamada real foi feita (decisão do PM: até o
// proprietário aprovar a publicação no go-live). A FORMA das respostas de prepare/get_media_upload NÃO foi observada: a leitura é
// defensiva e qualquer coisa fora do esperado vira recusa, nunca palpite.
import type { MediaStatus, MediaUploadPort, PreparedUpload, PutBytes } from '../pipeline/raster-upload';
import { readOnlyTransport, type McpTransport } from './live';

export class MediaPortError extends Error {
  constructor(readonly reason: 'resposta_inesperada' | 'url_recusada' | 'metodo_recusado') {
    super(`transporte de mídia do mLabs: ${reason}`);
    this.name = 'MediaPortError';
  }
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** A URL assinada vem do mLabs, mas só vale se for HTTPS público: sem credencial embutida, sem localhost nem IP literal. */
export function assertUploadUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new MediaPortError('url_recusada');
  }
  const host = u.hostname.toLowerCase();
  const ipLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
  if (u.protocol !== 'https:' || u.username || u.password || host === 'localhost' || ipLiteral || !host.includes('.') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new MediaPortError('url_recusada');
  }
}

/** PUT padrão (rede real). Sem redirecionamento, com prazo; o corpo da resposta é descartado. Nunca usado nos testes. */
export const fetchPut: PutBytes = async (url, method, headers, bytes) => {
  const res = await fetch(url, { method, headers, body: new Blob([new Uint8Array(bytes)], { type: headers['content-type'] ?? 'application/octet-stream' }), redirect: 'error', signal: AbortSignal.timeout(30_000) });
  await res.arrayBuffer().catch(() => undefined);
  return res.status;
};

export interface LiveMediaPortDeps {
  transport: McpTransport;
  /** Confere identidade e flag; lança se faltar qualquer uma. Chamada ANTES de cada operação. */
  guard: () => void;
  putBytes?: PutBytes;
}

export function buildLiveMediaPort(d: LiveMediaPortDeps): MediaUploadPort {
  const put = d.putBytes ?? fetchPut;
  return {
    async prepare(a) {
      d.guard();
      const raw = rec(await d.transport.call('prepare_media_upload', { filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes, sha256: a.sha256, channels: a.channels }));
      const uploadId = str(raw.uploadId) ?? str(raw.id);
      const uploadUrl = str(raw.uploadUrl) ?? str(raw.url);
      if (!uploadId || !uploadUrl) throw new MediaPortError('resposta_inesperada');
      assertUploadUrl(uploadUrl);
      const method = (str(raw.method) ?? 'PUT').toUpperCase();
      if (method !== 'PUT') throw new MediaPortError('metodo_recusado');
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec(raw.headers ?? raw.uploadHeaders))) if (typeof v === 'string') headers[k] = v;
      const expiresAt = str(raw.expiresAt);
      const p: PreparedUpload = { uploadId, uploadUrl, method, headers, ...(expiresAt ? { expiresAt } : {}) };
      return p;
    },
    async put(p, bytes) {
      d.guard();
      assertUploadUrl(p.uploadUrl);
      if (p.method !== 'PUT') throw new MediaPortError('metodo_recusado');
      return put(p.uploadUrl, p.method, p.headers, bytes);
    },
    async status(uploadId) {
      d.guard();
      const raw = rec(await readOnlyTransport(d.transport).call('get_media_upload', { uploadId }));
      const st = (str(raw.status) ?? str(raw.state) ?? '').toLowerCase();
      const media = rec(raw.media);
      const imageId = str(media.imageId) ?? str(raw.imageId);
      const state: MediaStatus['state'] = ['completed', 'complete', 'ready', 'done', 'processed', 'success'].includes(st)
        ? 'completed'
        : ['failed', 'error', 'rejected', 'expired'].includes(st)
          ? 'failed'
          : ['processing', 'uploading', 'uploaded', 'in_progress'].includes(st)
            ? 'processing'
            : 'pending';
      return { state, ...(imageId ? { imageId } : {}) };
    },
  };
}
