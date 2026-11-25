'use client';

import { useEffect, useState } from 'react';

/**
 * "Salvar em PDF": abre a impressão do navegador, onde "Salvar como PDF" gera o arquivo. O papel traz todas as tabelas de preço
 * (regra de impressão do .pt-fold). Sem JavaScript o botão não aparece (o atalho do navegador continua valendo). Não sai no papel.
 */
export function SalvarPdf() {
  const [pronto, setPronto] = useState(false);
  useEffect(() => setPronto(true), []);
  if (!pronto) return null;
  return (
    <button type="button" className="ln-btn ln-btn--ghost pt-no-print" data-testid="mk-salvar-pdf" onClick={() => window.print()}>
      Salvar em PDF
    </button>
  );
}
