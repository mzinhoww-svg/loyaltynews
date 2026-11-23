'use client';

import { Button, Header, SearchIconLink, type HeaderLink, type HeaderMenu } from '@ln/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Editoria } from '../_lib/types';

export interface NavFlags {
  theLoyal: boolean;
  marketData: boolean;
  podcast: boolean;
}

/**
 * Cabeçalho do portal (decisão do proprietário DP-16: opção B). Barra única com poucas entradas fixas
 * (Agenda, Entrevistas, Moves, Intelligence) + menu "Notícias ▾" (mega-menu com a coluna Conteúdo e as 10
 * editorias) + busca em ícone + botão Anuncie. As editorias não ficam numa faixa própria no topo.
 * Itens de módulos desligados por flag não aparecem.
 */
export function SiteHeader({ flags, editorias }: { flags: NavFlags; editorias: readonly Pick<Editoria, 'slug' | 'name'>[] }) {
  const pathname = usePathname() ?? '/';
  const current = pathname.startsWith('/editoria/') ? pathname.split('/')[2] : undefined;
  const on = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const L = (href: string, label: string): HeaderLink => ({ href, label, current: on(href) });

  const optional = [
    ...(flags.marketData ? [L('/indicadores', 'Market Data')] : []),
    ...(flags.podcast ? [L('/podcast', 'Podcast')] : []),
  ];

  const links: HeaderLink[] = [L('/agenda', 'Agenda'), L('/entrevistas', 'Entrevistas'), ...optional, L('/moves', 'Moves'), L('/intelligence', 'Intelligence')];
  const menu: HeaderMenu = {
    label: 'Notícias',
    position: 0,
    contentTitle: 'Conteúdo',
    contentLinks: [L('/noticias', 'Todas as notícias'), L('/em-alta', 'Em alta'), L('/flash', 'Loyalty Flash'), L('/analises', 'Análises')],
  };

  return (
    <Header
      editorias={editorias.map((e) => ({ slug: e.slug, nome: e.name }))}
      currentSlug={current}
      hrefFor={(slug) => `/editoria/${slug}`}
      linkAs={Link}
      mainId="conteudo"
      navLabel="Seções do portal"
      links={links}
      menu={menu}
      cta={{ href: '/midia-kit', label: 'Anuncie', current: on('/midia-kit') }}
      actions={
        <>
          {flags.theLoyal && (
            <Button href="/the-loyal" linkAs={Link} variant="secondary">
              The Loyal
            </Button>
          )}
          <SearchIconLink linkAs={Link} label="Busca" />
        </>
      }
    />
  );
}
