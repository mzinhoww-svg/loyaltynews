import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { requireModule } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { SemBanco } from '../../../_components/SemBanco';
import { transicaoAction } from '../actions';

export const metadata: Metadata = { title: 'Campanha' };
export const dynamic = 'force-dynamic';

const DESTINOS: Record<string, string[]> = {
  draft: ['reserved', 'cancelled'],
  reserved: ['approved', 'cancelled'],
  approved: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

type Detalhe = {
  campaign: { id: string; name: string; status: string; startDate: string; endDate: string; history: { from: string | null; to: string; at: string; note?: string }[] };
  report: { served: number; visible: number; clicks: number; visibleRate: number | null; utmVisits: number | null; methodology: string };
};

export default async function CampanhaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  await requireModule(findModule('campanhas')!);
  const id = decodeURIComponent((await params).id);
  const { tipo, aviso } = await searchParams;
  const r = await api.comercial.campanha(id);
  if (naoConfigurado(r)) return <SemBanco modulo="O módulo de campanhas" />;
  if (r.status === 404) notFound();
  if (ehErro(r)) throw new Error(mensagemErro(r));
  const d = r.body as unknown as Detalhe;
  const c = d.campaign;
  return (
    <>
      <p>
        <Link href="/studio/campanhas">← Campanhas</Link>
      </p>
      <h1>{c.name}</h1>
      <p>
        <span className="st-badge">{c.status}</span> · {c.startDate} a {c.endDate}
      </p>
      <Flash tipo={tipo} aviso={aviso} />
      <div className="st-two">
        <section aria-labelledby="rel">
          <h2 id="rel">Relatório de entrega</h2>
          <table className="st-table">
            <tbody>
              <tr>
                <th scope="row">Impressões servidas</th>
                <td>{d.report.served}</td>
              </tr>
              <tr>
                <th scope="row">Impressões visíveis</th>
                <td>{d.report.visible}</td>
              </tr>
              <tr>
                <th scope="row">Cliques válidos</th>
                <td>{d.report.clicks}</td>
              </tr>
              <tr>
                <th scope="row">Taxa de visibilidade</th>
                <td>{d.report.visibleRate === null ? 'sem impressões' : `${Math.round(d.report.visibleRate * 100)}%`}</td>
              </tr>
              <tr>
                <th scope="row">Visitas por UTM</th>
                <td>{d.report.utmVisits === null ? 'não disponível (sem analytics)' : d.report.utmVisits}</td>
              </tr>
            </tbody>
          </table>
          <p className="st-hint">{d.report.methodology}</p>
        </section>
        <aside>
          <div className="st-card">
            <h2 style={{ marginTop: 0 }}>Estado</h2>
            {DESTINOS[c.status]?.length ? (
              DESTINOS[c.status]!.map((para) => (
                <form action={transicaoAction} key={para} className="st-actions" style={{ marginBottom: 8 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="para" value={para} />
                  <button className={para === 'cancelled' ? 'st-btn danger' : 'st-btn sec'} type="submit" aria-label={`Mover para ${para}`}>
                    Mover para {para}
                  </button>
                </form>
              ))
            ) : (
              <p className="st-hint">Estado final.</p>
            )}
            <p className="st-hint">As regras de reserva, criativo aprovado e venda habilitada são do domínio: recusas aparecem acima.</p>
          </div>
          <div className="st-card" style={{ marginTop: 14 }}>
            <h2 style={{ marginTop: 0 }}>Histórico</h2>
            <ol className="st-issues">
              {[...c.history].reverse().map((h, i) => (
                <li key={i}>
                  {h.from ?? '—'} → {h.to} · {h.at.slice(0, 16).replace('T', ' ')}
                  {h.note ? ` · ${h.note}` : ''}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
