'use client';

import { Button, Header, type HeaderLink } from '@ln/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Editoria } from '../_lib/types';

export interface NavFlags {
  theLoyal: boolean;
  marketData: boolean;
  podcast: boolean;
}

/**
 * Header do design system: barra superior (logo, atalhos, busca) + menu de editorias numa linha com "Mais".
 * No desktop a barra mostra só os atalhos de maior uso; os demais entram no menu recolhível do mobile
 * e no rodapé. Itens de módulos desligados por flag não aparecem.
 */
export function SiteHeader({ flags, editorias }: { flags: NavFlags; editorias: readonly Pick<Editoria, 'slug' | 'name'>[] }) {
  const pathname = usePathname() ?? '/';
  const current = pathname.startsWith('/editoria/') ? pathname.split('/')[2] : undefined;
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const links: (Omit<HeaderLink, 'current'> & { on?: boolean })[] = [
    { href: '/noticias', label: 'Últimas' },
    { href: '/em-alta', label: 'Em alta' },
    ...(flags.marketData ? [{ href: '/indicadores', label: 'Market Data' }] : []),
    ...(flags.podcast ? [{ href: '/podcast', label: 'Podcast' }] : []),
    { href: '/agenda', label: 'Agenda' },
    { href: '/midia-kit', label: 'Anuncie' },
    // só no menu recolhível (mobile); no desktop ficam no rodapé
    { href: '/flash', label: 'Loyalty Flash', barHidden: true },
    { href: '/analises', label: 'Análises', barHidden: true },
    { href: '/entrevistas', label: 'Entrevistas', barHidden: true },
    { href: '/moves', label: 'Moves', barHidden: true },
    { href: '/intelligence', label: 'Intelligence', barHidden: true },
    { href: '/contato', label: 'Contato', barHidden: true },
  ];

  return (
    <Header
      editorias={editorias.map((e) => ({ slug: e.slug, nome: e.name }))}
      currentSlug={current}
      hrefFor={(slug) => `/editoria/${slug}`}
      linkAs={Link}
      mainId="conteudo"
      utilityLabel="Seções do portal"
      utilityLinks={links.map(({ on: _on, ...l }) => ({ ...l, current: isCurrent(l.href) }))}
      actions={
        <>
          {flags.theLoyal && (
            <Button href="/the-loyal" linkAs={Link}>
              The Loyal
            </Button>
          )}
          <Button href="/busca" linkAs={Link} variant="ghost">
            Busca
          </Button>
        </>
      }
    />
  );
}
