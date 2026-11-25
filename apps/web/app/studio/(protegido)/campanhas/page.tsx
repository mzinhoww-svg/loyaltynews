import type { Metadata } from 'next';
import { QuadroRolavel } from '../../_components/QuadroRolavel';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { flagAtiva } from '@/lib/studio/flags';
import { findModule } from '@/lib/studio/modules';
import { AVISO_VENDA_DESLIGADA, periodo30, vendaLiberadaNoAmbiente } from '@/lib/studio/comercial';
import { hojeSP } from '@/lib/studio/datas';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { criarCampanhaAction } from './actions';
import { Seta } from '../../_components/Seta';

export const metadata: Metadata = { title: 'Campanhas' };
export const dynamic = 'force-dynamic';

const ESTADOS = ['draft', 'reserved', 'approved', 'active', 'paused', 'completed', 'cancelled'] as const;

type Painel = { campaignsByStatus: Record<string, number>; attention: { kind: string; ref: string; message: string }[]; sellingEnabled: boolean };
const POR_PAGINA = 20;
type Formato = { id: string; name: string; status: string };

export default async function CampanhasPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string; id?: string; status?: string; conta?: string; q?: string; pagina?: string }> }) {
  await requireModule(findModule('campanhas')!);
  const { tipo, aviso, id, status = '', conta: contaFiltro = '', q = '', pagina = '1' } = await searchParams;
  if (id?.trim()) redirect(`/studio/campanhas/${encodeURIComponent(id.trim())}`);
  const { from, to } = periodo30(hojeSP());
  const painelRes = await api.comercial.painel(from, to);
  if (naoConfigurado(painelRes)) {
    return (
      <>
        <h1>Campanhas</h1>
        <SemBanco modulo="O módulo de campanhas" />
      </>
    );
  }
  if (ehErro(painelRes)) {
    return (
      <>
        <h1>Campanhas</h1>
        <div className="st-alert err" role="alert">
          {mensagemErro(painelRes)}
        </div>
      </>
    );
  }
  const painel = painelRes.body as unknown as Painel;
  // anunciantes: as contas do CRM, pela lista do Backend (sem dado pessoal; só nome e contagens)
  const contasRes = await api.comercial.contas({ limit: '100' });
  const contas = ehErro(contasRes) ? [] : contasRes.body.data;
  const pag = Math.max(1, Math.floor(Number(pagina)) || 1);
  const lista = await api.comercial.campanhas({ ...(status ? { status } : {}), ...(contaFiltro ? { accountId: contaFiltro } : {}), ...(q.trim() ? { q: q.trim() } : {}), limit: String(POR_PAGINA), offset: String((pag - 1) * POR_PAGINA) });
  const campanhas = ehErro(lista) ? [] : lista.body.data;
  const totalFiltrado = ehErro(lista) ? 0 : lista.body.total;
  const paginas = Math.max(1, Math.ceil(totalFiltrado / POR_PAGINA));
  const filtroQuery = (n: number) => '?' + new URLSearchParams({ ...(status ? { status } : {}), ...(contaFiltro ? { conta: contaFiltro } : {}), ...(q.trim() ? { q: q.trim() } : {}), pagina: String(n) }).toString();
  const fmt = await api.comercial.formatos();
  const formatos = (ehErro(fmt) ? [] : (fmt.body as unknown as { formats: Formato[] }).formats).filter((f) => f.status !== 'indisponivel');
  const total = Object.values(painel.campaignsByStatus).reduce((a, b) => a + b, 0);
  const vendas = flagAtiva('adServerVendas');
  return (
    <>
      <h1>Campanhas</h1>
      <p>Flights, criativos e entrega. Os 7 estados do blueprint: {ESTADOS.map((e, i) => (<span key={e}>{i > 0 && <Seta />}{e}</span>))}. Ativar exige reserva confirmada e criativo aprovado; sem venda habilitada a campanha não ativa.</p>
      <div className="st-alert" role="status">
        Venda no ad server: <strong>{vendas && vendaLiberadaNoAmbiente() ? 'ligada' : 'desligada nesta fase'}</strong>.{vendaLiberadaNoAmbiente() ? null : <span data-testid="venda-desligada-ambiente"> {AVISO_VENDA_DESLIGADA}</span>}
      </div>
      <Flash tipo={tipo} aviso={aviso} />

      <h2>Campanhas por estado ({total})</h2>
      <ul aria-label="Campanhas por estado">
        {ESTADOS.map((e) => (
          <li key={e} data-estado={e}>
            {e}: {painel.campaignsByStatus[e] ?? 0}
          </li>
        ))}
      </ul>
      {total === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhuma campanha</h2>
          <p>Nenhuma campanha criada. Campanhas nascem de uma conta do CRM (lead convertido) e de um formato do catálogo.</p>
        </section>
      ) : (
        <>
          <h2>Lista de campanhas</h2>
          <form className="st-filters" method="get" role="search" aria-label="Filtrar campanhas">
            <div className="st-field">
              <label htmlFor="f-status">Estado</label>
              <select id="f-status" name="status" defaultValue={status}>
                <option value="">Todos</option>
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
            <div className="st-field">
              <label htmlFor="f-conta">Anunciante</label>
              <select id="f-conta" name="conta" defaultValue={contaFiltro}>
                <option value="">Todos</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="st-field">
              <label htmlFor="f-q">Nome contém</label>
              <input id="f-q" name="q" type="text" defaultValue={q} />
            </div>
            <button className="st-btn sec" type="submit">
              Filtrar
            </button>
          </form>
          {ehErro(lista) ? (
            <div className="st-alert err" role="alert">
              {mensagemErro(lista)}
            </div>
          ) : campanhas.length === 0 ? (
            <p className="st-hint" data-vazio="filtro">
              Nenhuma campanha com esses filtros.
            </p>
          ) : (
            <QuadroRolavel rotulo="Lista de campanhas">
<table className="st-table">
              <caption className="st-hint" style={{ textAlign: 'left' }}>
                {totalFiltrado} campanha(s) · página {pag} de {paginas}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Campanha</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Formato</th>
                  <th scope="col">Período</th>
                  <th scope="col">Anunciante</th>
                </tr>
              </thead>
              <tbody>
                {campanhas.map((c) => (
                  <tr key={c.id} data-campanha={c.id} data-status={c.status}>
                    <th scope="row">
                      <Link href={`/studio/campanhas/${encodeURIComponent(c.id)}`}>{c.name}</Link>
                    </th>
                    <td>{c.status}</td>
                    <td>{c.formatName ?? c.formatId}</td>
                    <td>
                      {c.startDate} <Seta /> {c.endDate}
                    </td>
                    <td>{c.accountName ?? c.accountId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
</QuadroRolavel>
          )}
          {paginas > 1 ? (
            <nav aria-label="Paginação de campanhas" className="st-actions">
              {pag > 1 ? <Link className="st-btn sec" href={filtroQuery(pag - 1)}>Anterior</Link> : null}
              {pag < paginas ? <Link className="st-btn sec" href={filtroQuery(pag + 1)}>Próxima</Link> : null}
            </nav>
          ) : null}
        </>
      )}
      {painel.attention.length > 0 ? (
        <ul aria-label="Pontos de atenção">
          {painel.attention.map((a) => (
            <li key={a.kind + a.ref}>{a.message}</li>
          ))}
        </ul>
      ) : null}
      <form className="st-filters" method="get" role="search" aria-label="Abrir campanha por ID">
        <div className="st-field">
          <label htmlFor="id">ID da campanha</label>
          <input id="id" name="id" type="text" />
        </div>
        <button className="st-btn sec" type="submit">
          Abrir
        </button>
      </form>

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
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
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
                <label htmlFor="inicio">Início (obrigatório)</label>
                <input id="inicio" name="inicio" type="date" required />
              </div>
              <div className="st-field">
                <label htmlFor="fim">Fim (obrigatório)</label>
                <input id="fim" name="fim" type="date" required />
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
