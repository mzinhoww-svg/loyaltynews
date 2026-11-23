import type { Metadata } from 'next';
import Link from 'next/link';
import { isEnabled } from '@ln/contracts';
import { getDashboardSummary, listQueue, listReceipts } from '@ln/growth/dashboard';
import { DashboardSummaryCards, PackageQueue } from '@ln/growth/ui';
import { findModule } from '@/lib/studio/modules';
import { socialCaller, socialDeps } from '@/lib/studio/social';
import { requireModule } from '../../_lib/guard';

export const metadata: Metadata = { title: 'Social dashboard' };
export const dynamic = 'force-dynamic';

export default async function SocialPage({ searchParams }: { searchParams: Promise<{ channel?: string; status?: string }> }) {
  const { session } = await requireModule(findModule('social')!);
  const q = await searchParams;
  const deps = socialDeps();
  const caller = socialCaller(session);
  const resumo = await getDashboardSummary(deps, caller);
  const fila = await listQueue(deps, caller, { channel: q.channel || undefined, status: q.status || undefined });
  const recibos = await listReceipts(deps, caller);
  if (resumo.status !== 200 || !('totals' in resumo.body)) {
    return (
      <>
        <h1>Social dashboard</h1>
        <p role="alert" className="st-alert err">
          Sem permissão para ver o Social dashboard.
        </p>
      </>
    );
  }
  const filtroInvalido = fila.status !== 200 || !('items' in fila.body);
  return (
    <>
      <h1>Social dashboard</h1>
      <p>
        Pacotes sociais por canal, com bloqueios e recibos. O Studio <strong>não publica</strong>: não há integração de escrita com o mLabs aqui (identidade de publicação separada, ADR-008). Instagram e The Loyal estão construídos e desligados por flag.
      </p>
      <DashboardSummaryCards summary={resumo.body} />
      <p className="st-hint">
        Flags: linkedinPublicacao {isEnabled('linkedinPublicacao') ? 'ligada' : 'desligada'} · instagram {isEnabled('instagram') ? 'ligada' : 'desligada'} · theLoyal {isEnabled('theLoyal') ? 'ligada' : 'desligada'}.
      </p>

      <h2>Fila de pacotes</h2>
      <form className="st-filters" method="get" role="search" aria-label="Filtrar pacotes">
        <div className="st-field">
          <label htmlFor="channel">Canal</label>
          <select id="channel" name="channel" defaultValue={q.channel ?? ''}>
            <option value="">Todos</option>
            <option value="linkedin">LinkedIn</option>
            <option value="instagram">Instagram</option>
            <option value="the_loyal">The Loyal</option>
          </select>
        </div>
        <div className="st-field">
          <label htmlFor="status">Estado</label>
          <select id="status" name="status" defaultValue={q.status ?? ''}>
            <option value="">Todos</option>
            <option value="gerado">Gerado</option>
            <option value="bloqueado">Bloqueado</option>
            <option value="simulado">Publicado (simulado)</option>
            <option value="recusado">Recusado</option>
            <option value="falhou">Falha na geração</option>
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>
      {filtroInvalido ? (
        <div className="st-alert err" role="alert">
          Filtro inválido.
        </div>
      ) : (
        <PackageQueue result={fila.body as Parameters<typeof PackageQueue>[0]['result']} hrefFor={(it) => `/studio/social/${encodeURIComponent(it.id)}`} />
      )}
      <p className="st-hint">
        Geração de pacotes depende de matérias com fatos aprovados e gates automáticos (WF02/WF03) da Fábrica editorial, que ainda não alimenta o Studio.{' '}
        <Link href="/studio/cms">Ver o CMS</Link>.
      </p>

      <h2>Recibos</h2>
      {'items' in recibos.body && recibos.body.items.length > 0 ? (
        <ul>
          {recibos.body.items.map((r) => (
            <li key={r.receipt.id}>
              {r.packageId}: {r.receipt.status} {r.receipt.simulated ? '(simulado)' : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p className="st-hint">Nenhum recibo. Métricas de alcance: não disponível (sem integração).</p>
      )}
    </>
  );
}
