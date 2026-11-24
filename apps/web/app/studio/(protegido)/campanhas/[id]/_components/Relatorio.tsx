import type { CampaignReport } from '@ln/commercial';

/**
 * Relatório do anunciante (apresentação pura). Regras do PM: só número CONTADO, com origem, janela e data; nunca estimado; sem cobrança.
 * Sem dado: "—" (nunca 0). A fonte de verdade dos números é buildCampaignReport (@ln/commercial); aqui só se formata.
 */
const NUM = new Intl.NumberFormat('pt-BR');
const PCT = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
// Data e hora montadas em separado: a vírgula entre elas varia com a versão do ICU, e o texto da tela não pode variar.
const DATE_SP = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
const TIME_SP = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const n = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : NUM.format(v));
const p = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : PCT.format(v));
const dia = (d: string): string => d.split('-').reverse().join('/');
const quando = (iso: string | null): string => (iso ? `${DATE_SP.format(new Date(iso))} ${TIME_SP.format(new Date(iso))}` : '—');

export function csvHref(id: string, tipo: 'diario' | 'resumo', de: string, ate: string): string {
  return `/studio/campanhas/${encodeURIComponent(id)}/relatorio?tipo=${tipo}&de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`;
}

export function Relatorio({ r }: { r: CampaignReport }) {
  const t = r.totals;
  return (
    <section aria-labelledby="rel" data-testid="relatorio">
      <h2 id="rel">Relatório do anunciante</h2>

      <table className="st-table" aria-label="Campanha">
        <tbody>
          <tr><th scope="row">Anunciante</th><td data-testid="rel-anunciante">{r.advertiser.name ?? '—'}</td></tr>
          <tr><th scope="row">Período da campanha</th><td>{dia(r.campaign.startDate)} a {dia(r.campaign.endDate)}</td></tr>
          <tr>
            <th scope="row">Posições</th>
            <td data-testid="rel-posicoes">
              {r.positions.length === 0 ? '—' : r.positions.map((x) => `${x.name}${x.dimension ? ` (${x.dimension.replace('x', '×')})` : ''}`).join(' · ')}
            </td>
          </tr>
          <tr>
            <th scope="row">Criativos aprovados</th>
            <td data-testid="rel-criativos">
              {r.approvedCreatives.length === 0 ? 'nenhum' : r.approvedCreatives.map((c) => c.id).join(', ')}
              {r.pendingCreatives > 0 ? ` · ${r.pendingCreatives} aguardando aprovação` : ''}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="st-hint" data-testid="rel-janela">
        Janela: {dia(r.window.from)} a {dia(r.window.to)}
        {r.window.effective ? ` · com dado de ${dia(r.window.effective.from)} a ${dia(r.window.effective.to)}` : ''}
      </p>

      {r.emptyState && <p data-testid="rel-vazio">{r.emptyState}</p>}

      <table className="st-table" aria-label="Totais da janela">
        <tbody>
          <tr><th scope="row">Impressões servidas</th><td data-testid="rel-servidas">{n(t?.served)}</td></tr>
          <tr><th scope="row">Impressões visíveis</th><td data-testid="rel-visiveis">{n(t?.visible)}</td></tr>
          <tr><th scope="row">Cliques válidos</th><td data-testid="rel-cliques">{n(t?.clicks)}</td></tr>
          <tr><th scope="row">Taxa de visibilidade</th><td data-testid="rel-taxa-vis">{p(t?.visibleRate)}</td></tr>
          <tr><th scope="row">CTR (cliques ÷ servidas)</th><td data-testid="rel-ctr">{p(t?.ctr)}</td></tr>
          <tr><th scope="row">Origem</th><td data-testid="rel-origem">{r.source.name}</td></tr>
          <tr><th scope="row">Dado atualizado em</th><td data-testid="rel-atualizado">{quando(r.updatedAt)}</td></tr>
          <tr><th scope="row">Estimado</th><td data-testid="rel-estimado">não: só o que foi contado</td></tr>
        </tbody>
      </table>
      {r.excluded && (
        <p className="st-hint" data-testid="rel-excluidos">
          Recebidas e fora da contagem: {n(r.excluded.botOrInternal)} de bots ou tráfego interno · {n(r.excluded.refreshSuppressed)} de auto-refresh.
        </p>
      )}

      {r.notes.length > 0 && (
        <div role="note" data-testid="rel-avisos">
          <ul className="st-issues">
            {r.notes.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}

      {r.daily.length > 0 && (
        <>
          <h3>Por dia</h3>
          <table className="st-table" data-testid="rel-por-dia">
            <thead><tr><th scope="col">Dia</th><th scope="col">Servidas</th><th scope="col">Visíveis</th><th scope="col">Cliques</th><th scope="col">Visibilidade</th><th scope="col">CTR</th></tr></thead>
            <tbody>
              {r.daily.map((d) => (
                <tr key={d.day}><th scope="row">{dia(d.day)}</th><td>{n(d.served)}</td><td>{n(d.visible)}</td><td>{n(d.clicks)}</td><td>{p(d.visibleRate)}</td><td>{p(d.ctr)}</td></tr>
              ))}
            </tbody>
          </table>
          <h3>Por posição</h3>
          <table className="st-table" data-testid="rel-por-posicao">
            <thead><tr><th scope="col">Posição</th><th scope="col">Servidas</th><th scope="col">Visíveis</th><th scope="col">Cliques</th><th scope="col">Visibilidade</th><th scope="col">CTR</th></tr></thead>
            <tbody>
              {r.byPosition.map((x) => (
                <tr key={x.positionId}><th scope="row">{x.positionId}</th><td>{n(x.served)}</td><td>{n(x.visible)}</td><td>{n(x.clicks)}</td><td>{p(x.visibleRate)}</td><td>{p(x.ctr)}</td></tr>
              ))}
            </tbody>
          </table>
          <h3>Por criativo</h3>
          <table className="st-table" data-testid="rel-por-criativo">
            <thead><tr><th scope="col">Criativo</th><th scope="col">Posição</th><th scope="col">Servidas</th><th scope="col">Visíveis</th><th scope="col">Cliques</th><th scope="col">Visibilidade</th><th scope="col">CTR</th></tr></thead>
            <tbody>
              {r.byCreative.map((x) => (
                <tr key={x.creativeId}><th scope="row">{x.creativeId}</th><td>{x.positionId}</td><td>{n(x.served)}</td><td>{n(x.visible)}</td><td>{n(x.clicks)}</td><td>{p(x.visibleRate)}</td><td>{p(x.ctr)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="st-actions" data-testid="rel-exportar">
        <a className="st-btn sec" href={csvHref(r.campaign.id, 'diario', r.window.from, r.window.to)} download>Exportar CSV diário</a>{' '}
        <a className="st-btn sec" href={csvHref(r.campaign.id, 'resumo', r.window.from, r.window.to)} download>Exportar CSV de resumo</a>
      </p>

      <details>
        <summary>Como os números são contados</summary>
        <ul>{r.definitions.map((d, i) => <li key={i}>{d}</li>)}</ul>
      </details>
    </section>
  );
}
