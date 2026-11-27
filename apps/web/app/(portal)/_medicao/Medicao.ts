'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { caminhoSemPessoa, emitir, leituraConta, passouDoCorte, podeMedir, soOrigem } from './emissor';

// Pontos de emissão dos três eventos do contrato. Nenhum desenha nada na tela. `ligada` vem do servidor (lib/portal-medicao.ts).

/** `page_view`: uma vez por mudança de caminho. Mudar só a query (ex.: paginação) não conta de novo. */
export function MedicaoPagina({ ligada }: { ligada: boolean }): null {
  const caminho = usePathname();
  const primeira = useRef(true);
  useEffect(() => {
    const entrada = primeira.current;
    primeira.current = false;
    void emitir(ligada, (c) =>
      c.fromLegacyCollect(
        {
          t: 'pageview',
          path: caminhoSemPessoa(caminho ?? '/'),
          // Depois da primeira página, `document.referrer` continua o de fora: a navegação dentro do portal é interna.
          ref: entrada ? soOrigem(document.referrer) : window.location.origin,
          w: window.innerWidth > 0 ? Math.round(window.innerWidth) : undefined,
        },
        [window.location.hostname],
      ),
    );
  }, [ligada, caminho]);
  return null;
}

/** `search`: uma vez por busca com resposta. `termo` é o que veio na URL, INTEIRO: a redação precisa ver o texto antes de qualquer corte. */
export function MedicaoBusca({ ligada, termo, total }: { ligada: boolean; termo: string; total: number }): null {
  useEffect(() => {
    void emitir(ligada, () => ({ name: 'search', query: termo, resultCount: Math.min(total, 1000) }));
  }, [ligada, termo, total]);
  return null;
}

/** Matérias já contadas nesta carga do portal (só memória: nada é gravado no navegador). */
const lidas = new Set<string>();

/** `article_read`: 30 s de leitura com a aba visível ou 75% do texto, o que vier primeiro. O tempo só corre com consentimento. */
export function MedicaoLeitura({ ligada, slug, editoria }: { ligada: boolean; slug: string; editoria: string }): null {
  useEffect(() => {
    if (!ligada || lidas.has(slug)) return;
    let segundos = 0;
    let passou = false;
    const relogio = window.setInterval(() => {
      if (!podeMedir(ligada)) {
        segundos = 0;
        passou = false;
        return;
      }
      if (document.visibilityState !== 'visible') return;
      segundos += 1;
      const texto = document.querySelector('.pt-article .pt-body');
      passou ||= passouDoCorte(texto ? texto.getBoundingClientRect() : null, window.innerHeight);
      if (!leituraConta(segundos, passou)) return;
      window.clearInterval(relogio);
      lidas.add(slug);
      void emitir(ligada, (c) => c.articleReadFromPublic({ slug, editoria }, Math.min(segundos, 3600)));
    }, 1000);
    return () => window.clearInterval(relogio);
  }, [ligada, slug, editoria]);
  return null;
}
