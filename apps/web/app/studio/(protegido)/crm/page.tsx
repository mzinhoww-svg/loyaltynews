import type { Metadata } from 'next';
import { getLeadInbox, getOpportunityBoard } from '@ln/commercial/api';
import { findModule } from '@/lib/studio/modules';
import { comercialCtx } from '@/lib/studio/comercial';
import { requireModule } from '../../_lib/guard';
import { Flash, SemBackend } from '../../_components/Flash';
import { leadAction, moverEstagioAction, registrarLeadAction } from './actions';

export const metadata: Metadata = { title: 'CRM' };
export const dynamic = 'force-dynamic';

const PROXIMOS: Record<string, string[]> = {
  novo: ['qualificado', 'perdido'],
  qualificado: ['proposta', 'perdido'],
  proposta: ['negociacao', 'ganho', 'perdido'],
  negociacao: ['proposta', 'ganho', 'perdido'],
  ganho: [],
  perdido: [],
};

type Lead = { id: string; name: string; company: string; email: string; objective: string; status: string };
type Coluna = { stage: string; items: { id: string; title: string; accountName: string | null; overdue: boolean }[] };

export default async function CrmPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string; status?: string }> }) {
  const { session } = await requireModule(findModule('crm')!);
  const { tipo, aviso, status } = await searchParams;
  const ctx = comercialCtx(session);
  const resLeads = getLeadInbox(ctx, status ? { status } : {});
  const leads = (Array.isArray(resLeads.body) ? resLeads.body : []) as unknown as Lead[];
  const resQuadro = getOpportunityBoard(ctx, {});
  const colunas = (Array.isArray(resQuadro.body) ? resQuadro.body : []) as unknown as Coluna[];
  return (
    <>
      <h1>CRM</h1>
      <p>Leads do mídia kit e oportunidades. Lead é dado pessoal (LGPD): só o comercial vê. O consentimento é gravado com o horário do servidor e o opt-in da newsletter nunca vem marcado.</p>
      <Flash tipo={tipo} aviso={aviso} />
      {resLeads.status >= 400 ? (
        <div className="st-alert err" role="alert">
          Filtro inválido.
        </div>
      ) : null}

      <h2>Leads</h2>
      <form className="st-filters" method="get" role="search" aria-label="Filtrar leads">
        <div className="st-field">
          <label htmlFor="status">Estado</label>
          <select id="status" name="status" defaultValue={status ?? ''}>
            <option value="">Todos</option>
            <option value="novo">Novo</option>
            <option value="qualificado">Qualificado</option>
            <option value="descartado">Descartado</option>
            <option value="convertido">Convertido</option>
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>
      {leads.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio-leads">
          <h2 id="vazio-leads">Nenhum lead</h2>
          <p>Nenhum lead recebido. Os leads chegam pelo formulário do mídia kit (portal) ou são registrados abaixo.</p>
        </section>
      ) : (
        <table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {leads.length} lead(s)
          </caption>
          <thead>
            <tr>
              <th scope="col">Contato</th>
              <th scope="col">Objetivo</th>
              <th scope="col">Estado</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <th scope="row">
                  {l.name} · {l.company}
                  <br />
                  <span className="st-hint">{l.email}</span>
                </th>
                <td>{l.objective}</td>
                <td>
                  <span className="st-badge">{l.status}</span>
                </td>
                <td>
                  <div className="st-actions">
                    {(l.status === 'novo' ? ['qualificar', 'descartar'] : l.status === 'qualificado' ? ['converter', 'descartar'] : []).map((op) => (
                      <form action={leadAction} key={op}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="op" value={op} />
                        <button className={op === 'descartar' ? 'st-btn danger' : 'st-btn sec'} type="submit" aria-label={`${op} ${l.name}`}>
                          {op}
                        </button>
                      </form>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="novo-lead">
        <h2 id="novo-lead" style={{ marginTop: 0 }}>
          Registrar lead
        </h2>
        <form action={registrarLeadAction}>
          <div className="st-row">
            <div className="st-field">
              <label htmlFor="nome">Nome</label>
              <input id="nome" name="nome" type="text" />
            </div>
            <div className="st-field">
              <label htmlFor="empresa">Empresa</label>
              <input id="empresa" name="empresa" type="text" />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="text" />
            </div>
            <div className="st-field">
              <label htmlFor="whatsapp">WhatsApp (opcional)</label>
              <input id="whatsapp" name="whatsapp" type="text" />
            </div>
          </div>
          <div className="st-field">
            <label htmlFor="objetivo">Objetivo</label>
            <input id="objetivo" name="objetivo" type="text" />
          </div>
          <div className="st-field">
            <label htmlFor="mensagem">Mensagem (opcional)</label>
            <input id="mensagem" name="mensagem" type="text" />
          </div>
          <button className="st-btn" type="submit">
            Registrar lead
          </button>
        </form>
      </section>

      <h2 style={{ marginTop: 24 }}>Oportunidades</h2>
      <div className="st-grid" role="list" aria-label="Quadro de oportunidades">
        {colunas.map((c) => (
          <div className="st-card" role="listitem" key={c.stage} data-stage={c.stage}>
            <h3 style={{ marginTop: 0 }}>
              {c.stage} ({c.items.length})
            </h3>
            {c.items.length === 0 ? (
              <p className="st-hint">Vazio.</p>
            ) : (
              c.items.map((o) => (
                <div key={o.id} style={{ marginBottom: 10 }}>
                  <strong>{o.title}</strong>
                  <div className="st-hint">
                    {o.accountName ?? 'sem conta'}
                    {o.overdue ? ' · ação atrasada' : ''}
                  </div>
                  {(PROXIMOS[c.stage] ?? []).length > 0 ? (
                    <form action={moverEstagioAction} className="st-actions">
                      <input type="hidden" name="id" value={o.id} />
                      <select name="para" aria-label={`Mover ${o.title} para`}>
                        {PROXIMOS[c.stage]!.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <input name="motivo" type="text" placeholder="Motivo (se perdido)" aria-label={`Motivo da perda de ${o.title}`} />
                      <button className="st-btn sec" type="submit" aria-label={`Mover ${o.title}`}>
                        Mover
                      </button>
                    </form>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ))}
      </div>
      <SemBackend>Proposta versionada em PDF e documentos dependem de armazenamento.</SemBackend>
    </>
  );
}
