'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Editoria } from '../_lib/types';

export interface NavFlags {
  theLoyal: boolean;
  marketData: boolean;
  podcast: boolean;
}

export function SiteHeader({ flags, editorias, techSlug }: { flags: NavFlags; editorias: readonly Pick<Editoria, 'slug' | 'name'>[]; techSlug: string }) {
  const pathname = usePathname() ?? '/';
  const [menuOpen, setMenuOpen] = useState(false);
  const [ddOpen, setDdOpen] = useState(false);
  const ddRef = useRef<HTMLLIElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    setDdOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (ddOpen) setDdOpen(false);
        if (menuOpen) {
          setMenuOpen(false);
          toggleRef.current?.focus();
        }
      }
    };
    const onClick = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDdOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [ddOpen, menuOpen]);

  const cur = (href: string) => (pathname === href || (href !== '/' && pathname.startsWith(href + '/')) ? 'page' : undefined);

  return (
    <header className="ln-header">
      <div className="ln-wrap ln-header-row">
        <Link href="/" className="ln-logo" aria-label="Loyalty News — página inicial">
          loyalty<span>news.</span>
        </Link>
        <div className="ln-actions">
          {flags.theLoyal && (
            <Link href="/the-loyal" className="ln-btn">
              The Loyal
            </Link>
          )}
          <Link href="/midia-kit" className="ln-btn ln-btn-ghost">
            Anuncie
          </Link>
          <Link href="/busca" className="ln-btn ln-btn-ghost" aria-label="Busca">
            Busca
          </Link>
          <button
            ref={toggleRef}
            type="button"
            className="ln-iconbtn"
            aria-expanded={menuOpen}
            aria-label="Menu"
            aria-controls="ln-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? 'Fechar' : 'Menu'}
          </button>
        </div>
      </div>
      <nav id="ln-nav" className="ln-nav" aria-label="Navegação principal" data-open={menuOpen}>
        <div className="ln-wrap">
          <ul className="ln-nav-list">
            <li ref={ddRef}>
              <button type="button" aria-expanded={ddOpen} aria-haspopup="true" onClick={() => setDdOpen((v) => !v)}>
                Notícias ▾
              </button>
              {ddOpen && (
                <ul className="ln-dropdown">
                  <li><Link href="/noticias">Todas as notícias</Link></li>
                  <li><Link href="/flash">Loyalty Flash</Link></li>
                  <li><Link href="/analises">Análises</Link></li>
                  <li><hr /></li>
                  {editorias.map((e) => (
                    <li key={e.slug}>
                      <Link href={`/editoria/${e.slug}`}>{e.name}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
            <li><Link href="/em-alta" aria-current={cur('/em-alta')}>Em alta</Link></li>
            {flags.marketData && <li><Link href="/indicadores" aria-current={cur('/indicadores')}>Market Data</Link></li>}
            {flags.podcast && <li><Link href="/podcast" aria-current={cur('/podcast')}>Podcast</Link></li>}
            <li><Link href="/agenda" aria-current={cur('/agenda')}>Agenda</Link></li>
            <li><Link href={`/editoria/${techSlug}`} aria-current={cur(`/editoria/${techSlug}`)}>Tecnologia</Link></li>
            <li><Link href="/entrevistas" aria-current={cur('/entrevistas')}>Entrevistas</Link></li>
            <li><Link href="/moves" aria-current={cur('/moves')}>Moves</Link></li>
            <li><Link href="/intelligence" aria-current={cur('/intelligence')}>Intelligence</Link></li>
            <li><Link href="/contato" aria-current={cur('/contato')}>Contato</Link></li>
            <li className="ln-mobile-only"><Link href="/busca">Busca</Link></li>
            <li className="ln-mobile-only"><Link href="/midia-kit">Anuncie</Link></li>
          </ul>
        </div>
      </nav>
    </header>
  );
}
