import type { Metadata } from 'next';
import Link from 'next/link';
import { flagAtiva } from '@/lib/studio/flags';
import { findModule } from '@/lib/studio/modules';
import { getOrganizacao } from '@/lib/studio/agentes';
import { requireModule } from '../../_lib/guard';
import { SemRotaBackend } from '../../_components/SemBanco';
import { QuadroRolavel } from '../../_components/QuadroRolavel';

export const metadata: Metadata = { title: 'Organização agêntica' };
export const dynamic = 'force-dynamic';

export default async function OrganizacaoPage({ searchParams }: { searchParams: Promise<{ depto?: string }> }) {
  await requireModule(findModule('organizacao')!);
  const { depto = '' } = await searchParams;
  const org = getOrganizacao();
  const agentes = org.registries.agents;
  const departamentos = [...new Set(agentes.map((a) => a.department))];
  const lista = depto ? agentes.filter((a) => a.department === depto) : agentes;
  return (
    <>
      <h1>Organização agêntica</h1>
      <SemRotaBackend o_que="Organograma agêntico, papéis e registros vêm da configuração do repositório (@ln/agents)." />
      <p>
        Configuração versionada dos registros oficiais: {agentes.length} perfis, {org.registries.workflows.length} workflows e {org.registries.meetings.length} rituais. Responsabilidade vertical, execução horizontal. Rituais:{' '}
        <strong>{flagAtiva('rituais') ? 'ligados' : 'desligados'}</strong> e chamadas de modelo <strong>{flagAtiva('modelosHabilitados') ? 'habilitadas' : 'desabilitadas'}</strong>: nada executa agora.
      </p>

      <h2>Diretorias</h2>
      <QuadroRolavel rotulo="Diretorias">
      <table className="st-table">
        <caption className="st-hint" style={{ textAlign: 'left' }}>
          {org.directorates.length} diretorias, todas reportam ao publisher
        </caption>
        <thead>
          <tr>
            <th scope="col">Diretoria</th>
            <th scope="col">Diretor</th>
            <th scope="col">Membros</th>
            <th scope="col">Daily</th>
            <th scope="col">Semanal</th>
          </tr>
        </thead>
        <tbody>
          {org.directorates.map((d) => (
            <tr key={d.id} data-diretoria={d.id}>
              <th scope="row">{d.department}</th>
              <td>{d.director}</td>
              <td>{d.members.length}</td>
              <td>{d.daily_meeting}</td>
              <td>{d.weekly_meeting ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </QuadroRolavel>

      <h2 style={{ marginTop: 24 }}>Redações especializadas</h2>
      <QuadroRolavel rotulo="Redações especializadas">
      <table className="st-table">
        <caption className="st-hint" style={{ textAlign: 'left' }}>
          {org.newsrooms.length} redações, cada uma com editor, redator e memória própria
        </caption>
        <thead>
          <tr>
            <th scope="col">Redação</th>
            <th scope="col">Editor</th>
            <th scope="col">Redator</th>
            <th scope="col">Daily</th>
          </tr>
        </thead>
        <tbody>
          {org.newsrooms.map((n) => (
            <tr key={n.editoria} data-redacao={n.editoria}>
              <th scope="row">{n.name}</th>
              <td>{n.editor}</td>
              <td>{n.writer}</td>
              <td>{n.daily_meeting}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </QuadroRolavel>

      <h2 style={{ marginTop: 24 }}>Agentes</h2>
      <form className="st-filters" method="get" role="search" aria-label="Filtrar agentes">
        <div className="st-field">
          <label htmlFor="depto">Departamento</label>
          <select id="depto" name="depto" defaultValue={depto}>
            <option value="">Todos</option>
            {departamentos.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>
      <QuadroRolavel rotulo="Agentes">
      <table className="st-table">
        <caption className="st-hint" style={{ textAlign: 'left' }}>
          {lista.length} agente(s)
        </caption>
        <thead>
          <tr>
            <th scope="col">Agente</th>
            <th scope="col">Departamento</th>
            <th scope="col">Reporta a</th>
            <th scope="col">Rota padrão</th>
            <th scope="col">Habilitado</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((a) => (
            <tr key={a.id} data-agente={a.id}>
              <th scope="row">
                <Link href={`/studio/organizacao/${a.id}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 'var(--ln-touch-target)' }}>{/* P2-4: alvo de toque do DS */}{a.name}</Link>
              </th>
              <td>{a.department}</td>
              <td>{a.reports_to ?? '—'}</td>
              <td>{a.default_route_hint}</td>
              <td>{a.enabled ? 'sim' : 'não'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </QuadroRolavel>
    </>
  );
}
