'use client';

/**
 * Ação de nova tentativa dos estados de erro do Studio. Recarrega a rota ATUAL (a URL, com os filtros, é preservada) e é o
 * mesmo gesto do botão do error boundary: nada é inventado enquanto a leitura falha.
 */
export function Recarregar({ rotulo = 'Tentar de novo' }: { rotulo?: string }) {
  return (
    <button className="st-btn sec" type="button" onClick={() => window.location.reload()} data-tentar-de-novo>
      {rotulo}
    </button>
  );
}
