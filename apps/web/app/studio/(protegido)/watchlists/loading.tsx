// Carregando das watchlists enquanto as rotas respondem. A tela nunca chama notFound() (lista alheia vira aviso), então o status não muda.
export default function Carregando() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="st-card" data-estado="carregando">
      <p style={{ margin: 0 }}>Carregando watchlists…</p>
    </div>
  );
}
