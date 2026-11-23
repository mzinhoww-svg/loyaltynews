import type { ReactNode } from 'react';

/**
 * Contêiner de tabela larga (revisão visual int/012, P2-1; axe `scrollable-region-focusable`): no celular a rolagem horizontal fica no contêiner,
 * que é uma região nomeada e focável pelo teclado (setas rolam). A tabela dentro volta a ser tabela (sem rolar por conta própria).
 */
export function TabelaRolavel({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={rotulo} tabIndex={0} className="st-rolagem" style={{ maxWidth: '100%', overflowX: 'auto' }}>
      {children}
    </div>
  );
}

/** Estilo da tabela dentro do contêiner: anula o `display: block; overflow-x: auto` que o studio.css dá às tabelas no celular. */
export const TABELA_NO_CONTEINER = { display: 'table', overflow: 'visible' } as const;
