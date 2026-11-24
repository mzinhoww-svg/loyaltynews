/**
 * Carregamento do mídia kit (leitura dinâmica da API comercial). O esqueleto imita a ESTRUTURA da página (faixa do topo, chips de seção,
 * métricas e tabela), não uma lista de matérias. Blocos neutros e texto só para leitor de tela; nenhum dado de exemplo.
 * (Sem rota filha que devolva 404: o status HTTP segue correto.)
 */
const bloco = (w: string | number, h: number, extra: Record<string, string | number> = {}) =>
  ({ width: w, height: h, background: 'var(--ln-color-border)', borderRadius: 4, ...extra }) as const;

export default function Loading() {
  return (
    <div data-testid="portal-loading" data-skeleton="midia-kit" role="status" aria-live="polite" aria-busy="true">
      <span className="pt-sr">Carregando o mídia kit…</span>
      <div aria-hidden="true">
        {/* faixa do topo: kicker, título em duas linhas, subtítulo e botões */}
        <div style={{ ...bloco('100%', 240, { marginBottom: 20 }), display: 'grid', alignContent: 'center', gap: 12, padding: 24, background: 'var(--ln-color-mint)' }}>
          <div style={bloco(180, 12, { background: 'var(--ln-color-border-strong)' })} />
          <div style={bloco('70%', 28, { background: 'var(--ln-color-border-strong)' })} />
          <div style={bloco('45%', 28, { background: 'var(--ln-color-border-strong)' })} />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={bloco(150, 44, { background: 'var(--ln-color-border-strong)' })} />
            <div style={bloco(150, 44, { background: 'var(--ln-color-border-strong)' })} />
          </div>
        </div>
        {/* chips de seção */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap' }}>
          {[80, 110, 100, 90].map((w, i) => (
            <div key={i} style={bloco(w, 44, { borderRadius: 22 })} />
          ))}
        </div>
        {/* 01 · Cobertura: título da seção e três métricas */}
        <div style={bloco(160, 24, { marginBottom: 16 })} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ border: '1px solid var(--ln-color-border)', borderRadius: 8, padding: 16, display: 'grid', gap: 10 }}>
              <div style={bloco('60%', 12)} />
              <div style={bloco('40%', 32)} />
              <div style={bloco('80%', 12)} />
            </div>
          ))}
        </div>
        {/* tabela (formatos e preços) */}
        <div style={bloco(220, 24, { marginBottom: 16 })} />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <div style={bloco('30%', 20)} />
            <div style={bloco('40%', 20)} />
            <div style={bloco('20%', 20)} />
          </div>
        ))}
      </div>
    </div>
  );
}
