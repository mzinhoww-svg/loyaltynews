/**
 * Consentimento de cookies analíticos (LGPD) e regra de carga do GA4 no portal. Mesmo modelo do @ln/analytics (consent.ts, J-15):
 * GA4 é `medicao_terceiros` — grava cookie e envia dado a terceiro —, então só com OPT-IN explícito, desligado por padrão, só para a
 * versão vigente da política e barrado por GPC/DNT. Fica no portal (e não no pacote) porque o pacote, por desenho, proíbe qualquer
 * código de terceiro (teste privacy-properties).
 * Funções puras: o componente do navegador só lê o armazenamento e chama estas.
 */

/** Versão da política de cookies. Mudou o texto da política: suba a versão, e o consentimento antigo deixa de valer. */
export const POLITICA_COOKIES_VERSAO = '2026-11-25';
export const CHAVE_CONSENTIMENTO = 'ln-consentimento';

export interface Consentimento {
  versao: string;
  /** ISO 8601. */
  em: string;
  analiticos: boolean;
}

/** ID de medição do GA4 válido (público, não é segredo). Qualquer outro formato é ignorado. */
export const ID_GA = /^G-[A-Z0-9]{6,12}$/;

/** Lê o consentimento guardado. Formato inválido, versão antiga ou JSON quebrado = sem consentimento. */
export function lerConsentimento(bruto: string | null): Consentimento | null {
  if (!bruto) return null;
  try {
    const c = JSON.parse(bruto) as Partial<Consentimento>;
    if (c.versao !== POLITICA_COOKIES_VERSAO || typeof c.analiticos !== 'boolean' || typeof c.em !== 'string') return null;
    return { versao: c.versao, em: c.em, analiticos: c.analiticos };
  } catch {
    return null;
  }
}

export const gravarConsentimento = (analiticos: boolean, agora = new Date()): string =>
  JSON.stringify({ versao: POLITICA_COOKIES_VERSAO, em: agora.toISOString(), analiticos } satisfies Consentimento);

export interface Contexto {
  /** NEXT_PUBLIC_GA_ID (constante de build). */
  idGa: string | undefined;
  /** O ambiente é a produção indexável (APP_ENV=production com PORTAL_INDEXAVEL=1). Staging, vitrine e preview: nunca. */
  producao: boolean;
  consentimento: Consentimento | null;
  /** Global Privacy Control / Do Not Track ligados no navegador. */
  sinalNaoRastrear: boolean;
}

/** Pode carregar o GA4? Todas as condições juntas; na dúvida, não. */
export function podeCarregarGa(c: Contexto): boolean {
  return Boolean(c.idGa && ID_GA.test(c.idGa)) && c.producao && !c.sinalNaoRastrear && c.consentimento?.analiticos === true;
}

/** O banner aparece só onde a medição pode existir (produção com ID) e enquanto não há escolha para a versão vigente. */
export const mostrarBanner = (c: Omit<Contexto, 'sinalNaoRastrear'>): boolean =>
  Boolean(c.idGa && ID_GA.test(c.idGa)) && c.producao && c.consentimento === null;

/**
 * Configuração do gtag sem dado pessoal: IP anonimizado, sem sinais de publicidade nem personalização, e a página enviada só como
 * caminho, SEM query string (formulário e busca podem levar e-mail ou termo pessoal na URL).
 */
export function configGa(caminho: string, origem: string) {
  const limpo = caminho.split('?')[0]!.split('#')[0]! || '/';
  return {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    // page_location EXPLÍCITO: sem ele o GA4 usa location.href inteiro e envia a query (ex.: /busca?q=termo) no parâmetro dl.
    page_location: `${origem}${limpo}`,
    page_path: limpo,
    send_page_view: true,
  };
}
