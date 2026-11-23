import { createHash } from 'node:crypto';
import type { UploadedMedia } from '../mlabs/create-post-draft';
import type { CreativeAsset } from '../types';
import type { MediaUploader } from './media';

// Uploader de mídia do mLabs para o criativo rasterizado (R5-02): SVG → PNG (rasterizador do UI/UX, injetado) → `prepare_media_upload`
// → PUT dos bytes na `uploadUrl` assinada → `get_media_upload` até `completed` → `imageId` para o `create_post`.
//
// ESTADO: implementado e testado SOMENTE contra portas simuladas. NENHUMA chamada ao mLabs real foi feita (prepare_media_upload é ESCRITA).
// O transporte real (`MediaUploadPort` sobre o MCP) NÃO existe aqui de propósito: como toda escrita no mLabs, ele só pode nascer dentro de
// `createSocialPublisher` (identidade publisher_social, flag growth_linkedin_live e liveAck, ADR-008) e só depois da decisão do PM sobre R5-02.
// Contrato do esquema lido (23/11/2026): prepare_media_upload(filename, mimeType, sizeBytes EXATO, sha256 opcional, channels) → uploadUrl,
// método e cabeçalhos a respeitar, autorização de 10 min; get_media_upload(uploadId) até concluir. A FORMA das respostas não foi observada:
// as portas normalizam e o adaptador real terá de validá-la em página de teste.

/** O que o rasterizador (UI/UX) entrega. Estrutural: o tipo `RasterAsset` do UI/UX encaixa sem importar nada daqui. */
export interface RasterAssetLike {
  png: Uint8Array;
  /** SHA-256 (hex) dos bytes do PNG. */
  sha256: string;
  /** SHA-256 (hex) do SVG de origem: é a chave de idempotência do envio (o PNG pode variar entre plataformas, o SVG não). */
  svgSha256: string;
  sizeBytes: number;
  width: number;
  height: number;
  filename: string;
  mimeType: 'image/png';
  altText: string;
  brandStatus: string;
  mock: boolean;
}

export interface RasterizerPort {
  rasterize(asset: CreativeAsset): Promise<RasterAssetLike>;
}

export interface PreparedUpload {
  uploadId: string;
  /** URL assinada: segredo de curta duração. Nunca é logada, devolvida em erro nem gravada. */
  uploadUrl: string;
  method: string;
  /** Todos os cabeçalhos devolvidos devem ser enviados no PUT, sem acrescentar nem tirar. */
  headers: Record<string, string>;
  /** Fim da autorização, se o mLabs informar. */
  expiresAt?: string;
}

export interface MediaStatus {
  state: 'pending' | 'processing' | 'completed' | 'failed';
  imageId?: string;
}

/** Porta do transporte de mídia. Real = só dentro do publicador (escrita); simulada = `SimulatedMediaUploadPort`. */
export interface MediaUploadPort {
  prepare(args: { filename: string; mimeType: 'image/png'; sizeBytes: number; sha256: string; channels: string[] }): Promise<PreparedUpload>;
  /** PUT dos bytes. Devolve o status HTTP. */
  put(p: PreparedUpload, bytes: Uint8Array): Promise<number>;
  status(uploadId: string): Promise<MediaStatus>;
}

/** PUT dos bytes na URL assinada; devolve o status HTTP. Injetável (testes); o padrão do adaptador real usa `fetch`. */
export type PutBytes = (url: string, method: string, headers: Record<string, string>, bytes: Uint8Array) => Promise<number>;

/** Registro de um envio concluído. `at` é ISO 8601 UTC (instante em que o mLabs devolveu o `imageId`). */
export interface UploadLedgerEntry {
  imageId: string;
  at: string;
}

/**
 * Registro dos envios de mídia, chave = `svg:<svgSha256>:<canais>`. Em produção tem de ser DURÁVEL (tabela PostgreSQL, dono: Backend;
 * ver docs/upload-ledger-pg.md): em memória, uma nova execução sobe a mesma imagem de novo. Contrato testado por
 * `uploadLedgerConformanceCases` (`@ln/growth/testing`); toda implementação tem de passá-la.
 */
export interface UploadLedger {
  get(key: string): Promise<UploadLedgerEntry | null>;
  /** Grava só se a chave não existe e devolve a entrada que FICOU: a primeira gravação vence (execuções paralelas convergem no mesmo `imageId`). */
  putIfAbsent(key: string, entry: UploadLedgerEntry): Promise<UploadLedgerEntry>;
  /** Remove a entrada (ex.: vencida). Remover o que não existe não é erro. */
  delete(key: string): Promise<void>;
}

export const LEDGER_KEY_RE = /^[A-Za-z0-9:_,.-]{1,200}$/;

/** Validação comum (a tabela PostgreSQL tem os mesmos CHECKs). Lança `RangeError`. */
export function assertLedgerEntry(key: string, entry?: UploadLedgerEntry): void {
  if (!LEDGER_KEY_RE.test(key)) throw new RangeError('chave do registro de envios inválida');
  if (!entry) return;
  if (typeof entry.imageId !== 'string' || entry.imageId.length < 1 || entry.imageId.length > 200) throw new RangeError('imageId inválido');
  if (typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at))) throw new RangeError('instante inválido');
}

export class InMemoryUploadLedger implements UploadLedger {
  private readonly m = new Map<string, UploadLedgerEntry>();
  async get(key: string) {
    assertLedgerEntry(key);
    const e = this.m.get(key);
    return e ? { ...e } : null;
  }
  async putIfAbsent(key: string, entry: UploadLedgerEntry) {
    assertLedgerEntry(key, entry);
    const prior = this.m.get(key);
    if (prior) return { ...prior };
    this.m.set(key, { ...entry });
    return { ...entry };
  }
  async delete(key: string) {
    assertLedgerEntry(key);
    this.m.delete(key);
  }
}

export type MediaUploadReason =
  | 'criativo_mock' | 'raster_invalido' | 'tamanho_acima_do_limite' | 'autorizacao_expirada' | 'put_recusado' | 'processamento_falhou' | 'timeout' | 'preparo_falhou' | 'resposta_sem_imageid';

/** Erro do envio. A mensagem nunca carrega a URL assinada, cabeçalhos ou bytes. */
export class MediaUploadError extends Error {
  constructor(readonly reason: MediaUploadReason, detail?: string) {
    super(`envio de mídia ao mLabs recusado: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'MediaUploadError';
  }
}

export interface MlabsRasterUploaderOptions {
  rasterizer: RasterizerPort;
  port: MediaUploadPort;
  ledger?: UploadLedger;
  now: () => Date;
  /** Canais do upload. Padrão ['linkedin']. */
  channels?: string[];
  /** Limite de bytes do PNG (conservador; o limite real do LinkedIn no mLabs NÃO foi verificado). Padrão 5 MB. */
  maxBytes?: number;
  /** Aceita criativo de teste (mock). Padrão false: criativo mock nunca sobe. */
  allowMock?: boolean;
  /** Idade máxima de uma entrada do registro; acima disso a imagem sobe de novo. Padrão 24 h (conservador: a validade do `imageId` no mLabs NÃO foi verificada). */
  ledgerMaxAgeMs?: number;
  /** Validade da autorização do mLabs (10 min no esquema), com folga. */
  authorizationMs?: number;
  pollMs?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
}

const sha256Hex = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FILENAME_RE = /^[a-z0-9][a-z0-9-]{0,190}\.png$/;

/** Largura e altura lidas do cabeçalho IHDR do PNG; null se não for um PNG. */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  if (png.length < 33 || PNG_SIG.some((b, i) => png[i] !== b)) return null;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (dv.getUint32(12) !== 0x49484452) return null; // 'IHDR'
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

export class MlabsRasterUploader implements MediaUploader {
  private readonly o: Required<Pick<MlabsRasterUploaderOptions, 'channels' | 'maxBytes' | 'allowMock' | 'authorizationMs' | 'pollMs' | 'maxPolls' | 'ledgerMaxAgeMs'>> & MlabsRasterUploaderOptions;
  private readonly ledger: UploadLedger;

  constructor(opts: MlabsRasterUploaderOptions) {
    // `undefined` explícito (ex.: vindo do publicador) não pode apagar o padrão: cada opção cai no padrão com `??`
    this.o = {
      ...opts,
      channels: opts.channels ?? ['linkedin'], maxBytes: opts.maxBytes ?? 5 * 1024 * 1024, allowMock: opts.allowMock ?? false,
      authorizationMs: opts.authorizationMs ?? 9 * 60_000, pollMs: opts.pollMs ?? 1000, maxPolls: opts.maxPolls ?? 30, ledgerMaxAgeMs: opts.ledgerMaxAgeMs ?? 24 * 3_600_000,
    };
    this.ledger = opts.ledger ?? new InMemoryUploadLedger();
  }

  async upload(asset: CreativeAsset, _imageRef: string): Promise<UploadedMedia> {
    const o = this.o;
    if (asset.mock && !o.allowMock) throw new MediaUploadError('criativo_mock');
    const r = await o.rasterizer.rasterize(asset);
    this.check(asset, r);

    // idempotência pelo SVG de origem: o mesmo criativo não sobe duas vezes
    const key = `svg:${r.svgSha256}:${o.channels.join(',')}`;
    const done = await this.ledger.get(key);
    if (done) {
      if (o.now().getTime() - Date.parse(done.at) <= o.ledgerMaxAgeMs) return { imageIds: [done.imageId] };
      await this.ledger.delete(key); // vencida: sobe de novo
    }

    let prepared: PreparedUpload;
    try {
      prepared = await o.port.prepare({ filename: r.filename, mimeType: 'image/png', sizeBytes: r.sizeBytes, sha256: r.sha256, channels: o.channels });
    } catch {
      throw new MediaUploadError('preparo_falhou');
    }
    const preparedAt = o.now().getTime();
    if (prepared.expiresAt && Date.parse(prepared.expiresAt) <= preparedAt) throw new MediaUploadError('autorizacao_expirada');

    const status = await o.port.put(prepared, r.png).catch(() => -1);
    if (status < 200 || status >= 300) throw new MediaUploadError('put_recusado', `HTTP ${status}`);
    if (o.now().getTime() - preparedAt > o.authorizationMs) throw new MediaUploadError('autorizacao_expirada');

    const sleep = o.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
    for (let i = 0; i < o.maxPolls; i++) {
      const s: MediaStatus = await o.port.status(prepared.uploadId).catch(() => ({ state: 'processing' as const }));
      if (s.state === 'failed') throw new MediaUploadError('processamento_falhou');
      if (s.state === 'completed') {
        if (!s.imageId) throw new MediaUploadError('resposta_sem_imageid');
        // a primeira gravação vence: execuções paralelas convergem no mesmo imageId
        const kept = await this.ledger.putIfAbsent(key, { imageId: s.imageId, at: o.now().toISOString() });
        return { imageIds: [kept.imageId] };
      }
      await sleep(o.pollMs);
    }
    throw new MediaUploadError('timeout');
  }

  /** Confere o que o rasterizador entregou: não confia nos campos, recalcula. */
  private check(asset: CreativeAsset, r: RasterAssetLike): void {
    const bad = (d: string) => new MediaUploadError('raster_invalido', d);
    if (r.mimeType !== 'image/png') throw bad('mimeType');
    if (!FILENAME_RE.test(r.filename)) throw bad('filename');
    if (r.png.byteLength !== r.sizeBytes || r.sizeBytes === 0) throw bad('sizeBytes');
    if (r.sizeBytes > this.o.maxBytes) throw new MediaUploadError('tamanho_acima_do_limite');
    const dim = pngSize(r.png);
    if (!dim) throw bad('nao_e_png');
    if (dim.width !== r.width || dim.height !== r.height || r.width !== asset.width || r.height !== asset.height) throw bad('dimensoes');
    if (sha256Hex(r.png) !== r.sha256) throw bad('sha256_dos_bytes');
    if (sha256Hex(asset.svg) !== r.svgSha256) throw bad('svg_de_origem_diferente');
    if (r.mock && !this.o.allowMock) throw new MediaUploadError('criativo_mock');
    if (!r.altText.trim()) throw bad('altText');
  }
}
