export const SITE_NAME = 'Loyalty News';
export const SITE_TAGLINE = 'Portal de inteligência sobre fidelização';
export const SITE_DESCRIPTION =
  'Notícias, análises e tendências sobre programas de fidelidade, pontos e milhas, pagamentos, consumo e relacionamento.';
/** Domínio não assumido (Blueprint §2): vem de configuração; sem valor, usa localhost em dev. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const INSTITUTIONAL_AUTHOR = 'Redação Loyalty News';
