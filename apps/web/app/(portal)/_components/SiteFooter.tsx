import { Footer } from '@ln/ui';
import Link from 'next/link';
import { EDITORIAS } from '../_lib/editorias';
import { flags } from '../_lib/flags';

/**
 * Footer do design system (logo, frase institucional, editorias) + grupos de links.
 * Redes sociais só entram quando as URLs oficiais forem confirmadas (nada inventado).
 */
export function SiteFooter() {
  return (
    <Footer
      editorias={EDITORIAS.map((e) => ({ slug: e.slug, nome: e.name }))}
      hrefFor={(slug) => `/editoria/${slug}`}
      linkAs={Link}
      groups={[
        {
          title: 'Conteúdo',
          links: [
            { label: 'Últimas notícias', href: '/noticias' },
            { label: 'Em alta', href: '/em-alta' },
            { label: 'Loyalty Flash', href: '/flash' },
            { label: 'Análises', href: '/analises' },
            { label: 'Entrevistas', href: '/entrevistas' },
            { label: 'Agenda', href: '/agenda' },
            { label: 'Moves', href: '/moves' },
            { label: 'Loyalty Intelligence', href: '/intelligence' },
            ...(flags.theLoyal ? [{ label: 'The Loyal', href: '/the-loyal' }] : []),
          ],
        },
        {
          title: 'Institucional',
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
          ],
        },
      ]}
      note="Canais oficiais e e-mail serão publicados quando confirmados."
    />
  );
}
