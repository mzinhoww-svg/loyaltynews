import { EmptyState as DsEmptyState } from '@ln/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Estado de erro honesto (fonte api): a API falhou, o que é diferente de "não há conteúdo".
 * Página 200, sem 500, sem MOCK, sem URL nem detalhe técnico; oferece tentar de novo.
 * (DS `EmptyState kind="error"`: role="alert".)
 */
export function ErrorState({
  title = 'Não conseguimos carregar agora',
  children,
  retryHref,
  appearance = 'box',
}: {
  title?: string;
  children?: ReactNode;
  /** Link para tentar de novo (a mesma página). */
  retryHref?: string;
  appearance?: 'box' | 'inline';
}) {
  return (
    <div data-testid="error-state">
      <DsEmptyState
        kind="error"
        appearance={appearance}
        title={title}
        description={children ?? 'O conteúdo não respondeu a tempo. Isso não significa que ele não exista: tente novamente em instantes.'}
        action={
          retryHref ? (
            <Link href={retryHref} className="ln-btn ln-btn--ghost" prefetch={false}>
              Tentar de novo
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}

/** Esqueleto de carregamento: blocos neutros e texto para leitor de tela; sem dado de exemplo. */
export function LoadingState({ label = 'Carregando…', rows = 4 }: { label?: string; rows?: number }) {
  const bar = (w: string, h = 14) => ({ width: w, height: h, background: 'var(--ln-color-border)', borderRadius: 4, marginBottom: 10 }) as const;
  return (
    <div data-testid="portal-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="pt-sr">{label}</span>
      <div aria-hidden="true">
        <div style={bar('40%', 28)} />
        <div style={bar('65%')} />
        <div style={{ height: 16 }} />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: 'flex', gap: 16, marginBottom: 18 }}>
            <div style={{ ...bar('120px', 72), flex: 'none' }} />
            <div style={{ flex: 1 }}>
              <div style={bar('80%', 18)} />
              <div style={bar('55%')} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
