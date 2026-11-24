import { createHmac } from 'node:crypto';

// TOTP (RFC 6238, HMAC-SHA1, 6 dígitos, passo de 30 s) a partir do segredo em base32, sem dependência externa.
// Só para o smoke de login do Studio: o segredo vem do ambiente e nunca é gravado nem impresso.

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32ParaBytes(segredo: string): Buffer {
  const limpo = segredo.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let valor = 0;
  const saida: number[] = [];
  for (const ch of limpo) {
    const i = ALFABETO.indexOf(ch);
    if (i < 0) throw new Error('Segredo TOTP inválido (base32).');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}

export function totp(segredoBase32: string, agoraMs: number = Date.now(), passo = 30, digitos = 6): string {
  const contador = Math.floor(agoraMs / 1000 / passo);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const h = createHmac('sha1', base32ParaBytes(segredoBase32)).update(msg).digest();
  const o = h[h.length - 1]! & 0x0f;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** digitos).padStart(digitos, '0');
}

/** Segundos até o código atual expirar (para não enviar um código no último segundo da janela). */
export const segundosRestantes = (agoraMs: number = Date.now(), passo = 30) => passo - (Math.floor(agoraMs / 1000) % passo);
