import type { Metadata } from 'next';
import type { MediaKitPage } from '@ln/commercial';
import { flagAtiva } from '@/lib/studio/flags';
import { findModule } from '@/lib/studio/modules';
import { periodo30 } from '@/lib/studio/comercial';
import { hojeSP } from '@/lib/studio/datas';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, naoConfigurado } from '@/lib/studio/backend';
import { requireModule } from '../../_lib/guard';
import { SemBanco } from '../../_components/SemBanco';

export const metadata: Metadata = { title: 'Inventário' };
export const dynamic = 'force-dynamic';

type Posicao = { positionId: string; name: string; desktop: string | readonly string[] | null; mobile: string | readonly string[] | null; slotLimit: number | null; peakUsed: number; free: number | null; occupancy: number | null; configured: boolean; blockedByTakeover: boolean; note: string | null };
type Formato = { id: string; section: string; name: string; price: string; scope: string; status: string; statusReason: string };

const fmt = (v: string | readonly string[] | null): string => (v === null ? '—' : Array.isArray(v) ? v.join(', ') : String(v));

export default async function InventarioPage({ searchParams }: { searchParams: Promise<{ section?: string; status?: string }> }) {
  await requireModule(findModule('inventario')!);
  const q = await searchParams;
  const { from, to } = periodo30(hojeSP());
  const inv = await api.comercial.inventario(from, to);
  if (naoConfigurado(inv)) {
    return (
      <>
        <h1>Inventário</h1>
        <SemBanco modulo="O inventário" />
      </>
    );
  }
  const posicoes = (ehErro(inv) ? [] : inv.body) as unknown as Posicao[];
  const catalogo = await api.comercial.formatos({ section: q.section, status: q.status });
  const view = (ehErro(catalogo) ? null : catalogo.body) as unknown as { total: number; sections: string[]; formats: Formato[]; note: string } | null;
  const filtroOk = view !== null && Array.isArray(view.formats);
  const kitRes = await api.comercial.midiaKit();
  const kit = (ehErro(kitRes) ? null : kitRes.body) as unknown as MediaKitPage | null;
  const vendas = flagAtiva('adServerVendas');
  return (
    <>
      <h1>Inventário</h1>
      <p>Posições, capacidade e catálogo de formatos. Nenhum formato sem capacidade operacional fica à venda. Preço é referência comercial; disponibilidade é real.</p>
      <div className="st-alert" role="status">
        Venda no ad server: <strong>{vendas ? 'ligada' : 'desligada'}</strong> (flag adServerVendas). Período da ocupação: {from} a {to}.
      </div>

      <h2>Posições</h2>
      <table className="st-table">
        <caption className="st-hint" style={{ textAlign: 'left' }}>
          {posicoes.length} posições do blueprint
        </caption>
        <thead>
          <tr>
            <th scope="col">Posição</th>
            <th scope="col">Dimensão (desktop / mobile)</th>
            <th scope="col">Cotas</th>
            <th scope="col">Pico usado</th>
            <th scope="col">Ocupação</th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {posicoes.map((p) => (
            <tr key={p.positionId} data-posicao={p.positionId}>
              <th scope="row">
                {p.positionId}
                <br />
                <span className="st-hint">{p.name}</span>
              </th>
              <td>
                {fmt(p.desktop)} / {fmt(p.mobile)}
              </td>
              <td>{p.slotLimit ?? '—'}</td>
              <td>{p.peakUsed}</td>
              <td>{p.occupancy === null ? 'não configurada' : `${Math.round(p.occupancy * 100)}%`}</td>
              <td>{p.configured ? (p.blockedByTakeover ? 'bloqueada por takeover' : 'configurada') : p.note ?? 'não reservável'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 24 }}>Catálogo de formatos</h2>
      <form className="st-filters" method="get" role="search" aria-label="Filtrar formatos">
        <div className="st-field">
          <label htmlFor="section">Seção</label>
          <select id="section" name="section" defaultValue={q.section ?? ''}>
            <option value="">Todas</option>
            {(view ? view.sections : []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="st-field">
          <label htmlFor="status">Disponibilidade</label>
          <select id="status" name="status" defaultValue={q.status ?? ''}>
            <option value="">Todas</option>
            <option value="disponivel">Disponível</option>
            <option value="sob_consulta">Sob consulta</option>
            <option value="indisponivel">Indisponível</option>
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>
      {!filtroOk || !view ? (
        <div className="st-alert err" role="alert">
          Filtro inválido.
        </div>
      ) : (
        <table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {view.total} formato(s). {view.note}
          </caption>
          <thead>
            <tr>
              <th scope="col">Formato</th>
              <th scope="col">Seção</th>
              <th scope="col">Referência</th>
              <th scope="col">Disponibilidade</th>
            </tr>
          </thead>
          <tbody>
            {view.formats.map((f) => (
              <tr key={f.id}>
                <th scope="row">{f.name}</th>
                <td>{f.section}</td>
                <td>{f.price}</td>
                <td>
                  {f.status}
                  <br />
                  <span className="st-hint">{f.statusReason}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: 24 }}>Mídia kit</h2>
      {kit ? (
        <>
      <p>
        {kit.blocks.catalogo.total} formatos no catálogo ·{' '}
        {Object.entries(kit.blocks.catalogo.byStatus)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' · ')}
        . Audiência: {kit.blocks.audiencia.emptyState ?? 'dados disponíveis'}. Decisores: {kit.blocks.decisores.emptyState}
      </p>
      <p className="st-hint">
        Capacidades: venda {kit.capabilities.adServerVendas ? 'ligada' : 'desligada'} · Instagram {kit.capabilities.instagram ? 'ligado' : 'desligado'} · The Loyal {kit.capabilities.theLoyal ? 'ligado' : 'desligado'} · retargeting {kit.capabilities.retargeting ? 'ligado' : 'desligado'}.
      </p>
        </>
      ) : (
        <p className="st-hint">Mídia kit indisponível.</p>
      )}
      <p className="st-hint">Reserva de slot e takeover são feitas na campanha.</p>
    </>
  );
}
