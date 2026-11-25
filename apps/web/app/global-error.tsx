'use client';

import { useEffect } from 'react';

/**
 * Erro 500 com a marca quando a falha é no próprio layout raiz (o error.tsx do portal só cobre o que está DENTRO do layout do portal).
 * Substitui o <html> inteiro: por isso estilos inline (o CSS do portal pode não ter carregado). Sem detalhe técnico, mensagem do erro nem URL.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[portal] erro global', error.digest ?? '');
  }, [error]);
  const verde = '#153c3c';
  return (
    <html lang="pt-BR">
      <head>
        <title>Algo deu errado | Loyalty News</title>
        <meta name="robots" content="noindex" />
      </head>
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: '#1a1a1a', background: '#fff' }}>
        <header style={{ borderBottom: '1px solid #d6dede', padding: '16px 24px' }}>
          <a href="/" style={{ color: verde, fontWeight: 800, fontSize: 24, textDecoration: 'none', fontFamily: 'Georgia, serif' }}>
            loyalty<span style={{ color: '#3f8b7f' }}>news.</span>
          </a>
        </header>
        <main id="conteudo" style={{ maxWidth: 640, margin: '64px auto', padding: '0 24px' }} data-testid="global-error">
          <h1 style={{ color: verde, fontSize: 32, margin: '0 0 12px', fontFamily: 'Georgia, serif' }}>Não conseguimos exibir esta página</h1>
          <p style={{ fontSize: 18, lineHeight: 1.5, margin: '0 0 24px' }}>Isso não é culpa sua. Tente de novo ou volte para a página inicial.</p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ background: verde, color: '#fff', border: 0, borderRadius: 6, padding: '12px 20px', fontSize: 16, minHeight: 44, cursor: 'pointer' }}
          >
            Tentar de novo
          </button>{' '}
          <a href="/" style={{ color: verde, fontSize: 16, padding: '12px 8px', display: 'inline-block', minHeight: 44 }}>
            Voltar à página inicial
          </a>
        </main>
      </body>
    </html>
  );
}
