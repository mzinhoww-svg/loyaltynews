/** Tipos do benchmark. Nada aqui guarda texto integral (DP-29/DP-32): só métricas, título, data, tamanho, hash e trecho curto. */

export type Category = 'financeiro' | 'fintech' | 'aviacao-fidelidade' | 'tecnologia' | 'restritivo' | 'internacional';
export type Recency = 'recente' | 'historico' | 'problema';
export type Difficulty = 'baixa' | 'media' | 'alta';

export interface DatasetEntry {
  id: string; // u001..u100
  url: string;
  domain: string;
  category: Category;
  recency: Recency;
  country: string;
  language: string;
  publishedAt: string | null; // ISO, como a fonte de descoberta informou
  contentType: 'noticia' | 'release' | 'artigo' | 'nota-oficial';
  difficulty: Difficulty;
  discoveryMethod: 'rss' | 'atom' | 'sitemap' | 'manual-seed';
  discoverySource: string; // URL do feed/sitemap
  accessCondition: 'publico' | 'paywall-parcial' | 'bloqueio-tecnico';
  paywall: boolean;
  needsJs: boolean | null; // null = não verificado
  errorHistory: string | null; // ex.: "403 ao UA direto (seed.ts)"
  referenceTitle: string; // título da descoberta (referência para Title Accuracy)
}

export type ErrorClass =
  | 'none'
  | 'http_403'
  | 'http_429'
  | 'http_4xx'
  | 'http_5xx'
  | 'timeout'
  | 'captcha'
  | 'login_required'
  | 'paywall'
  | 'quota_exhausted'
  | 'budget_blocked'
  | 'billing_unconfirmed'
  | 'provider_error'
  | 'auth_failed'
  | 'empty_content'
  | 'title_mismatch'
  | 'not_found'
  | 'ssrf_blocked'
  | 'disabled';

/** Uma tentativa URL × provedor (Diretiva V3 §9 e §13). `content` NUNCA é gravado: só hash, tamanho e trecho ≤ 200. */
export interface AttemptRecord {
  experimentId: string;
  runId: string;
  correlationId: string;
  codeVersion: string;
  at: string;
  provider: string;
  mode?: string;
  urlId: string;
  url: string;
  finalUrl?: string;
  domain: string;
  httpStatus?: number;
  durationMs: number;
  technicalSuccess: boolean;
  editorialSuccess: boolean;
  errorClass: ErrorClass;
  title?: string;
  author?: string;
  publishedAt?: string;
  language?: string;
  textLength: number;
  contentHash?: string;
  snippet?: string;
  titleMatch?: number; // 0..1 vs referenceTitle
  sourceMatch?: boolean;
  dateMatch?: boolean | null; // null = não verificável
  creditsUsed: number;
  costEstimatedUsd: number;
  costEffectiveUsd: number | null; // só quando o provedor informa
  cacheState: 'miss' | 'hit' | 'bypass';
  retries: number;
  mock: boolean; // true = resposta simulada (nunca entra no ranking real)
}
