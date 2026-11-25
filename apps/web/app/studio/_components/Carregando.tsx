// Fallback de carregamento das listas do Studio. Fica em um loading.tsx de lista que NUNCA responde 404: um boundary
// acima de uma rota de detalhe abre o streaming antes do notFound() e o 404 vira 200. Detalhes (e listas com filho de
// detalhe) não têm loading.tsx de propósito: a resposta do servidor chega inteira, com o status certo.
export function CarregandoStudio() {
  return (
    <div className="st-card" role="status" aria-live="polite" data-estado="carregando">
      <p style={{ margin: 0 }}>
        <strong>Carregando esta tela do Studio…</strong>
      </p>
      <p className="st-hint" style={{ marginBottom: 0 }}>
        Os dados vêm do Backend; nada é preenchido por estimativa.
      </p>
    </div>
  );
}
