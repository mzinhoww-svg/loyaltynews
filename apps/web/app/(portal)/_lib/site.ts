import { resolveSiteUrl } from './indexing';

export const SITE_NAME = 'Loyalty News';
export const SITE_TAGLINE = 'Portal de inteligência sobre fidelização';
export const SITE_DESCRIPTION =
  'Notícias, análises e tendências sobre programas de fidelidade, pontos e milhas, pagamentos, consumo e relacionamento.';
/** Domínio não assumido (Blueprint §2): vem de NEXT_PUBLIC_SITE_URL; em produção o build falha sem ela. */
export const SITE_URL = resolveSiteUrl();
export const INSTITUTIONAL_AUTHOR = 'Redação Loyalty News';
