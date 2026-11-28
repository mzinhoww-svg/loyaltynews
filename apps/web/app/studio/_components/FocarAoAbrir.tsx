'use client';

import { useEffect } from 'react';

/**
 * Leva o foco (e a rolagem) ao elemento quando ele aparece. Em tela com loading.tsx a resposta chega em streaming e o fragmento da URL
 * sozinho não foca um elemento que ainda não existe quando o navegador o procura.
 */
export function FocarAoAbrir({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.focus();
  }, [id]);
  return null;
}
