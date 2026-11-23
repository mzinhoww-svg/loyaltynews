import { Footer } from '@ln/ui';
import Link from 'next/link';
import { EDITORIAS } from '../_lib/editorias';
import { flags } from '../_lib/flags';

/**
 * Footer do design system. Sem bloco "Notícias em alta" (já está na lateral); sem redes até serem confirmadas.
 * As seções que saíram da barra (todas as notícias, formatos, contato) ficam aqui.
 */
export function SiteFooter() {
  return (
    <Footer
      editorias={EDITORIAS.map((e) => ({ slug: e.slug, nome: e.name }))}
      hrefFor={(slug) => `/editoria/${slug}`}
      linkAs={Link}
      groups={[
        {
          title: 'Seções',
          links: [
            { label: 'Todas as notícias', href: '/noticias' },
            { label: 'Loyalty Flash', href: '/flash' },
            { label: 'Análises', href: '/analises' },
            { label: 'Entrevistas', href: '/entrevistas' },
            { label: 'Opinião', href: '/opiniao' },
            { label: 'Agenda', href: '/agenda' },
            ...(flags.theLoyal ? [{ label: 'The Loyal', href: '/the-loyal' }] : []),
          ],
        },
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
            { label: 'Loyalty Moves', href: '/moves' },
          ],
        },
      ]}
      note="Canais oficiais e e-mail serão publicados quando confirmados."
    />
  );
}
