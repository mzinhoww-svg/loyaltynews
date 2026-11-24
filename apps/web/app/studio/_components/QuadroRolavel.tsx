import type { ReactNode } from 'react';

/**
 * Quadro de tabela que rola na horizontal no celular: região com nome e foco de teclado (axe: scrollable-region-focusable),
 * para quem não usa mouse conseguir rolar a tabela com as setas. No desktop não muda nada (a tabela cabe).
 */
export function QuadroRolavel({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="st-quadro" role="region" aria-label={rotulo} tabIndex={0}>
      {children}
    </div>
  );
}
