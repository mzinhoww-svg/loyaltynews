import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter/index.css';
import { DemoBanner } from '@ln/ui';
import '@ln/ui/styles.css';
import './portal.css';
import { SiteFooter } from './_components/SiteFooter';
import { SiteHeader } from './_components/SiteHeader';
import { EDITORIAS } from './_lib/editorias';
import { flags } from './_lib/flags';
import { indexingBlocked } from './_lib/indexing';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from './_lib/site';
import { isMockSource } from './_lib/source';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — ${SITE_TAGLINE}`, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { type: 'website', siteName: SITE_NAME, locale: 'pt_BR', title: SITE_NAME, description: SITE_DESCRIPTION },
  twitter: { card: 'summary_large_image', title: SITE_NAME, description: SITE_DESCRIPTION },
  alternates: { canonical: '/' },
  // Fora de produção (APP_ENV diferente de "production") ou com dados MOCK: noindex/nofollow global, herdado por todas as páginas.
  robots: indexingBlocked() ? { index: false, follow: false, nocache: true } : undefined,
};

export const viewport: Viewport = { themeColor: '#153c3c', width: 'device-width', initialScale: 1 };

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ln-root pt">
      {/* Faixa fina de demonstração em TODA página com conteúdo MOCK/vitrine (Security R5). */}
      {isMockSource() && <DemoBanner />}
      <SiteHeader flags={{ theLoyal: flags.theLoyal, marketData: flags.marketData, podcast: flags.podcast }} editorias={EDITORIAS} />
      <main id="conteudo" className="pt-main">
        <div className="pt-wrap">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
