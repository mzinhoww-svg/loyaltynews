import type { Metadata } from 'next';
import { ogImagemPadrao } from '../_lib/seo';
import { SITE_NAME, SITE_URL } from '../_lib/site';
import { getSource } from '../_lib/source';

/**
 * SEO das páginas de dados (Intelligence, Moves e agenda) para o lançamento no domínio próprio.
 * No Next, o `openGraph`/`twitter` de uma página SUBSTITUI o do layout por inteiro (não mescla): sem repetir a imagem, a página
 * ficaria sem og:image. Aqui toda página leva título, descrição, canonical (relativo: o `metadataBase` do layout o resolve no domínio
 * do release) e a imagem — a publicada no Studio (seo.ogImage) quando existe, senão a padrão (/og-padrao.png, a mesma do layout).
 */
/**
 * P2-03 da auditoria do int/031: o fallback apontava para /og-padrao.png (1200×627, arte antiga, só o logo), enquanto o
 * layout usa o pacote de marca do lançamento (/og/padrao.png, 1200×630, marca + frase + domínio). Reutilizar a mesma função
 * evita que as duas artes voltem a divergir; a imagem publicada no Studio (seo.ogImage) continua tendo prioridade.
 */
const OG_PADRAO = ogImagemPadrao();

export interface PaginaSeo {
  title: string;
  description: string;
  /** Caminho canônico, começando com "/". */
  path: string;
  type?: 'website' | 'profile' | 'article';
  noindex?: boolean;
}

export async function metadadosPagina(p: PaginaSeo): Promise<Metadata> {
  const ogPublicada = (await getSource().getSiteConfig())?.seo?.ogImage;
  const imagem = ogPublicada ? { url: ogPublicada } : OG_PADRAO;
  return {
    title: p.title,
    description: p.description,
    alternates: { canonical: p.path },
    openGraph: { type: p.type ?? 'website', siteName: SITE_NAME, locale: 'pt_BR', title: p.title, description: p.description, url: p.path, images: [imagem] },
    twitter: { card: 'summary_large_image', title: p.title, description: p.description, images: [imagem.url] },
    ...(p.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

/** URL absoluta no domínio do release (para o JSON-LD, que não passa pelo metadataBase). */
export const urlAbsoluta = (path: string) => new URL(path, SITE_URL).toString();
