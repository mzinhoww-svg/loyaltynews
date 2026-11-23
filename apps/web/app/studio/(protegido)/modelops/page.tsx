import type { Metadata } from 'next';
import { modelCallsAllowed } from '@ln/contracts';
import { flagAtiva } from '@/lib/studio/flags';
import { TASK_CATALOG, route } from '@ln/modelops';
import { findModule } from '@/lib/studio/modules';
import { POLITICA_ROTULO, carregarPolitica } from '@/lib/studio/modelops';
import { requireModule } from '../../_lib/guard';
import { SemRotaBackend } from '../../_components/SemBanco';

export const metadata: Metadata = { title: 'ModelOps' };
export const dynamic = 'force-dynamic';

const CLASSES = ['public', 'internal', 'commercial_confidential', 'personal', 'restricted', 'secret'] as const;

export default async function ModelOpsPage({ searchParams }: { searchParams: Promise<{ task?: string; classe?: string; inedito?: string; rascunho?: string }> }) {
  await requireModule(findModule('modelops')!);
  const q = await searchParams;
  const pol = carregarPolitica();
  if (!pol.ok) {
    return (
      <>
        <h1>ModelOps</h1>
        <div className="st-alert err" role="alert">
          Política de modelos inválida ou ausente. Falha fechada: nenhuma rota é permitida. {pol.erros.join(' ')}
        </div>
      </>
    );
  }
  const policy = pol.policy;
  const flag = flagAtiva('modelosHabilitados');
  const reais = modelCallsAllowed(policy as unknown as Parameters<typeof modelCallsAllowed>[0], flag);
  const simular = Boolean(q.task);
  const decisao = simular
    ? route(policy, {
        task: q.task!,
        dataClasses: [q.classe || 'public'],
        unpublished: q.inedito === 'on',
        ...(q.rascunho ? { draftModelId: q.rascunho } : {}),
        mode: 'simulation',
        qualifiedModelIds: [],
        zdrVerifiedModelIds: [],
        now: new Date(),
      })
    : null;
  return (
    <>
      <h1>ModelOps</h1>
      <SemRotaBackend o_que="O catálogo de modelos e as rotas vêm da configuração (@ln/modelops)." />
      <p>Catálogo, roteamento por tarefa e classe de dado. Nenhuma chamada de modelo sai do Studio.</p>
      <div className="st-alert" role="status">
        <strong>{POLITICA_ROTULO}.</strong> Versão {policy.version}, preços de {policy.rate_card_as_of}. Chamadas reais:{' '}
        <strong data-reais={reais ? 'sim' : 'nao'}>{reais ? 'permitidas' : 'bloqueadas'}</strong> (política production_enabled={String(policy.rules.production_enabled)}, flag modelosHabilitados {flag ? 'ligada' : 'desligada'}).
      </div>

      <h2>Catálogo de modelos ({policy.models.length})</h2>
      <table className="st-table" tabIndex={0} aria-label="Catálogo de modelos">
        <thead>
          <tr>
            <th scope="col">Modelo</th>
            <th scope="col">Provedor</th>
            <th scope="col">Capacidades</th>
            <th scope="col">Preço (USD/Mtok in / out)</th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {policy.models.map((m) => (
            <tr key={m.id} data-modelo={m.id}>
              <th scope="row">{m.id}</th>
              <td>{m.provider}</td>
              <td>{m.capabilities.join(', ')}</td>
              <td>{m.binding ? `${m.binding.price_usd_per_mtok.input ?? '—'} / ${m.binding.price_usd_per_mtok.output ?? '—'} (em ${m.binding.price_as_of})` : 'sem preço: bloqueia'}</td>
              <td>{m.candidate_only ? 'candidato (não qualificado)' : 'catalogado'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 24 }}>Simulação de rota (dry run, não gasta)</h2>
      <p className="st-hint">Decide modelo primário e fallbacks sem chamar provedor nem reservar orçamento. Sem modelo qualificado (R2-07/08), o resultado é bloqueio com os motivos.</p>
      <form className="st-filters" method="get" role="search" aria-label="Simular rota">
        <div className="st-field">
          <label htmlFor="task">Tarefa</label>
          <select id="task" name="task" defaultValue={q.task ?? ''}>
            <option value="">Escolha…</option>
            {Object.keys(TASK_CATALOG).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="st-field">
          <label htmlFor="classe">Classe do dado</label>
          <select id="classe" name="classe" defaultValue={q.classe ?? 'public'}>
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="st-field">
          <label>
            <input type="checkbox" name="inedito" defaultChecked={q.inedito === 'on'} /> Trabalho inédito (exige ZDR)
          </label>
        </div>
        <button className="st-btn sec" type="submit">
          Simular
        </button>
      </form>
      {decisao ? (
        <section className="st-card" aria-label="Resultado da simulação" data-status={decisao.status}>
          <h3 style={{ marginTop: 0 }}>
            Resultado: {decisao.status === 'eligible' ? 'elegível' : decisao.status === 'deterministic' ? 'determinística (sem modelo)' : 'bloqueada'}
          </h3>
          {decisao.status === 'blocked' ? (
            <>
              <p>
                Motivo: <code>{decisao.reason}</code>. {decisao.detail}
              </p>
              {decisao.reasons ? (
                <ul aria-label="Motivos por candidato">
                  {Object.entries(decisao.reasons).map(([id, why]) => (
                    <li key={id}>
                      {id}: {why.join(', ')}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : decisao.status === 'eligible' ? (
            <p>
              Primário {decisao.primary}; fallbacks {decisao.fallbacks.join(', ') || 'nenhum'}.
            </p>
          ) : (
            <p>Tarefa determinística: não passa por modelo nem consome orçamento.</p>
          )}
          <p className="st-hint">Simulação: nenhum custo foi reservado.</p>
        </section>
      ) : null}
    </>
  );
}
