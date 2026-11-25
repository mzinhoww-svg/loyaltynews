import type { Metadata } from 'next';
import { QuadroRolavel } from '../../../../_components/QuadroRolavel';
import Link from 'next/link';
import type { AdvertiserReport } from '@ln/commercial';
import { findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { requireModule } from '../../../../_lib/guard';
import { SemBanco } from '../../../../_components/SemBanco';
import { Seta } from '../../../../_components/Seta';

export const metadata: Metadata = { title: 'Relatório do anunciante' };
export const dynamic = 'force-dynamic';

// Só número CONTADO, com origem, janela e data; nunca estimado; sem cobrança. Sem dado: "—" (nunca 0). Os números vêm de buildAdvertiserReport (@ln/commercial).
const NUM = new Intl.NumberFormat('pt-BR');
const PCT = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DATE_SP = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
const TIME_SP = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : NUM.format(v));
const p = (v: number | null | undefined) => (v === null || v === undefined ? '—' : PCT.format(v));
const dia = (d: string) => d.split('-').reverse().join('/');
const quando = (iso: string | null) => (iso ? `${DATE_SP.format(new Date(iso))} ${TIME_SP.format(new Date(iso))}` : '—');
const csv = (id: string, tipo: 'diario' | 'resumo', de: string, ate: string) =>
  `/studio/crm/anunciantes/${encodeURIComponent(id)}/relatorio?tipo=${tipo}&de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`;

export default async function RelatorioAnunciantePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ de?: string; ate?: string }> }) {
  await requireModule(findModule('crm')!);
  const id = decodeURIComponent((await params).id);
  const { de, ate } = await searchParams;
  const res = await api.comercial.relatorioConta(id, de || undefined, ate || undefined);
  if (naoConfigurado(res)) return <SemBanco modulo="O relatório do anunciante" />;
  const voltar = (
    <p>
      <Link href="/studio/crm"><Seta direcao="esquerda" /> CRM</Link>
    </p>
  );
  if (!res.ok) {
    return (
      <>
        {voltar}
        <h1>Relatório do anunciante</h1>
        <div className="st-alert err" role="alert" data-testid="rel-erro">
          {res.status === 404 ? 'Anunciante não encontrado.' : mensagemErro(res)}
        </div>
      </>
    );
  }
  const r = res.body as unknown as AdvertiserReport;
  const t = r.totals;
  return (
    <>
      {voltar}
      <h1>{r.advertiser.name}</h1>
      <section aria-labelledby="rel" data-testid="relatorio-anunciante">
        <h2 id="rel">Relatório do anunciante</h2>
        <form method="get" className="st-actions" aria-label="Janela do relatório" style={{ marginBottom: 12 }}>
          <label>
            De <input type="date" name="de" defaultValue={de ?? r.window.from} />
          </label>{' '}
          <label>
            Até <input type="date" name="ate" defaultValue={ate ?? r.window.to} />
          </label>{' '}
          <button className="st-btn sec" type="submit">
            Aplicar janela
          </button>
        </form>
        <p className="st-hint" data-testid="rel-janela">
          Janela: {dia(r.window.from)} a {dia(r.window.to)}
          {r.window.effective ? ` · com dado de ${dia(r.window.effective.from)} a ${dia(r.window.effective.to)}` : ''}
        </p>
        {r.emptyState ? <p data-testid="rel-vazio">{r.emptyState}</p> : null}

        <QuadroRolavel rotulo="Totais da janela">
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
</QuadroRolavel>
        {r.auditability.note ? <p className="st-alert err" role="note" data-testid="rel-auditavel">{r.auditability.note}</p> : null}
        {r.notes.length > 0 ? (
          <div role="note" data-testid="rel-avisos">
            <ul className="st-issues">
              {r.notes.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
        ) : null}

        <h3>Campanhas na janela</h3>
        {r.campaigns.length === 0 ? (
          <p data-vazio="campanhas">Nenhuma campanha deste anunciante toca a janela.</p>
        ) : (
          <QuadroRolavel rotulo="Campanhas do anunciante">
<table className="st-table" aria-label="Campanhas do anunciante">
            <thead>
              <tr><th scope="col">Campanha</th><th scope="col">Estado</th><th scope="col">Período</th><th scope="col">Posições</th><th scope="col">Servidas</th><th scope="col">Visíveis</th><th scope="col">Cliques</th></tr>
            </thead>
            <tbody>
              {r.campaigns.map((c) => (
                <tr key={c.id} data-campanha={c.id}>
                  <th scope="row"><Link href={`/studio/campanhas/${encodeURIComponent(c.id)}`}>{c.name}</Link></th>
                  <td>{c.status}</td>
                  <td>{dia(c.startDate)} a {dia(c.endDate)}</td>
                  <td>{c.positions.length ? c.positions.join(', ') : '—'}</td>
                  <td>{n(c.totals?.served)}</td>
                  <td>{n(c.totals?.visible)}</td>
                  <td>{n(c.totals?.clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
</QuadroRolavel>
        )}

        {r.daily.length > 0 ? (
          <>
            <h3>Por dia</h3>
            <QuadroRolavel rotulo="Relatório por dia">
<table className="st-table" data-testid="rel-por-dia">
              <thead><tr><th scope="col">Dia</th><th scope="col">Servidas</th><th scope="col">Visíveis</th><th scope="col">Cliques</th><th scope="col">Visibilidade</th><th scope="col">CTR</th></tr></thead>
              <tbody>
                {r.daily.map((d) => (
                  <tr key={d.day}><th scope="row">{dia(d.day)}</th><td>{n(d.served)}</td><td>{n(d.visible)}</td><td>{n(d.clicks)}</td><td>{p(d.visibleRate)}</td><td>{p(d.ctr)}</td></tr>
                ))}
              </tbody>
            </table>
</QuadroRolavel>
          </>
        ) : null}
        {r.dataIssues.length > 0 ? (
          <p className="st-hint" data-testid="rel-descartadas">{r.dataIssues.length} linha(s) inconsistente(s) descartada(s) da contagem.</p>
        ) : null}

        <p className="st-actions" data-testid="rel-exportar">
          <a className="st-btn sec" href={csv(r.advertiser.id, 'diario', r.window.from, r.window.to)} download>Exportar CSV diário</a>{' '}
          <a className="st-btn sec" href={csv(r.advertiser.id, 'resumo', r.window.from, r.window.to)} download>Exportar CSV de resumo</a>
        </p>
        <details>
          <summary>Como os números são contados</summary>
          <ul>{r.definitions.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </details>
      </section>
    </>
  );
}
