'use client';

// Migalhas do Studio (design system: ln-breadcrumb). Cliente de propósito: o layout não roda de novo na navegação suave, e o caminho (usePathname)
// muda a cada página; assim a trilha acompanha a pessoa em todas as telas sem cada uma repetir a sua.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Breadcrumb } from '@ln/ui';
import { migalhasDe } from '@/lib/studio/migalhas';

export function MigalhasStudio() {
  const caminho = usePathname() ?? '/studio';
  return <Breadcrumb linkAs={Link} items={migalhasDe(caminho)} className="st-migalhas" />;
}
