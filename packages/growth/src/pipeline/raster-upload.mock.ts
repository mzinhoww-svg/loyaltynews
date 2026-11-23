// MOCK — porta de mídia e rasterizador SIMULADOS, para testar o uploader sem mLabs, sem rede e sem sharp. Nada é enviado a lugar nenhum.
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { CreativeAsset } from '../types';
import type { MediaStatus, MediaUploadPort, PreparedUpload, RasterAssetLike, RasterizerPort } from './raster-upload';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

/** PNG válido (RGB, cor lisa) com a largura e altura pedidas. Só para teste: não rasteriza SVG nenhum. */
export function solidPng(width: number, height: number, rgb: [number, number, number] = [11, 61, 46]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = new Uint8Array(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) raw.set(row, y * row.length);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const hex = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

export class SimulatedRasterizer implements RasterizerPort {
  readonly MOCK = true as const;
  calls = 0;
  /** Sobrepõe campos do resultado para os casos de recusa. */
  tamper: Partial<RasterAssetLike> | null = null;
  async rasterize(asset: CreativeAsset): Promise<RasterAssetLike> {
    this.calls++;
    const png = solidPng(asset.width, asset.height);
    return {
      png, sha256: hex(png), svgSha256: hex(asset.svg), sizeBytes: png.byteLength, width: asset.width, height: asset.height,
      filename: `ln-${asset.format.replace(/_/g, '-')}-${hex(asset.svg).slice(0, 12)}.png`, mimeType: 'image/png',
      altText: 'Criativo de teste', brandStatus: asset.brandStatus, mock: asset.mock, ...(this.tamper ?? {}),
    };
  }
}

export interface SimUploadOptions {
  /** Consultas até concluir. Padrão 2. */
  completeAfter?: number;
  now: () => Date;
}

/** Porta simulada: confere o que o mLabs conferiria (tamanho EXATO, sha256, cabeçalhos devolvidos, validade de 10 min). */
export class SimulatedMediaUploadPort implements MediaUploadPort {
  readonly MOCK = true as const;
  prepares: { filename: string; sizeBytes: number; sha256: string; channels: string[] }[] = [];
  puts = 0;
  polls = 0;
  failPrepare = false;
  putStatus: number | null = null;
  processing: 'ok' | 'failed' | 'never' | 'no_image_id' = 'ok';
  /** Atraso (ms) entre o preparo e o PUT, para o caso da autorização vencida. */
  private readonly sessions = new Map<string, { sizeBytes: number; sha256: string; at: number; uploaded: boolean; polls: number }>();
  private n = 0;
  constructor(private readonly o: SimUploadOptions) {}

  async prepare(a: { filename: string; mimeType: 'image/png'; sizeBytes: number; sha256: string; channels: string[] }): Promise<PreparedUpload> {
    if (this.failPrepare) throw new Error('falha simulada: uploadUrl=https://exemplo.invalid/segredo');
    this.prepares.push({ filename: a.filename, sizeBytes: a.sizeBytes, sha256: a.sha256, channels: a.channels });
    const uploadId = `sim-up-${++this.n}`;
    this.sessions.set(uploadId, { sizeBytes: a.sizeBytes, sha256: a.sha256, at: this.o.now().getTime(), uploaded: false, polls: 0 });
    return {
      uploadId, uploadUrl: `https://upload.simulado.invalid/${uploadId}?sig=simulada`, method: 'PUT',
      headers: { 'content-type': 'image/png', 'if-none-match': '*' }, expiresAt: new Date(this.o.now().getTime() + 10 * 60_000).toISOString(),
    };
  }

  async put(p: PreparedUpload, bytes: Uint8Array): Promise<number> {
    this.puts++;
    if (this.putStatus !== null) return this.putStatus;
    const s = this.sessions.get(p.uploadId);
    if (!s || p.method !== 'PUT') return 403;
    if (this.o.now().getTime() - s.at > 10 * 60_000) return 403; // autorização vencida
    if (p.headers['content-type'] !== 'image/png' || p.headers['if-none-match'] !== '*') return 400; // cabeçalhos devolvidos têm de seguir
    if (bytes.byteLength !== s.sizeBytes || hex(bytes) !== s.sha256) return 400; // tamanho exato e hash
    s.uploaded = true;
    return 200;
  }

  async status(uploadId: string): Promise<MediaStatus> {
    this.polls++;
    const s = this.sessions.get(uploadId);
    if (!s || !s.uploaded) return { state: 'failed' };
    s.polls++;
    if (this.processing === 'failed') return { state: 'failed' };
    if (this.processing === 'never') return { state: 'processing' };
    if (s.polls < (this.o.completeAfter ?? 2)) return { state: s.polls === 1 ? 'pending' : 'processing' };
    return this.processing === 'no_image_id' ? { state: 'completed' } : { state: 'completed', imageId: `SIM-IMG-${uploadId}` };
  }
}
