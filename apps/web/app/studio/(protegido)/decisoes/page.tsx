import type { Metadata } from 'next';
import { flagAtiva } from '@/lib/studio/flags';
import { findModule } from '@/lib/studio/modules';
import { getStoreAgentes } from '@/lib/studio/agentes';
import { requireModule } from '../../_lib/guard';
import { SemRotaBackend } from '../../_components/SemBanco';

export const metadata: Metadata = { title: 'Decisões e atas' };
export const dynamic = 'force-dynamic';

const STATUS = ['open', 'done', 'escalated'] as const;

export default async function DecisoesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireModule(findModule('decisoes')!);
  const { status } = await searchParams;
  const filtroValido = !status || (STATUS as readonly string[]).includes(status);
  const store = getStoreAgentes();
  const runs = await store.listRuns();
  const acoes = filtroValido ? await store.listActions(status ? { status: status as (typeof STATUS)[number] } : {}) : [];
  const decisoes = (await Promise.all(runs.map((r) => store.listDecisions(r.id)))).flat();
  return (
    <>
      <h1>Decisões e atas</h1>
      <SemRotaBackend o_que="Decisões, atas e ações registradas aqui são do Studio." />
      <p>
        Action tracker persistente e auditável. Atas e decisões nascem da execução dos rituais, hoje <strong>{flagAtiva('rituais') ? 'ligada' : 'desligada'}</strong> (flag rituais). Decisão de ato reservado vai ao responsável humano; nada é aprovado automaticamente.
      </p>
      <form className="st-filters" method="get" role="search" aria-label="Filtrar ações">
        <div className="st-field">
          <label htmlFor="status">Estado da ação</label>
          <select id="status" name="status" defaultValue={status ?? ''}>
            <option value="">Todos</option>
            <option value="open">Aberta</option>
            <option value="done">Concluída</option>
            <option value="escalated">Escalada</option>
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>
      {!filtroValido ? (
        <div className="st-alert err" role="alert">
          Filtro inválido.
        </div>
      ) : null}

      <h2>Decisões ({decisoes.length})</h2>
      {decisoes.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio-d">
          <h2 id="vazio-d">Nenhuma decisão registrada</h2>
          <p>Nenhum ritual foi executado, então não há atas nem decisões. Nada é simulado.</p>
        </section>
      ) : (
        <ul>
          {decisoes.map((d) => (
            <li key={d.id}>
              {d.text} · {d.status} · {d.proposed_by}
            </li>
          ))}
        </ul>
      )}

      <h2>Ações ({acoes.length})</h2>
      {acoes.length === 0 ? (
        <p className="st-hint" data-vazio="acoes">
          Nenhuma ação no tracker.
        </p>
      ) : (
        <table className="st-table">
          <thead>
            <tr>
              <th scope="col">Ação</th>
              <th scope="col">Responsável</th>
              <th scope="col">Prazo</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            {acoes.map((a) => (
              <tr key={a.id}>
                <th scope="row">{a.title}</th>
                <td>{a.owner_agent_id}</td>
                <td>{a.due_date}</td>
                <td>{a.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
