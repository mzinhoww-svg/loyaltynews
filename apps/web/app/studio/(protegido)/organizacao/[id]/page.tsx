import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findModule } from '@/lib/studio/modules';
import { getOrganizacao } from '@/lib/studio/agentes';
import { requireModule } from '../../../_lib/guard';

export const metadata: Metadata = { title: 'Agente' };
export const dynamic = 'force-dynamic';

export default async function AgentePage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(findModule('organizacao')!);
  const { id } = await params;
  const org = getOrganizacao();
  const a = org.registries.agents.find((x) => x.id === id);
  if (!a) notFound();
  const subordinados = org.registries.agents.filter((x) => x.reports_to === a.id);
  const workflows = org.registries.workflows.filter((w) => w.owner === a.id || w.steps.includes(a.id));
  return (
    <>
      <p>
        <Link href="/studio/organizacao">← Organização agêntica</Link>
      </p>
      <h1>{a.name}</h1>
      <p className="st-hint">
        {a.id} · {a.department} · reporta a {a.reports_to ?? 'ninguém (topo)'} · {a.enabled ? 'habilitado' : 'não habilitado'} · rota padrão {a.default_route_hint}
      </p>
      <h2>Missão</h2>
      <p>{a.mission}</p>
      <h2>Escopo e KPI</h2>
      <p>
        {a.scope}. KPI: {a.kpi}
      </p>
      <h2>Ferramentas permitidas</h2>
      <ul aria-label="Ferramentas permitidas">
        {a.allowed_tools.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <h2>Equipe direta ({subordinados.length})</h2>
      {subordinados.length === 0 ? <p className="st-hint">Sem subordinados diretos.</p> : <p>{subordinados.map((s) => s.name).join(', ')}</p>}
      <h2>Workflows em que atua ({workflows.length})</h2>
      {workflows.length === 0 ? <p className="st-hint">Nenhum workflow cita este agente.</p> : <p>{workflows.map((w) => `${w.id} ${w.name}`).join('; ')}</p>}
      <p className="st-hint">A execução do agente (chamadas de modelo) só acontece quando elas forem ligadas, depois desta fase, e com aprovação.</p>
    </>
  );
}
