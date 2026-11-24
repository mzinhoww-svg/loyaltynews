'use client';

import { HeaderSearch as DsHeaderSearch, formatDateShortPtBR, type SearchSuggestionsResult } from '@ln/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

interface RespostaSugestoes {
  estado: 'ok' | 'indisponivel';
  total?: number;
  itens: { slug: string; titulo: string; editoria: string; publicadoEm?: string }[];
}

/** Sugestões da busca do cabeçalho: GET /busca/sugestoes?q= (mesma fonte do portal: api, mock ou vazia). */
async function buscarSugestoes(q: string, signal: AbortSignal): Promise<SearchSuggestionsResult> {
  const r = await fetch(`/busca/sugestoes?q=${encodeURIComponent(q)}`, { signal, headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!r.ok) throw new Error(String(r.status));
  const j = (await r.json()) as RespostaSugestoes;
  if (j.estado === 'indisponivel') return { estado: 'indisponivel', itens: [] };
  return {
    estado: 'ok',
    total: j.total,
    itens: j.itens.map((i) => ({ href: `/noticia/${i.slug}`, titulo: i.titulo, meta: [i.editoria, i.publicadoEm ? formatDateShortPtBR(i.publicadoEm) : ''].filter(Boolean).join(' · ') })),
  };
}

/** Busca do cabeçalho do portal: o componente é do design system (@ln/ui); aqui só entram a fonte das sugestões e a navegação do Next. */
export function HeaderSearch() {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <DsHeaderSearch
      linkAs={Link}
      action="/busca"
      routeKey={pathname}
      fetchSuggestions={buscarSugestoes}
      navigate={(href) => router.push(href)}
      getInitialQuery={() => (window.location.pathname === '/busca' ? (new URLSearchParams(window.location.search).get('q') ?? undefined) : undefined)}
    />
  );
}
