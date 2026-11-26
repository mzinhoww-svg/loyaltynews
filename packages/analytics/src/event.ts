import { z } from 'zod';

// Evento de medição do portal. Princípio: o servidor só aceita um conjunto MÍNIMO e FECHADO de campos e reduz cada um ao
// que é necessário para um agregado. Nada que identifique alguém entra: sem e-mail, nome, token, cookie, IP, user agent,
// idioma, resolução exata, query string, fragmento nem URL de origem completa. Campo desconhecido é RECUSADO (R1-07:
// "nenhum e-mail, nome ou token enviado").

export const DEVICE_CLASSES = ['mobile', 'tablet', 'desktop', 'desconhecido'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export const REFERRER_CATEGORIES = ['direto', 'busca', 'social', 'interno', 'outro'] as const;
export type ReferrerCategory = (typeof REFERRER_CATEGORIES)[number];

/** Corpo aceito em `POST /api/analytics/collect`. `.strict()`: qualquer outro campo derruba a requisição. */
export const CollectEventSchema = z
  .object({
    t: z.literal('pageview'),
    /** Só o caminho (`location.pathname`). A query e o fragmento são descartados no servidor mesmo que venham. */
    path: z.string().min(1).max(300),
    /** `document.referrer` bruto: o servidor guarda só a CATEGORIA e descarta o resto (host, caminho e query). */
    ref: z.string().max(500).optional(),
    /** Largura da janela em px: vira classe de dispositivo; o valor exato não é guardado. */
    w: z.number().int().min(1).max(20000).optional(),
  })
  .strict();
export type CollectEvent = z.infer<typeof CollectEventSchema>;

export const MAX_PATH_SEGMENTS = 8;
export const MAX_NORMALIZED_PATH = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_TOKEN_RE = /^[0-9a-f]{16,}$/i;
const SAFE_SEGMENT_RE = /^[a-z0-9][a-z0-9._~-]*$/;

/**
 * Normaliza o caminho para o agregado: descarta query e fragmento; troca por `:id` segmentos que parecem identificador
 * (e-mail, sequência de 6+ dígitos como CPF/telefone, UUID, hexadecimal longo, token longo misto); minúsculas; sem barra
 * final; no máximo 8 segmentos. Devolve `null` se não for um caminho utilizável (não começa com `/`, vazio, longo demais).
 */
export function normalizePath(raw: string): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null;
  const noQuery = raw.split(/[?#]/, 1)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(noQuery);
  } catch {
    return null;
  }
  const segments = decoded.split('/').filter((s) => s.length > 0);
  if (segments.length > MAX_PATH_SEGMENTS) return null;
  const clean = segments.map((seg) => {
    const s = seg.toLowerCase();
    if (s.includes('@')) return ':id';
    // CPF com pontos (123.456.789-01): sem esta regra o segmento passaria inteiro (achado A1 do QA 2).
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(s)) return ':id';
    if (/\d{6,}/.test(s)) return ':id';
    if (UUID_RE.test(s) || HEX_TOKEN_RE.test(s)) return ':id';
    if (s.length > 48) return ':id';
    // token longo misto (letras e dígitos sem hífen), típico de chave/sessão
    if (s.length >= 24 && /[a-z]/.test(s) && /\d/.test(s) && !s.includes('-')) return ':id';
    if (!SAFE_SEGMENT_RE.test(s)) return ':id';
    return s;
  });
  const out = `/${clean.join('/')}`;
  return out.length > MAX_NORMALIZED_PATH ? null : out;
}

// TLDs de busca listados de forma FECHADA: `google.com.evil.example` não pode casar (teste de sufixo enganoso).
const SEARCH_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:google\.(?:com|co|[a-z]{2,3})(?:\.[a-z]{2})?|bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|yandex\.(?:com|ru|by|kz|ua|com\.tr))$/;
const SOCIAL_HOSTS = [
  'linkedin.com', 'lnkd.in', 'instagram.com', 'facebook.com', 'fb.com', 'x.com', 'twitter.com', 't.co', 'threads.net',
  'youtube.com', 'youtu.be', 'whatsapp.com', 'wa.me', 't.me', 'tiktok.com', 'reddit.com',
];

/**
 * Reduz `document.referrer` a UMA categoria. O host só serve para classificar e é descartado em seguida; nunca é guardado.
 * `ownHosts`: hosts do próprio portal (referência interna).
 */
export function classifyReferrer(ref: string | undefined, ownHosts: readonly string[] = []): ReferrerCategory {
  if (!ref) return 'direto';
  let host: string;
  try {
    const u = new URL(ref);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'outro';
    host = u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'outro';
  }
  if (!host) return 'direto';
  const own = ownHosts.map((h) => h.toLowerCase().replace(/^www\./, ''));
  if (own.includes(host)) return 'interno';
  if (SEARCH_HOST_RE.test(host)) return 'busca';
  if (SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) return 'social';
  return 'outro';
}

/** Classe de dispositivo pela largura da janela. Sem user agent (evita impressão digital). */
export function deviceClass(w: number | undefined): DeviceClass {
  if (w === undefined) return 'desconhecido';
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}
