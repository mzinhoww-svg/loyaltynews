import type { Metadata } from 'next';
import { isEnabled } from '@ln/contracts';
import { gateConfigFromPolicy, microToUsd } from '@ln/modelops';
import { findModule } from '@/lib/studio/modules';
import { POLITICA_ROTULO, carregarPolitica, getPortao } from '@/lib/studio/modelops';
import { requireModule } from '../../_lib/guard';
import { SemRotaBackend } from '../../_components/SemBanco';

export const metadata: Metadata = { title: 'FinOps' };
export const dynamic = 'force-dynamic';

const usd = (micro: number) => `US$ ${microToUsd(micro).toFixed(2)}`;

export default async function FinOpsPage() {
  await requireModule(findModule('finops')!);
  const pol = carregarPolitica();
  if (!pol.ok) {
    return (
      <>
        <h1>FinOps</h1>
        <div className="st-alert err" role="alert">
          Política de modelos inválida ou ausente: orçamento indisponível. {pol.erros.join(' ')}
        </div>
      </>
    );
  }
  const cfg = gateConfigFromPolicy(pol.policy);
  const snap = await getPortao(pol.policy).snapshot(new Date());
  const provedores = Object.entries(cfg.providerAllocationMicro);
  return (
    <>
      <h1>FinOps</h1>
      <SemRotaBackend o_que="Orçamento e teto vêm da configuração (@ln/modelops); o consumo é o livro-razão do gateway." />
      <p>Orçamento, consumo e degraus do mês (America/Sao_Paulo). Só o admin altera limites; agentes não alteram o teto mensal.</p>
      <div className="st-alert" role="status">
        {POLITICA_ROTULO}. Chamadas de modelo: <strong>{isEnabled('modelosHabilitados') ? 'habilitadas' : 'desabilitadas'}</strong> (flag modelosHabilitados).
      </div>
      <div className="st-grid" aria-label="Resumo do mês">
        <section className="st-card" aria-label="Teto mensal">
          <p className="st-hint">Teto mensal agregado</p>
          <p className="st-stat" data-teto>
            {usd(cfg.capMicro)}
          </p>
        </section>
        <section className="st-card" aria-label="Consumo registrado">
          <p className="st-hint">Consumo registrado ({snap.monthKey})</p>
          <p className="st-stat" data-consumo>
            {usd(snap.totalMicro)}
          </p>
          <p className="st-hint">Origem: livro-razão do gateway (em memória). {snap.totalMicro === 0 ? 'Sem consumo: nenhuma chamada foi feita.' : ''}</p>
        </section>
        <section className="st-card" aria-label="Reservas">
          <p className="st-hint">Reservas abertas / pendentes</p>
          <p className="st-stat">
            {snap.openReservations} / {snap.pendingReservations}
          </p>
        </section>
      </div>

      <h2>Verbas por provedor</h2>
      <table className="st-table">
        <thead>
          <tr>
            <th scope="col">Provedor</th>
            <th scope="col">Verba</th>
            <th scope="col">Consumido</th>
          </tr>
        </thead>
        <tbody>
          {provedores.map(([p, micro]) => (
            <tr key={p} data-provedor={p}>
              <th scope="row">{p}</th>
              <td>{usd(micro)}</td>
              <td>{usd(snap.providerMicro[p] ?? 0)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">imagens</th>
            <td>{usd(cfg.imageAllocationMicro)}</td>
            <td>—</td>
          </tr>
          <tr>
            <th scope="row">reserva (auditoria e errata)</th>
            <td>{usd(cfg.reserveMicro)}</td>
            <td>{usd(snap.reserveMicro)}</td>
          </tr>
          <tr>
            <th scope="row">escalonamento (Opus/Fable, dentro da Anthropic)</th>
            <td>{usd(cfg.escalationSublimitMicro)}</td>
            <td>{usd(snap.escalationMicro)}</td>
          </tr>
        </tbody>
      </table>

      <h2 style={{ marginTop: 24 }}>Degraus</h2>
      <ul aria-label="Degraus de gasto">
        <li>Premium e experimentos até {usd(cfg.ceilingMicro.premium)}</li>
        <li>Não essencial até {usd(cfg.ceilingMicro.non_essential)}</li>
        <li>Essencial até {usd(cfg.ceilingMicro.essential)}</li>
        <li>Reserva de auditoria até {usd(cfg.ceilingMicro.reserve)}</li>
      </ul>
      <p className="st-hint">Forecast e alertas dependem de consumo real; sem chamadas, não há projeção a mostrar. Kill switch: acionado pelo admin no gateway (não disponível nesta tela).</p>
    </>
  );
}
