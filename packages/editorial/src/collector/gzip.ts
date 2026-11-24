import { gunzip } from 'node:zlib';

/**
 * Descompressão de sitemaps `.xml.gz` (gov.br e outros publicam os filhos do índice assim). Defesa contra "zip bomb":
 * o tamanho da SAÍDA é limitado pelo próprio zlib (`maxOutputLength`: a descompressão aborta ao passar do teto, sem alocar o resto),
 * e a entrada já vem limitada pelo fetcher (2 MB). Só descompacta gzip (magic 1f 8b); nunca executa nada do conteúdo.
 */
export const DEFAULT_MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024; // sitemap de 50 mil URLs ≈ 5 MB; 10 MB cobre com folga

export class GzipError extends Error {
  constructor(readonly code: 'gzip_invalid' | 'decompressed_too_large', message: string) { super(message); }
}

/** Começa com o cabeçalho gzip (1f 8b)? */
export function isGzip(bytes: Uint8Array | undefined): boolean {
  return !!bytes && bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Descomprime com teto de saída. Lança GzipError('decompressed_too_large') ou GzipError('gzip_invalid'). */
export function gunzipCapped(bytes: Uint8Array, maxBytes = DEFAULT_MAX_DECOMPRESSED_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    gunzip(bytes, { maxOutputLength: maxBytes }, (err, out) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // Node sinaliza o estouro de maxOutputLength como RangeError ERR_BUFFER_TOO_LARGE
        if (code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) reject(new GzipError('decompressed_too_large', `sitemap descomprimido passa de ${maxBytes} bytes`));
        else reject(new GzipError('gzip_invalid', `gzip inválido (${code ?? err.message})`.slice(0, 160)));
        return;
      }
      resolve(out.toString('utf8'));
    });
  });
}
