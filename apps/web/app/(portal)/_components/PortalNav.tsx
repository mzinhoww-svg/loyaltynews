'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Props {
  marketData: boolean;
  podcast: boolean;
}

/** Navegação de utilidade (menu do wireframe: formatos, Em alta, Agenda, Entrevistas, Contato…). */
export function PortalNav({ marketData, podcast }: Props) {
  const pathname = usePathname() ?? '/';
  const items = [
    { href: '/noticias', label: 'Todas as notícias' },
    { href: '/flash', label: 'Loyalty Flash' },
    { href: '/analises', label: 'Análises' },
    { href: '/em-alta', label: 'Em alta' },
    ...(marketData ? [{ href: '/indicadores', label: 'Market Data' }] : []),
    ...(podcast ? [{ href: '/podcast', label: 'Podcast' }] : []),
    { href: '/agenda', label: 'Agenda' },
    { href: '/entrevistas', label: 'Entrevistas' },
    { href: '/moves', label: 'Moves' },
    { href: '/intelligence', label: 'Intelligence' },
    { href: '/contato', label: 'Contato' },
  ];
  return (
    <nav className="pt-subnav" aria-label="Seções do portal">
      <div className="pt-wrap">
        <ul>
          {items.map((i) => (
            <li key={i.href}>
              <Link href={i.href} aria-current={pathname === i.href || pathname.startsWith(i.href + '/') ? 'page' : undefined}>
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
