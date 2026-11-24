'use client';

// Erro no nível do Studio (inclui o layout das telas protegidas, que roda o guard): ex.: o banco não respondeu ao conferir a sessão.
// Não manda para a entrada (a sessão pode estar válida); mostra a razão curta e deixa tentar de novo.
export default function ErroStudio({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="st-alert err" data-estado="erro">
      <p style={{ marginTop: 0 }}>
        <strong>Não foi possível carregar o Studio.</strong>
      </p>
      <p className="st-hint">{error.message && error.message.length < 200 ? error.message : 'Erro inesperado. Tente de novo em instantes.'}</p>
      <button className="st-btn" type="button" onClick={() => reset()}>
        Tentar de novo
      </button>
    </div>
  );
}
