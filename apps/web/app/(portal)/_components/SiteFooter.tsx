import { Footer } from '@ln/ui';
import Link from 'next/link';
import { EDITORIAS } from '../_lib/editorias';
import { flags } from '../_lib/flags';
import { getSource } from '../_lib/source';

/** Footer do design system + grupos institucionais; "em alta" real só quando existir (sem dado inventado). */
export async function SiteFooter() {
  const trending = (await getSource().getTrending('7d')).slice(0, 3);
  return (
    <>
      {trending.length > 0 && (
        <aside className="pt-wrap pt-section" aria-label="Notícias em alta">
          <h2 className="pt-kicker" style={{ fontSize: 13 }}>Notícias em alta</h2>
          <ul className="pt-list">
            {trending.map((a) => (
              <li key={a.slug}>
                <Link href={`/noticia/${a.slug}`}>{a.title}</Link>
              </li>
            ))}
          </ul>
        </aside>
      )}
      <Footer
        editorias={EDITORIAS.map((e) => ({ slug: e.slug, nome: e.name }))}
        hrefFor={(slug) => `/editoria/${slug}`}
        linkAs={Link}
        groups={[
          {
            title: 'Informações',
            links: [
              { label: 'Sobre', href: '/sobre' },
              { label: 'Metodologia', href: '/metodologia' },
              { label: 'Política editorial', href: '/politica-editorial' },
              { label: 'Direitos, créditos e correções', href: '/correcoes' },
              { label: 'Privacidade e LGPD', href: '/privacidade' },
              { label: 'Termos de uso', href: '/termos' },
              { label: 'Política de publicidade', href: '/publicidade' },
            ],
          },
          {
            title: 'Contato',
            links: [
              { label: 'Fale conosco', href: '/contato' },
              { label: 'Anuncie · Mídia kit', href: '/midia-kit' },
              { label: 'Loyalty Intelligence', href: '/intelligence' },
              { label: 'Agenda', href: '/agenda' },
              ...(flags.theLoyal ? [{ label: 'The Loyal', href: '/the-loyal' }] : []),
            ],
          },
        ]}
        note="Portal de inteligência sobre fidelização. Canais oficiais e e-mail serão publicados quando confirmados."
      />
    </>
  );
}
