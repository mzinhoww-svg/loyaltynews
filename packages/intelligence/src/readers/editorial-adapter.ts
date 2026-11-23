/**
 * Ponte para o contrato do coletor do Editorial (ft/editorial 7b35efa, packages/editorial/src/collector/collector.ts):
 *   ReaderPort { name; unlocks?; read(url): Promise<ReaderResult>; discover?(source, limit) }
 *   ReaderResult { status; body; format?: 'html'|'text'; retryAfterSec?; failedUrl?; quotaExhausted? }
 * As interfaces abaixo ESPELHAM esse contrato de forma estrutural (nenhum import entre pacotes). Regras do Editorial:
 *   quotaExhausted: true  só quando a COTA acabou em todas as chaves da conta (ele passa ao próximo provedor);
 *   failedUrl: true       o provedor não conseguiu ESTA URL (bloqueio, login, paywall, desafio não resolvido, erro);
 *   status 429 + retryAfterSec  só para ritmo do serviço (o Editorial para a coleta da fonte e NÃO troca de provedor);
 *   unlocks: true         o provedor resolve CAPTCHA/proxy (informativo).
 * O `ChainedReader` do Editorial recebe estes leitores na ordem que `orderByCost` devolve.
 */
import type { ReadResult, ReaderPort } from '../reader-port';

export interface EditorialReaderResult {
  status: number;
  body: string;
  format?: 'html' | 'text';
  retryAfterSec?: number | null;
  failedUrl?: boolean;
  quotaExhausted?: boolean;
}

export interface EditorialReaderPort {
  readonly name: string;
  readonly unlocks?: boolean;
  read(url: string): Promise<EditorialReaderResult>;
}

/** Tradução de `ReadResult` (pool) para o `ReaderResult` do Editorial. O corpo só existe no sucesso; em qualquer falha vai vazio. */
export function toEditorialResult(r: ReadResult): EditorialReaderResult {
  if (r.ok) {
    const html = r.html;
    return { status: r.httpStatus ?? 200, body: html ?? r.text ?? '', format: html ? 'html' : 'text' };
  }
  switch (r.failure) {
    case 'quota_exhausted':
    case 'auth_failed': // todas as chaves recusadas/sem cota: não é culpa da fonte
      return { status: 432, body: '', quotaExhausted: true };
    case 'rate_limited':
    case 'host_paced':
      return { status: 429, body: '', retryAfterSec: r.retryAfterSeconds ?? 30 };
    case 'login_required':
      return { status: 401, body: '', failedUrl: true };
    case 'paywall':
      return { status: 402, body: '', failedUrl: true };
    case 'captcha_unsolved':
      return { status: 403, body: '', failedUrl: true };
    case 'not_found':
      return { status: 404, body: '' };
    case 'timeout':
      return { status: 504, body: '', failedUrl: true };
    case 'disabled':
      return { status: 503, body: '', failedUrl: true };
    default:
      return { status: 502, body: '', failedUrl: true };
  }
}

export function asEditorialReader(reader: ReaderPort & { unlocks?: boolean }, name?: string): EditorialReaderPort {
  return {
    name: name ?? reader.provider,
    unlocks: reader.unlocks,
    async read(url: string) {
      return toEditorialResult(await reader.read({ url, purpose: 'read' }));
    },
  };
}

/** Ordena do mais barato ao mais caro em fração da cota gratuita por leitura (desempate: quem desbloqueia vem depois). Sem custo declarado = fim. */
export function orderByCost<T extends { freeQuotaFractionPerRead?: number; unlocks?: boolean }>(readers: T[]): T[] {
  const f = (r: T) => r.freeQuotaFractionPerRead ?? Number.POSITIVE_INFINITY;
  return [...readers].sort((a, b) => f(a) - f(b) || Number(a.unlocks === true) - Number(b.unlocks === true));
}
