import type { ReactNode } from 'react';

/**
 * Contêiner de tabela com rolagem horizontal, navegável por teclado (axe `scrollable-region-focusable`; UI/UX P2-1).
 * Tem foco (tabindex 0), papel de região e nome acessível, para quem usa teclado ou leitor de tela rolar e saber o que é.
 * Use `label` com o assunto da tabela (ex.: "Preços de referência: Banners").
 */
export function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pt-scroll" tabIndex={0} role="region" aria-label={`${label} (tabela com rolagem lateral)`}>
      {children}
    </div>
  );
}
