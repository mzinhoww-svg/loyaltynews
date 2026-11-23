'use client';

// Estado de erro das telas do Studio: falha inesperada ao ler do Backend. Mostra a razão curta e deixa tentar de novo; nada é inventado.
export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="st-alert err" data-estado="erro">
      <p style={{ marginTop: 0 }}>
        <strong>Não foi possível carregar esta tela.</strong>
      </p>
      <p className="st-hint">{error.message && error.message.length < 200 ? error.message : 'Erro inesperado ao ler do Backend.'}</p>
      <button className="st-btn" type="button" onClick={() => reset()}>
        Tentar de novo
      </button>
    </div>
  );
}
