'use client';

// Menu lateral do Studio (refino do lançamento, pacote C, item 1). Mesmo visual e classes do Sidebar do design system (ln-sidebar*), mas com GRUPOS
// RECOLHÍVEIS: o menu tem 27 itens e só rolava. O grupo da tela atual abre sozinho; os outros ficam recolhidos até a pessoa abrir (botão com
// aria-expanded). O item ativo é claro (fundo branco, texto da cor primária) e o "desligado nesta fase" é um StatusPill neutro, nunca só cor.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { StatusPill } from '@ln/ui';
import { ativoEm, grupoAtivo, gruposDoMenu, type NavItem } from '@/lib/studio/menu';

export type { NavItem };

export function StudioSidebar({ itens }: { itens: NavItem[] }) {
  const pathname = usePathname() ?? '/studio';
  const grupos = gruposDoMenu(itens);
  const id = useId();
  const botaoMenu = useRef<HTMLButtonElement>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(() => new Set(grupoAtivo(grupos, pathname) ? [grupoAtivo(grupos, pathname)!] : []));

  // ao chegar numa tela (link, migalha, voltar do navegador), o grupo dela abre; o que a pessoa abriu antes continua aberto
  useEffect(() => {
    const g = grupoAtivo(gruposDoMenu(itens), pathname);
    if (g) setAbertos((atual) => (atual.has(g) ? atual : new Set([...atual, g])));
  }, [pathname, itens]);

  // Esc fecha o menu no celular e devolve o foco ao botão que o abriu
  useEffect(() => {
    if (!menuAberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuAberto(false);
        botaoMenu.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuAberto]);

  const alterna = (titulo: string) =>
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(titulo)) novo.delete(titulo);
      else novo.add(titulo);
      return novo;
    });

  return (
    <aside className="ln-sidebar ln-on-inverse">
      <div className="ln-sidebar__top">
        <div className="ln-sidebar__brand">LN Studio</div>
        <button ref={botaoMenu} type="button" className="ln-sidebar__toggle" aria-expanded={menuAberto} aria-controls={id} onClick={() => setMenuAberto((v) => !v)}>
          {menuAberto ? 'Fechar navegação' : 'Navegação'}
        </button>
      </div>
      <nav id={id} aria-label="Módulos do Studio" className="ln-sidebar__nav" data-open={menuAberto ? 'true' : 'false'}>
        <div className="ln-sidebar__group">
          <ul className="ln-sidebar__list">
            <li>
              <Link href="/studio" className="ln-sidebar__link" aria-current={pathname === '/studio' ? 'page' : undefined} onClick={() => setMenuAberto(false)}>
                <span>Visão geral</span>
              </Link>
            </li>
          </ul>
        </div>
        {grupos.map((g, i) => {
          const aberto = abertos.has(g.titulo);
          const lista = `${id}-lista-${i}`;
          const rotulo = `${id}-titulo-${i}`;
          return (
            <div key={g.titulo} className="ln-sidebar__group st-nav-grupo" data-grupo-menu={g.titulo}>
              <button id={rotulo} type="button" className="st-nav-grupo__botao" aria-expanded={aberto} aria-controls={lista} onClick={() => alterna(g.titulo)}>
                <span>{g.titulo}</span>
                <span className="st-nav-grupo__qtd" aria-hidden="true">
                  {g.itens.length}
                </span>
              </button>
              <ul id={lista} className="ln-sidebar__list" aria-labelledby={rotulo} hidden={!aberto}>
                {g.itens.map((it) => (
                  <li key={it.href}>
                    <Link href={it.href} className="ln-sidebar__link" aria-current={ativoEm(pathname, it.href) ? 'page' : undefined} onClick={() => setMenuAberto(false)}>
                      <span>{it.nome}</span>
                      {it.flagDesligada ? <StatusPill label="Desligado nesta fase" tone="neutral" className="st-nav-pill" /> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
