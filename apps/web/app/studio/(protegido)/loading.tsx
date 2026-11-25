// Carregamento compartilhado das telas protegidas do Studio: aparece enquanto o servidor lê os dados e some quando a tela
// chega. Fica DENTRO do layout protegido, então o menu e a sessão continuam na tela. Telas com loading próprio (agenda,
// crm, seo, ...) mantêm o delas. Nenhum número é estimado: se a leitura falhar, o error boundary mostra o erro e permite
// tentar de novo.
export default function CarregandoStudio() {
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
