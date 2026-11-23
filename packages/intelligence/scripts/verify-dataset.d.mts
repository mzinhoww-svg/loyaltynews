export const UA: string;
export function htmlToText(html: string): string;
export function robotsAllows(url: string, fetchImpl?: typeof fetch): Promise<{ allowed: boolean; note: string; sitemaps: string[] }>;
export function fetchText(
  url: string,
  fetchImpl?: typeof fetch,
): Promise<{
  status: number;
  finalUrl: string;
  location: string | null;
  contentType: string;
  headers: Record<string, string>;
  html: string;
  text: string;
  estado: 'ok' | 'redirecionada' | 'bloqueada_http' | 'bloqueada_desafio' | 'indisponivel';
  observacao: string;
}>;
