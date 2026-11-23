import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { CreativeAsset } from '../types';

// Rasterização SVG → PNG do criativo social (só Node; NÃO é exportado pelo índice do pacote: use `@ln/growth/raster`).
// Pura: sem rede, sem relógio e sem fonte do sistema. Só aceita SVG desenhado em curvas (cartões de `social-cards.ts`);
// um SVG com <text> mudaria conforme a fonte instalada, e isso quebraria o determinismo, então é recusado.
//
// Determinismo: o PIXEL é idêntico em qualquer plataforma com o mesmo `sharp` (versão exata no package.json). Os BYTES
// do PNG só são idênticos dentro da mesma plataforma/versão (zlib/libvips de builds diferentes podem comprimir diferente
// com pixels iguais). Por isso a chave de idempotência do envio é `svgSha256` (hash do SVG de origem), não o `sha256` do PNG.

export const RASTER_MIME = 'image/png' as const;
export const BRAND_BACKGROUND = '#153C3C';

export interface RasterAsset {
  png: Uint8Array;
  /** SHA-256 dos bytes do PNG (vale só na mesma plataforma/versão do sharp; serve de integridade do envio). */
  sha256: string;
  /** SHA-256 do SVG de origem, em UTF-8: use como chave de idempotência. */
  svgSha256: string;
  sizeBytes: number;
  width: number;
  height: number;
  /** ASCII `[a-z0-9-]` + `.png`, até 200 caracteres. */
  filename: string;
  mimeType: typeof RASTER_MIME;
  /** Texto alternativo do card (vem do <desc> do SVG). */
  altText: string;
  brandStatus: string;
  mock: boolean;
}

export class RasterRefusal extends Error {
  readonly rule: string;
  constructor(rule: string, detail: string) {
    super(`rasterização recusada (${rule}): ${detail}`);
    this.name = 'RasterRefusal';
    this.rule = rule;
  }
}

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

const unesc = (s: string): string => s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

/** `slug` ASCII para o nome do arquivo (sem acento, minúsculo, hífens). */
export function slugify(s: string, max = 60): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

function attr(svg: string, name: string): string | undefined {
  return new RegExp(`<svg[^>]*\\s${name}="([^"]*)"`).exec(svg)?.[1];
}

/** Valida e converte o criativo em PNG opaco (RGB, 8 bits), no tamanho exato do SVG. */
export async function rasterizeCreative(asset: CreativeAsset): Promise<RasterAsset> {
  const svg = asset.svg;
  if (/<text[\s>]/i.test(svg)) throw new RasterRefusal('svg_com_texto', 'o texto precisa estar em curvas (renderSocialCard); <text> depende da fonte instalada');
  if (/<script|<foreignObject/i.test(svg)) throw new RasterRefusal('svg_ativo', 'script e foreignObject não são permitidos');
  if (/(?:href|src)\s*=\s*["'](?!#|data:)/i.test(svg)) throw new RasterRefusal('svg_recurso_externo', 'o SVG não pode referenciar recurso externo (sem rede)');
  const w = Number(attr(svg, 'width'));
  const h = Number(attr(svg, 'height'));
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 200 || h < 200 || w > 4096 || h > 4096) throw new RasterRefusal('dimensao_invalida', `${attr(svg, 'width')}×${attr(svg, 'height')}`);
  if (w !== asset.width || h !== asset.height) throw new RasterRefusal('dimensao_divergente', `SVG ${w}×${h} ≠ criativo ${asset.width}×${asset.height}`);

  const alt = unesc(/<desc>([\s\S]*?)<\/desc>/.exec(svg)?.[1] ?? /<title>([\s\S]*?)<\/title>/.exec(svg)?.[1] ?? '').trim();
  if (!alt) throw new RasterRefusal('sem_texto_alternativo', 'o SVG precisa de <desc> (ou <title>)');

  const { data, info } = await sharp(Buffer.from(svg, 'utf8'), { density: 72, limitInputPixels: 4096 * 4096 })
    .flatten({ background: BRAND_BACKGROUND })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer({ resolveWithObject: true });
  if (info.width !== w || info.height !== h) throw new RasterRefusal('tamanho_renderizado', `saiu ${info.width}×${info.height}, esperado ${w}×${h}`);

  const svgSha256 = sha256(svg);
  const kind = attr(svg, 'data-kind') ?? 'criativo';
  const title = unesc(/<title>([\s\S]*?)<\/title>/.exec(svg)?.[1] ?? '');
  const slug = slugify(title) || 'card';
  const filename = `ln-${slugify(kind, 20) || 'criativo'}-${slug}-${w}x${h}-${svgSha256.slice(0, 8)}.png`;
  const png = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return {
    png,
    sha256: sha256(png),
    svgSha256,
    sizeBytes: png.byteLength,
    width: w,
    height: h,
    filename,
    mimeType: RASTER_MIME,
    altText: alt,
    brandStatus: asset.brandStatus,
    mock: asset.mock,
  };
}

/** SHA-256 dos PIXELS decodificados (RGB). Use nos testes: é o que deve ser igual entre plataformas. */
export async function rasterPixelSha256(png: Uint8Array): Promise<string> {
  const raw = await sharp(Buffer.from(png)).raw().toBuffer();
  return sha256(raw);
}
