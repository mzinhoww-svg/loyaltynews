'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sidebar as UiSidebar, type SidebarGroup } from '@ln/ui';

export interface NavItem {
  slug: string;
  nome: string;
  grupo: string;
  /** true quando o módulo depende de flag desligada. */
  flagDesligada: boolean;
}

/** Navegação do Studio sobre o Sidebar do design system (@ln/ui). Os itens vêm do registro de módulos (papel + flag). */
export function StudioSidebar({ itens }: { itens: NavItem[] }) {
  const pathname = usePathname();
  const ativo = (href: string) => (href === '/studio' ? pathname === '/studio' : pathname === href || pathname.startsWith(`${href}/`));
  const grupos = [...new Set(itens.map((i) => i.grupo))];
  const groups: SidebarGroup[] = [
    { items: [{ label: 'Visão geral', href: '/studio', current: ativo('/studio') }] },
    ...grupos.map((g) => ({
      title: g,
      items: itens
        .filter((i) => i.grupo === g)
        .map((i) => ({
          label: i.flagDesligada ? `${i.nome} (flag off)` : i.nome,
          href: `/studio/${i.slug}`,
          current: ativo(`/studio/${i.slug}`),
        })),
    })),
  ];
  return <UiSidebar groups={groups} brand="LN Studio" label="Módulos do Studio" linkAs={Link} />;
}
