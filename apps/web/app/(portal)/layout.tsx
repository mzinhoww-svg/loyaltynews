import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './portal.css';
import { SiteFooter } from './_components/SiteFooter';
import { SiteHeader } from './_components/SiteHeader';
import { EDITORIAS, TECH_EDITORIA_SLUG } from './_lib/editorias';
import { flags } from './_lib/flags';
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
};

export const viewport: Viewport = { themeColor: '#153c3c', width: 'device-width', initialScale: 1 };

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ln">
      {isMockSource() && (
        <div className="ln-mockbar" role="note">
          MOCK — conteúdo sintético de teste. Nenhuma matéria, evento ou pessoa aqui é real.
        </div>
      )}
      <a href="#conteudo" className="ln-skip">
        Ir para o conteúdo
      </a>
      <SiteHeader flags={{ theLoyal: flags.theLoyal, marketData: flags.marketData, podcast: flags.podcast }} editorias={EDITORIAS} techSlug={TECH_EDITORIA_SLUG} />
      <main id="conteudo" className="ln-main">
        <div className="ln-wrap">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
