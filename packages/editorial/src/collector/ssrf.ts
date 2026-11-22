import { isIP } from 'node:net';

export class UrlRejected extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v = isIP(h);
  if (v === 4) return ipv4Private(h);
  if (v === 6) {
    if (h === '::1' || h === '::') return true;
    if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (m) return ipv4Private(m[1]!);
    return false;
  }
  // formas numéricas/hex/octal de IPv4 (ex.: 2130706433, 0x7f.1) são recusadas
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(h)) return true;
  return false;
}

/** Valida URL de coleta: http(s), sem credenciais, sem host privado, host dentro da allowlist. */
export function assertAllowedUrl(raw: string, allowedHosts: readonly string[]): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UrlRejected('invalid_url', `URL inválida: ${raw}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new UrlRejected('bad_scheme', `esquema ${u.protocol}`);
  if (u.username || u.password) throw new UrlRejected('credentials_in_url', 'credenciais na URL');
  if (isPrivateHost(u.hostname)) throw new UrlRejected('private_host', `host privado: ${u.hostname}`);
  if (!allowedHosts.map((h) => h.toLowerCase()).includes(u.hostname.toLowerCase())) {
    throw new UrlRejected('host_not_allowed', `host fora da lista permitida: ${u.hostname}`);
  }
  return u;
}
