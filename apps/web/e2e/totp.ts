// Código TOTP (RFC 6238: SHA-1, 6 dígitos, janela de 30 s) a partir do segredo base32 da conta de teste do e2e. Só para os testes.
import { createHmac } from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(s: string): Buffer {
  let bits = 0;
  let valor = 0;
  const saida: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = ALFABETO.indexOf(ch);
    if (i < 0) throw new Error('segredo base32 inválido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}

export function totp(segredoBase32: string, agora = Date.now()): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(agora / 30_000)));
  const h = createHmac('sha1', base32(segredoBase32)).update(contador).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

/** Um código que NÃO vale agora (nem na janela anterior ou seguinte). */
export function totpErrado(segredoBase32: string): string {
  const validos = new Set([-30_000, 0, 30_000].map((d) => totp(segredoBase32, Date.now() + d)));
  for (let n = 0; n < 1000; n++) {
    const c = String((123_456 + n) % 1_000_000).padStart(6, '0');
    if (!validos.has(c)) return c;
  }
  return '000000';
}
