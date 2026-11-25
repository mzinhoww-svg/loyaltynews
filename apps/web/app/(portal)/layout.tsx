import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@ln/ui/styles.css';
import './portal.css';
import { DemoBanner } from '@ln/ui';
import { ConsentimentoCookies } from './_consentimento/Consentimento';
import { SiteFooter } from './_components/SiteFooter';
import { SiteHeader } from './_components/SiteHeader';
import { EDITORIAS } from './_lib/editorias';
import { flags } from './_lib/flags';
import { indexingBlocked } from './_lib/indexing';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from './_lib/site';
import { getSource, isMockSource } from './_lib/source';

/**
 * Metadados globais. Com a fonte api, título/descrição/imagem OG vêm do SEO publicado no Studio (seo_global); sem isso valem os padrões.
 * `indexacao: noindex` publicado SOMA-SE ao bloqueio de indexação do ambiente: nunca o relaxa.
 */
/**
 * Imagem de compartilhamento padrão (V-14, 1200×627, em public/). Não é arquivo de convenção do App Router (opengraph-image.*),
 * porque esse tipo de arquivo vence o metadata e ignoraria a imagem publicada no Studio (seo.ogImage, F-29): o publicado vale; o padrão só quando não há nada.
 */
const OG_PADRAO = [{ url: '/og-padrao.png', width: 1200, height: 627, alt: 'Loyalty News' }];

export async function generateMetadata(): Promise<Metadata> {
  const seo = (await getSource().getSiteConfig())?.seo ?? null;
  const title = seo?.title ?? `${SITE_NAME} — ${SITE_TAGLINE}`;
  const description = seo?.description ?? SITE_DESCRIPTION;
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: `%s | ${SITE_NAME}` },
    description,
    applicationName: SITE_NAME,
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'pt_BR', title: seo?.title ?? SITE_NAME, description, images: seo?.ogImage ? [{ url: seo.ogImage }] : OG_PADRAO },
    twitter: { card: 'summary_large_image', title: seo?.title ?? SITE_NAME, description, images: seo?.ogImage ? [seo.ogImage] : [OG_PADRAO[0]!.url] },
    alternates: { canonical: '/' },
    // Fora de produção, sem PORTAL_INDEXAVEL=1, com dados MOCK ou com noindex publicado: noindex/nofollow global, herdado por todas as páginas.
    robots: indexingBlocked() || seo?.noindex ? { index: false, follow: false, nocache: true } : undefined,
  };
}

export const viewport: Viewport = { themeColor: '#153c3c', width: 'device-width', initialScale: 1 };

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const site = await getSource().getSiteConfig();
  return (
    <div className="ln-root pt">
      {/* Faixa fina e fixa quando o conteúdo é de demonstração (fonte MOCK). Nunca em produção real. */}
      {(process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_PORTAL_DEMO === '1') && isMockSource() && <DemoBanner />}
      <SiteHeader flags={{ theLoyal: flags.theLoyal, marketData: flags.marketData, podcast: flags.podcast }} editorias={EDITORIAS} mainMenu={site?.menus.main ?? null} />
      <main id="conteudo" className="pt-main">
        <div className="pt-wrap">{children}</div>
      </main>
      <SiteFooter />
      {/* GA4 só na produção indexável (mesma regra da indexação: nunca staging, vitrine ou MOCK) e só depois do aceite (LGPD). */}
      <ConsentimentoCookies producao={!indexingBlocked()} />
    </div>
  );
}
