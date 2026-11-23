'use client';

import { Button, Header } from '@ln/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Editoria } from '../_lib/types';

export interface NavFlags {
  theLoyal: boolean;
}

/**
 * Header do design system (10 editorias, menu mobile com Esc, skip link).
 * A navegação de utilidade (Em alta, Agenda, Moves…) fica em <PortalNav /> logo abaixo.
 */
export function SiteHeader({ flags, editorias }: { flags: NavFlags; editorias: readonly Pick<Editoria, 'slug' | 'name'>[] }) {
  const pathname = usePathname() ?? '/';
  const current = pathname.startsWith('/editoria/') ? pathname.split('/')[2] : undefined;
  return (
    <Header
      editorias={editorias.map((e) => ({ slug: e.slug, nome: e.name }))}
      currentSlug={current}
      hrefFor={(slug) => `/editoria/${slug}`}
      linkAs={Link}
      mainId="conteudo"
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
          <Button href="/midia-kit" linkAs={Link} variant="ghost">
            Anuncie
          </Button>
        </>
      }
    />
  );
}
