import type { Metadata } from 'next';
import Link from 'next/link';
import { addDays, isRescheduled, occurrencesOn } from '@ln/agents';
import { isEnabled } from '@ln/contracts';
import { hojeSP } from '@/lib/studio/datas';
import { findModule } from '@/lib/studio/modules';
import { getCalendarioBr, getOrganizacao, getStoreAgentes } from '@/lib/studio/agentes';
import { requireModule } from '../../_lib/guard';

export const metadata: Metadata = { title: 'Calendário de reuniões' };
export const dynamic = 'force-dynamic';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReunioesPage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  await requireModule(findModule('reunioes')!);
  const { data } = await searchParams;
  const hoje = hojeSP();
  const dia = data && DATA.test(data) ? data : hoje;
  const org = getOrganizacao();
  let ocorrencias: ReturnType<typeof occurrencesOn> = [];
  let erro: string | null = null;
  try {
    ocorrencias = occurrencesOn(org.registries.meetings, dia, getCalendarioBr());
  } catch (e) {
    erro = e instanceof Error ? e.message : 'Data fora do calendário suportado.';
  }
  const runs = await getStoreAgentes().listRuns({ localDate: dia });
  const hora = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(d);
  return (
    <>
      <h1>Calendário de reuniões</h1>
      <p>
        Rituais no fuso America/Sao_Paulo, com feriados nacionais. Execução dos rituais: <strong>{isEnabled('rituais') ? 'ligada' : 'desligada'}</strong> (flag rituais, ativa só após o gate R4).
      </p>
      <nav aria-label="Navegar entre dias" className="st-actions" style={{ marginBottom: 12 }}>
        <Link className="st-btn sec" href={`/studio/reunioes?data=${addDays(dia, -1)}`}>
          ← Dia anterior
        </Link>
        <strong data-dia={dia}>{dia}</strong>
        <Link className="st-btn sec" href={`/studio/reunioes?data=${addDays(dia, 1)}`}>
          Próximo dia →
        </Link>
        <Link className="st-btn sec" href="/studio/reunioes">
          Hoje
        </Link>
      </nav>
      {erro ? (
        <div className="st-alert err" role="alert">
          {erro}
        </div>
      ) : ocorrencias.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhum ritual neste dia</h2>
          <p>Fim de semana, feriado ou nenhum ritual agendado para {dia}.</p>
        </section>
      ) : (
        <table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {ocorrencias.length} ritual(is) em {dia}
          </caption>
          <thead>
            <tr>
              <th scope="col">Hora</th>
              <th scope="col">Ritual</th>
              <th scope="col">Presidência</th>
              <th scope="col">Quórum</th>
              <th scope="col">Execução</th>
            </tr>
          </thead>
          <tbody>
            {ocorrencias.map((o) => (
              <tr key={o.meeting.id + o.originalDate} data-ritual={o.meeting.id}>
                <td>{hora(o.scheduledFor)}</td>
                <th scope="row">
                  {o.meeting.id} · {o.meeting.title}
                  {isRescheduled(o) ? <span className="st-hint"> (movido de {o.originalDate} por feriado)</span> : null}
                </th>
                <td>{o.meeting.chair}</td>
                <td>
                  {o.meeting.quorum.minimum} de {o.meeting.participants.length}
                </td>
                <td>{runs.some((r) => r.meeting_id === o.meeting.id) ? 'registrada' : 'não executada'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: 24 }}>Todos os rituais ({org.registries.meetings.length})</h2>
      <table className="st-table">
        <thead>
          <tr>
            <th scope="col">Ritual</th>
            <th scope="col">Ciclo</th>
            <th scope="col">Horário local</th>
            <th scope="col">Ativa após</th>
          </tr>
        </thead>
        <tbody>
          {org.registries.meetings.map((m) => (
            <tr key={m.id}>
              <th scope="row">
                {m.id} · {m.title}
              </th>
              <td>{m.cycle}</td>
              <td>{m.schedule_local}</td>
              <td>{m.activate_after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
