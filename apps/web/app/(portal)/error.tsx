'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { PageHead } from './_components/ui';

/**
 * Última barreira: erro inesperado ao desenhar uma página do portal. Sem detalhe técnico, sem mensagem do erro, sem URL.
 * (Falhas previstas da API pública já viram estado de erro ou vazio dentro da própria página.)
 */
export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Só o resumo (digest) fica no console do navegador; nada de dados do leitor.
    console.error('[portal] erro ao exibir a página', error.digest ?? '');
  }, [error]);
  return (
    <>
      <PageHead title="Não conseguimos exibir esta página" />
      <section className="ln-empty ln-empty--error" role="alert" data-testid="error-state">
        <h2 className="ln-empty__title">Algo deu errado por aqui</h2>
        <p className="ln-empty__desc">Isso não é culpa sua. Tente de novo ou volte para a página inicial.</p>
        <div className="ln-empty__action">
          <button type="button" className="ln-btn ln-btn--primary" onClick={() => reset()}>
            Tentar de novo
          </button>{' '}
          <Link href="/" className="ln-btn ln-btn--ghost">
            Voltar à página inicial
          </Link>
        </div>
      </section>
    </>
  );
}
