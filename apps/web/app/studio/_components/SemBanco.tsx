export function SemBanco() {
  return (
    <section className="st-empty" aria-labelledby="sem-banco">
      <h2 id="sem-banco">Banco de dados não configurado</h2>
      <p>O Entity Intelligence lê do PostgreSQL. Neste ambiente não há DATABASE_URL, então não há dados para mostrar. Nada é simulado.</p>
    </section>
  );
}

export function OrigemBanco({ origem }: { origem: string }) {
  return origem === 'pglite-memoria' ? (
    <p className="st-hint" role="note">
      Banco temporário em memória (PGlite, só desenvolvimento/e2e): os dados somem ao reiniciar. Em produção o Studio usa DATABASE_URL.
    </p>
  ) : null;
}
