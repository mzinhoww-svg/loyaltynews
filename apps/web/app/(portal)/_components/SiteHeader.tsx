'use client';

import { Button, Header } from '@ln/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Editoria } from '../_lib/types';

export interface NavFlags {
  theLoyal: boolean;
  marketData: boolean;
  podcast: boolean;
}

/**
 * Header do design system em duas faixas: barra superior (logo + atalhos) e menu de editorias numa linha com "Mais".
 * Atalhos na barra: só os essenciais; o restante (todas as notícias, formatos, contato) vive no rodapé.
 * Mobile: uma barra de 56 px; os atalhos entram no painel do menu.
 */
export function SiteHeader({ flags, editorias }: { flags: NavFlags; editorias: readonly Pick<Editoria, 'slug' | 'name'>[] }) {
  const pathname = usePathname() ?? '/';
  const current = pathname.startsWith('/editoria/') ? pathname.split('/')[2] : undefined;
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const utility = [
    { label: 'Em alta', href: '/em-alta' },
    ...(flags.marketData ? [{ label: 'Market Data', href: '/indicadores' }] : []),
    ...(flags.podcast ? [{ label: 'Podcast', href: '/podcast' }] : []),
    { label: 'Agenda', href: '/agenda' },
    { label: 'Entrevistas', href: '/entrevistas' },
    { label: 'Moves', href: '/moves' },
    { label: 'Intelligence', href: '/intelligence' },
    { label: 'Anuncie', href: '/midia-kit' },
  ].map((l) => ({ ...l, current: isCurrent(l.href) }));
  return (
    <Header
      editorias={editorias.map((e) => ({ slug: e.slug, nome: e.name }))}
      currentSlug={current}
      hrefFor={(slug) => `/editoria/${slug}`}
      linkAs={Link}
      mainId="conteudo"
      utilityLinks={utility}
      utilityLabel="Seções do portal"
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
