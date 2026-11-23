// Estado de carregando desta tela (Suspense do App Router) enquanto a rota lê do Backend. Só em telas que nunca respondem 404:
// um loading.tsx faz a resposta começar antes de um notFound() e o status viraria 200.
export default function Carregando() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="st-card" data-estado="carregando">
      <p style={{ margin: 0 }}>Carregando…</p>
    </div>
  );
}
