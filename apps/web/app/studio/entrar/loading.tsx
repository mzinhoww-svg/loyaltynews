// Carregamento da entrada do Studio (fora do layout protegido): a tela de login em si não lê dados, mas o fallback existe
// para nenhuma rota do Studio ficar sem estado de carregamento que termina.
export default function CarregandoEntrada() {
  return (
    <main className="st-entrada" id="conteudo">
      <div className="st-entrada__cartao" role="status" aria-live="polite" data-estado="carregando">
        <p style={{ margin: 0 }}>
          <strong>Carregando a entrada do Studio…</strong>
        </p>
      </div>
    </main>
  );
}
