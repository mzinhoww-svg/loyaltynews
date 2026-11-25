import type { Metadata } from 'next';
import { getEditoria } from './editorias';
import { SITE_NAME, SITE_URL } from './site';

/**
 * SEO técnico do portal (lançamento com domínio próprio): imagens de compartilhamento por editoria, robots de produção, canonical de listagens
 * paginadas e dados estruturados reutilizáveis. Tudo relativo ao domínio do release (`SITE_URL` = NEXT_PUBLIC_SITE_URL do build).
 */

const OG_LARGURA = 1200;
const OG_ALTURA = 627;
/** Imagem de compartilhamento padrão (public/og-padrao.png, V-14): vale até a UI/UX entregar os assets por editoria. */
export const OG_PADRAO_URL = '/og-padrao.png';

/**
 * Assets de og:image por editoria, entregues pela UI/UX em public/og/editorias/<slug>.png (1200×627). Enquanto o slug não está aqui vale o padrão
 * (a estrutura, o alt por editoria e o teste já estão prontos: para publicar um asset basta acrescentar a linha).
 */
export const OG_EDITORIA_ASSETS: Readonly<Record<string, string>> = {};

export interface OgImagem {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export function ogImagemPadrao(): OgImagem {
  return { url: OG_PADRAO_URL, width: OG_LARGURA, height: OG_ALTURA, alt: SITE_NAME };
}

/** og:image da editoria (asset próprio quando existir; senão o padrão), com alt da editoria. */
export function ogImagemDaEditoria(slug: string): OgImagem {
  const nome = getEditoria(slug)?.name;
  return { url: OG_EDITORIA_ASSETS[slug] ?? OG_PADRAO_URL, width: OG_LARGURA, height: OG_ALTURA, alt: nome ? `${SITE_NAME}: ${nome}` : SITE_NAME };
}

/** Robots de produção indexável: o Google Discover e o Google Notícias pedem prévia grande de imagem. */
export const ROBOTS_INDEXAVEL: NonNullable<Metadata['robots']> = {
  index: true,
  follow: true,
  googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
};

/** Página pedida na URL (?page=N), mínimo 1. */
export const paginaDe = (raw: string | undefined): number => {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 1 ? n : 1;
};

/** Canonical de listagem paginada: a 1ª página é o caminho puro; as demais apontam para si mesmas (?page=N), nunca para a 1ª. */
export const canonicalPaginado = (path: string, page: number): string => (page > 1 ? `${path}?page=${page}` : path);

/** Título único por página da listagem ("Análises — página 2"). */
export const tituloPaginado = (titulo: string, page: number): string => (page > 1 ? `${titulo} — página ${page}` : titulo);

/** Descrição única por página da listagem. */
export const descricaoPaginada = (descricao: string, page: number): string => (page > 1 ? `${descricao} Página ${page}.` : descricao);

/** Publisher (Organization com logo) dos dados estruturados. O logo usa a imagem padrão até a UI/UX entregar o asset da marca. */
export const PUBLISHER_LD = {
  '@type': 'Organization',
  name: SITE_NAME,
  url: SITE_URL,
  logo: { '@type': 'ImageObject', url: `${SITE_URL}${OG_PADRAO_URL}`, width: OG_LARGURA, height: OG_ALTURA },
} as const;

/** BreadcrumbList (schema.org); `path` ausente = página atual. */
export function breadcrumbLd(trilha: { nome: string; path?: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trilha.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.nome, ...(t.path ? { item: `${SITE_URL}${t.path}` } : {}) })),
  };
}
