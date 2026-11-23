import { createHmac, timingSafeEqual } from 'node:crypto';

// Assinatura HMAC-SHA256 das chamadas do OpenBot (pull, heartbeat, callback). O segredo nunca é gravado aqui: quem chama
// entrega uma lista de segredos (atual e anterior, para rotação) lida do cofre. Servidor apenas (node:crypto).

export const SIGNATURE_VERSION = 'v1';
export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

/** Cabeçalho `v1=<hex>`: HMAC(secret, `${timestampMs}.${body}`). */
export function signBody(secret: string, timestampMs: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestampMs}.${body}`).digest('hex');
  return `${SIGNATURE_VERSION}=${mac}`;
}

export type VerifyResult =
  | { ok: true; keyIndex: number }
  | { ok: false; reason: 'sem_segredo' | 'formato_invalido' | 'timestamp_fora_da_janela' | 'assinatura_invalida' };

export interface VerifyInput {
  /** Segredos aceitos: o atual primeiro, depois os anteriores (rotação). Vazio = recusa. */
  secrets: readonly string[];
  header: string | undefined;
  timestampMs: number | undefined;
  body: string;
  now: Date;
  toleranceMs?: number;
}

export function verifySignature(input: VerifyInput): VerifyResult {
  const secrets = input.secrets.filter((s) => s.length > 0);
  if (secrets.length === 0) return { ok: false, reason: 'sem_segredo' };
  const { header, timestampMs, body } = input;
  if (typeof header !== 'string' || !header.startsWith(`${SIGNATURE_VERSION}=`) || !Number.isFinite(timestampMs)) {
    return { ok: false, reason: 'formato_invalido' };
  }
  const tolerance = input.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  if (Math.abs(input.now.getTime() - (timestampMs as number)) > tolerance) {
    return { ok: false, reason: 'timestamp_fora_da_janela' };
  }
  const given = Buffer.from(header.slice(SIGNATURE_VERSION.length + 1), 'hex');
  for (let i = 0; i < secrets.length; i++) {
    const expected = Buffer.from(signBody(secrets[i] as string, timestampMs as number, body).slice(SIGNATURE_VERSION.length + 1), 'hex');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true, keyIndex: i };
  }
  return { ok: false, reason: 'assinatura_invalida' };
}
