import { Footer } from '@ln/ui';
import Link from 'next/link';
import { EDITORIAS } from '../_lib/editorias';
import { flags } from '../_lib/flags';
import { getSource } from '../_lib/source';
import type { SiteMenuItem } from '../_lib/types';

/**
 * Footer do design system (logo, frase institucional, editorias) + grupos de links.
 * Redes sociais só entram quando as URLs oficiais forem confirmadas (nada inventado).
 */
/** Grupos do rodapé publicados no Studio: item com `filhos` = grupo (título + links); itens soltos viram o grupo "Links". */
function publishedGroups(items: readonly SiteMenuItem[]) {
  const groups = items.filter((i) => i.children.length > 0).map((i) => ({ title: i.label, links: i.children.map((c) => ({ label: c.label, href: c.href })) }));
  const loose = items.filter((i) => i.children.length === 0).map((i) => ({ label: i.label, href: i.href }));
  return loose.length ? [{ title: 'Links', links: loose }, ...groups] : groups;
}

export async function SiteFooter() {
  const site = await getSource().getSiteConfig();
  const published = site?.menus.footer ? publishedGroups(site.menus.footer) : null;
  return (
    <Footer
      editorias={EDITORIAS.map((e) => ({ slug: e.slug, nome: e.name }))}
      hrefFor={(slug) => `/editoria/${slug}`}
      linkAs={Link}
      entrar={{ href: '/studio/entrar', label: 'Entrar' }}
      groups={published ?? [
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
