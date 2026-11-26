import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { requireModule } from '../../../_lib/guard';
import { AVISO_VENDA_DESLIGADA, podeAprovar, vendaLiberadaNoAmbiente } from '@/lib/studio/comercial';
import { Flash } from '../../../_components/Flash';
import { SemBanco } from '../../../_components/SemBanco';
import { transicaoAction } from '../actions';
import type { CampaignReport } from '@ln/commercial';
import { Relatorio } from './_components/Relatorio';
import { MarcaHidratada } from './_components/MarcaHidratada';
import { PosicoesCriativos, type CriativoLinha, type ReservaLinha } from './_components/PosicoesCriativos';
import { flagAtiva } from '@/lib/studio/flags';
import { Seta } from '../../../_components/Seta';

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
  campaign: { id: string; name: string; status: string; accountId: string; positionId?: string | null; positionIds?: string[]; startDate: string; endDate: string; history: { from: string | null; to: string; at: string; note?: string }[] };
  reservations: ReservaLinha[];
  creatives: CriativoLinha[];
  report: { utmVisits: number | null };
};

export default async function CampanhaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; aviso?: string; de?: string; ate?: string; codigo?: string }> }) {
  const { session } = await requireModule(findModule('campanhas')!);
  // DP-43 por ambiente: fora do staging (produção), nada de venda, aprovação nem ativação na tela
  const venda = vendaLiberadaNoAmbiente();
  const aprova = venda && podeAprovar(session.roles);
  const id = decodeURIComponent((await params).id);
  const { tipo, aviso, de, ate, codigo } = await searchParams;
  const codigoErro = tipo === 'err' && codigo && /^[A-Z0-9_]{1,60}$/.test(codigo) ? codigo : undefined;
  const r = await api.comercial.campanha(id);
  if (naoConfigurado(r)) return <SemBanco modulo="O módulo de campanhas" />;
  if (r.status === 404) notFound();
  if (ehErro(r)) throw new Error(mensagemErro(r));
  const d = r.body as unknown as Detalhe;
  const c = d.campaign;
  // Relatório do anunciante: janela opcional (de/ate). Erro da API (ex.: janela inválida) aparece como aviso, sem derrubar a página.
  const rel = await api.comercial.relatorio(id, de, ate);
  const relatorio = rel.ok ? (rel.body as unknown as CampaignReport) : null;
  return (
    <>
      <p>
        <Link href="/studio/campanhas"><Seta direcao="esquerda" /> Campanhas</Link>
      </p>
      <h1>{c.name}</h1>
      <p>
        <span className="st-badge">{c.status}</span> · {c.startDate} a {c.endDate}
      </p>
      <MarcaHidratada />
      <div data-erro-codigo={codigoErro}>
        <Flash tipo={tipo} aviso={aviso} />
      </div>
      <div className="st-two">
        <div>
          <form method="get" className="st-actions" aria-label="Janela do relatório" style={{ marginBottom: 12 }}>
            <label>
              De <input type="date" name="de" defaultValue={de ?? ''} />
            </label>{' '}
            <label>
              Até <input type="date" name="ate" defaultValue={ate ?? ''} />
            </label>{' '}
            <button className="st-btn sec" type="submit">Aplicar janela</button>
          </form>
          {relatorio ? (
            <Relatorio r={relatorio} />
          ) : (
            <p role="alert" data-testid="rel-erro">{rel.ok ? 'Relatório indisponível.' : mensagemErro(rel)}</p>
          )}
          <p className="st-hint">
            Visitas por UTM: {d.report.utmVisits === null ? 'não disponível (sem analytics)' : d.report.utmVisits}
          </p>
          <PosicoesCriativos campanha={c} reservas={d.reservations ?? []} criativos={d.creatives ?? []} vendaLigada={venda && flagAtiva('adServerVendas')} vendaNoAmbiente={venda} podeAprovar={aprova} />
        </div>
        <aside>
          <div className="st-card">
            <h2 style={{ marginTop: 0 }}>Estado</h2>
            {DESTINOS[c.status]?.length ? (
              DESTINOS[c.status]!.filter((para) => (para !== 'approved' || aprova) && (para !== 'active' || venda)).map((para) => (
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
            {venda ? null : (
              <p className="st-hint" data-testid="venda-desligada-ambiente">
                {AVISO_VENDA_DESLIGADA}
              </p>
            )}
            {aprova || !venda ? null : (
              <p className="st-hint" data-testid="aprovacao-proprietario">
                Aprovar a campanha é do proprietário (papel admin).
              </p>
            )}
            <p className="st-hint">As regras de reserva, criativo aprovado e venda habilitada são do domínio: recusas aparecem acima.</p>
          </div>
          <div className="st-card" style={{ marginTop: 14 }}>
            <h2 style={{ marginTop: 0 }}>Histórico</h2>
            <ol className="st-issues">
              {[...c.history].reverse().map((h, i) => (
                <li key={i}>
                  {h.from ?? '—'} <Seta /> {h.to} · {h.at.slice(0, 16).replace('T', ' ')}
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
