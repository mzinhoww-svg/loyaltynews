import type { Metadata } from 'next';
import { QuadroRolavel } from '../../_components/QuadroRolavel';
import { findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { EstadoLista } from '../../_components/EstadoLista';
import { estadoDaLista } from '@/lib/studio/estados';
import { Anunciantes, type ContaCrm, type ContatoCrm } from './Anunciantes';
import { leadAction, moverEstagioAction, registrarLeadAction } from './actions';

export const metadata: Metadata = { title: 'CRM' };
export const dynamic = 'force-dynamic';

// Rótulos em português para a tela (revisão visual P2-2); os valores enviados à API continuam os do domínio.
const ESTADO_LEAD: Record<string, string> = { novo: 'Novo', qualificado: 'Qualificado', descartado: 'Descartado', convertido: 'Convertido' };
const ESTAGIO: Record<string, string> = { novo: 'Novo', qualificado: 'Qualificado', proposta: 'Proposta', negociacao: 'Negociação', ganho: 'Ganho', perdido: 'Perdido' };
const ACAO_LEAD: Record<string, string> = { qualificar: 'Qualificar', converter: 'Converter', descartar: 'Descartar' };
const rotulo = (m: Record<string, string>, k: string) => m[k] ?? k;

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
  await requireModule(findModule('crm')!);
  const { tipo, aviso, status } = await searchParams;
  const resLeads = await api.comercial.leads(status);
  if (naoConfigurado(resLeads)) {
    return (
      <>
        <h1>CRM</h1>
        <SemBanco modulo="O CRM" />
      </>
    );
  }
  const leads = (ehErro(resLeads) ? [] : resLeads.body) as unknown as Lead[];
  const resQuadro = await api.comercial.oportunidades();
  const colunas = (ehErro(resQuadro) ? [] : resQuadro.body) as unknown as Coluna[];
  const erroLeads = ehErro(resLeads) ? mensagemErro(resLeads) : null;
  const filtroLeadsInvalido = ehErro(resLeads) && resLeads.status === 400;
  const erroQuadro = ehErro(resQuadro) ? mensagemErro(resQuadro) : null;
  // anunciantes (contas) e contatos (leads ligados à conta pela conversão); contatos sempre de todos os leads, não do filtro
  const resContas = await api.comercial.contas({ limit: '100' });
  const resTodos = status ? await api.comercial.leads() : resLeads;
  const contas = ehErro(resContas) ? [] : (resContas.body.data as ContaCrm[]);
  const contatos = (ehErro(resTodos) ? [] : resTodos.body) as unknown as ContatoCrm[];
  // contatos diretos de cada conta (uma leitura por conta, no máximo 100 contas)
  const diretos = Object.fromEntries(
    await Promise.all(
      contas.map(async (c) => {
        const r = await api.comercial.contatosConta(c.id);
        return [c.id, ehErro(r) ? { erro: mensagemErro(r) } : { data: r.body.data }] as const;
      }),
    ),
  );
  const erroContas = ehErro(resContas) ? mensagemErro(resContas) : ehErro(resTodos) ? mensagemErro(resTodos) : null;
  return (
    <>
      <h1>CRM</h1>
      <p>Leads do mídia kit e oportunidades. Lead é dado pessoal (LGPD): só o comercial vê. O consentimento é gravado com o horário do servidor e o opt-in da newsletter nunca vem marcado.</p>
      <Flash tipo={tipo} aviso={aviso} />
      {filtroLeadsInvalido ? (
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
      {estadoDaLista(erroLeads !== null, leads.length) === 'vazio' || estadoDaLista(erroLeads !== null, leads.length) === 'erro' ? (
        <EstadoLista
          estado={estadoDaLista(erroLeads !== null, leads.length)}
          erro={erroLeads}
          recarregar="/studio/crm"
          headingLevel={3}
          vazio={{
            titulo: 'Nenhum lead',
            porque: 'Nenhum lead chegou neste ambiente: o formulário do mídia kit é público e ainda não recebeu contato, e ninguém registrou lead à mão.',
            comoPopular: 'Os leads entram pelo formulário do mídia kit no portal ou pelo formulário "Registrar lead" abaixo; só o comercial vê dado pessoal (LGPD).',
          }}
        />
      ) : (
        <QuadroRolavel rotulo="Leads">
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
                  <span className="st-badge">{rotulo(ESTADO_LEAD, l.status)}</span>
                </td>
                <td>
                  <div className="st-actions">
                    {(l.status === 'novo' ? ['qualificar', 'descartar'] : l.status === 'qualificado' ? ['converter', 'descartar'] : []).map((op) => (
                      <form action={leadAction} key={op}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="op" value={op} />
                        <button className={op === 'descartar' ? 'st-btn danger' : 'st-btn sec'} type="submit" aria-label={`${rotulo(ACAO_LEAD, op)} ${l.name}`}>
                          {rotulo(ACAO_LEAD, op)}
                        </button>
                      </form>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</QuadroRolavel>
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

      <Anunciantes contas={contas} leads={contatos} diretos={diretos} erro={erroContas} />

      <h2 style={{ marginTop: 24 }}>Oportunidades</h2>
      {erroQuadro ? (
        <p className="st-hint" data-erro-quadro>
          Não foi possível ler o quadro de oportunidades: {erroQuadro} As colunas não estão vazias — a leitura falhou.
        </p>
      ) : null}
      <div className="st-grid" role="list" aria-label="Quadro de oportunidades">
        {colunas.map((c) => (
          <div className="st-card" role="listitem" key={c.stage} data-stage={c.stage}>
            <h3 style={{ marginTop: 0 }}>
              {rotulo(ESTAGIO, c.stage)} ({c.items.length})
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
                            {rotulo(ESTAGIO, p)}
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
      <p className="st-hint">Proposta versionada em PDF e documentos dependem de armazenamento (ainda não ligado).</p>
    </>
  );
}
