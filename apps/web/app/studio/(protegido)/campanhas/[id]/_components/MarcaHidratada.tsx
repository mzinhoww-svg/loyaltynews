'use client';

import { useEffect, useState } from 'react';

/**
 * Marcador público de que a tela da campanha terminou de hidratar no navegador (as ações de servidor dos formulários já respondem).
 * Serve aos testes e2e (P3 do QA 7, 60d0aa3) sem depender de chaves internas do React. Não aparece para a pessoa.
 */
export function MarcaHidratada() {
  const [pronto, setPronto] = useState(false);
  useEffect(() => setPronto(true), []);
  return <span hidden data-campanha-hidratada={pronto ? 'sim' : 'nao'} />;
}
