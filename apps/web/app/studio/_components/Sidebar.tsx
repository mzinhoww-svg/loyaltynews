'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

export interface NavItem {
  slug: string;
  nome: string;
  grupo: string;
  /** true quando o módulo depende de flag desligada. */
  flagDesligada: boolean;
}

export function Sidebar({ itens }: { itens: NavItem[] }) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const grupos = [...new Set(itens.map((i) => i.grupo))];
  const ativo = (href: string) => (href === '/studio' ? pathname === '/studio' : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <aside className="st-side">
      <div className="st-brand">LN Studio</div>
      <button className="st-btn sec st-menu-btn" type="button" aria-expanded={aberto} aria-controls="st-nav" onClick={() => setAberto((v) => !v)}>
        Menu
      </button>
      <nav id="st-nav" aria-label="Módulos do Studio" className={aberto ? 'st-nav open' : 'st-nav'}>
        <ul>
          <li>
            <Link href="/studio" aria-current={ativo('/studio') ? 'page' : undefined}>
              Visão geral
            </Link>
          </li>
        </ul>
        {grupos.map((g) => (
          <section key={g} aria-label={g}>
            <h2>{g}</h2>
            <ul>
              {itens
                .filter((i) => i.grupo === g)
                .map((i) => (
                  <li key={i.slug}>
                    <Link href={`/studio/${i.slug}`} aria-current={ativo(`/studio/${i.slug}`) ? 'page' : undefined}>
                      {i.nome}
                      {i.flagDesligada ? <span className="st-flagtag">flag off</span> : null}
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </nav>
    </aside>
  );
}
