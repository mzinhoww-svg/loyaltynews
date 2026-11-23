// Arquivo do criativo: tipo e dimensões lidos do CABEÇALHO do próprio arquivo, NO SERVIDOR (nunca do que o cliente declara), e a regra de aceitar só
// o que casa com a posição. Só JPEG, PNG e GIF (HTML5 só depois da análise de sandbox). Sem decodificar pixel: só os bytes de cabeçalho.
import { createHash } from 'node:crypto';

export type CreativeMime = 'image/jpeg' | 'image/png' | 'image/gif';
export interface ImageInfo {
  mime: CreativeMime;
  ext: 'jpg' | 'png' | 'gif';
  width: number;
  height: number;
}

const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

/** Tipo e dimensões pelo cabeçalho; `null` se não for JPEG/PNG/GIF íntegro o bastante para ter largura e altura positivas. */
export function readImageInfo(b: Uint8Array): ImageInfo | null {
  // PNG: assinatura de 8 bytes, depois o bloco IHDR com largura e altura (4 bytes cada)
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    if (String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) !== 'IHDR') return null;
    const width = u32(b, 16);
    const height = u32(b, 20);
    return width > 0 && height > 0 ? { mime: 'image/png', ext: 'png', width, height } : null;
  }
  // GIF: "GIF87a"/"GIF89a" e a tela lógica (largura e altura em 16 bits little-endian)
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) {
    const width = b[6]! | (b[7]! << 8);
    const height = b[8]! | (b[9]! << 8);
    return width > 0 && height > 0 ? { mime: 'image/gif', ext: 'gif', width, height } : null;
  }
  // JPEG: percorre os marcadores até um SOFn (C0–CF exceto C4, C8, CC), que traz altura e largura
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 4 <= b.length) {
      if (b[o] !== 0xff) return null;
      let marker = b[o + 1]!;
      while (marker === 0xff && o + 2 < b.length) {
        o += 1;
        marker = b[o + 1]!;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      if (marker === 0xd9) return null;
      const len = u16(b, o + 2);
      if (len < 2) return null;
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) {
        if (o + 9 > b.length) return null;
        const height = u16(b, o + 5);
        const width = u16(b, o + 7);
        return width > 0 && height > 0 ? { mime: 'image/jpeg', ext: 'jpg', width, height } : null;
      }
      o += 2 + len;
    }
  }
  return null;
}

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Chave no Blob: endereçada pelo conteúdo (repetir o upload do mesmo arquivo é inofensivo). */
export const creativeBlobKey = (sha256: string, ext: ImageInfo['ext']): string => `anuncios/${sha256}.${ext}`;

/** Peso em KB como o domínio mede (arredondado para cima, no mínimo 1). */
export const sizeKB = (bytes: number): number => Math.max(1, Math.ceil(bytes / 1024));
