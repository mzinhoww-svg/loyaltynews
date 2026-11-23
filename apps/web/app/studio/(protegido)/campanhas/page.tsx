import type { Metadata } from 'next';
import Link from 'next/link';
import { isEnabled } from '@ln/contracts';
import { findModule } from '@/lib/studio/modules';
import { comercialCtx } from '@/lib/studio/comercial';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { criarCampanhaAction } from './actions';

export const metadata: Metadata = { title: 'Campanhas' };
export const dynamic = 'force-dynamic';

const ESTADOS = ['draft', 'reserved', 'approved', 'active', 'paused', 'completed', 'cancelled'] as const;

export default async function CampanhasPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('campanhas')!);
  const { tipo, aviso } = await searchParams;
  const ctx = comercialCtx(session);
  const campanhas = ctx.campaigns.list();
  const contas = [...ctx.crm.accounts.values()];
  const formatos = ctx.catalog.filter((f) => f.status !== 'indisponivel');
  const vendas = isEnabled('adServerVendas');
  return (
    <>
      <h1>Campanhas</h1>
      <p>Flights, criativos e entrega. Os 7 estados do blueprint: {ESTADOS.join(' → ')}. Ativar exige reserva confirmada e criativo aprovado; sem venda habilitada a campanha não ativa.</p>
      <div className="st-alert" role="status">
        Venda no ad server: <strong>{vendas ? 'ligada' : 'desligada'}</strong> (flag adServerVendas).
      </div>
      <Flash tipo={tipo} aviso={aviso} />

      {campanhas.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhuma campanha</h2>
          <p>Nenhuma campanha criada. Campanhas nascem de uma conta do CRM (lead convertido) e de um formato do catálogo.</p>
        </section>
      ) : (
        <table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {campanhas.length} campanha(s)
          </caption>
          <thead>
            <tr>
              <th scope="col">Campanha</th>
              <th scope="col">Formato</th>
              <th scope="col">Período</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            {campanhas.map((c) => (
              <tr key={c.id}>
                <th scope="row">
                  <Link href={`/studio/campanhas/${encodeURIComponent(c.id)}`}>{c.name}</Link>
                </th>
                <td>{c.formatId}</td>
                <td>
                  {c.startDate} a {c.endDate}
                </td>
                <td>
                  <span className="st-badge">{c.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="nova">
        <h2 id="nova" style={{ marginTop: 0 }}>
          Nova campanha
        </h2>
        {contas.length === 0 ? (
          <p className="st-hint">Sem contas no CRM: converta um lead qualificado para criar a conta do anunciante.</p>
        ) : (
          <form action={criarCampanhaAction}>
            <div className="st-field">
              <label htmlFor="nome">Nome</label>
              <input id="nome" name="nome" type="text" />
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="conta">Anunciante (conta)</label>
                <select id="conta" name="conta">
                  {contas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-field">
                <label htmlFor="formato">Formato</label>
                <select id="formato" name="formato">
                  {formatos.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.status})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="inicio">Início (AAAA-MM-DD)</label>
                <input id="inicio" name="inicio" type="text" />
              </div>
              <div className="st-field">
                <label htmlFor="fim">Fim (AAAA-MM-DD)</label>
                <input id="fim" name="fim" type="text" />
              </div>
            </div>
            <div className="st-field">
              <label>
                <input type="checkbox" name="rotulo" /> Conteúdo patrocinado rotulado
              </label>
            </div>
            <button className="st-btn" type="submit">
              Criar campanha
            </button>
          </form>
        )}
      </section>
    </>
  );
}
