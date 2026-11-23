import type { Metadata } from 'next';
import Link from 'next/link';
import { isEnabled } from '@ln/contracts';
import type { DashboardSummary, QueueResult, ReceiptRow } from '@ln/growth/dashboard';
import { DashboardSummaryCards, PackageQueue } from '@ln/growth/ui';
import { dispatchSocial } from '@/app/api/_lib/social';
import { api } from '@/lib/studio/rotas-api';
import { chamar, ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { gerarPacotesAction } from './actions';

export const metadata: Metadata = { title: 'Social dashboard' };
export const dynamic = 'force-dynamic';

const API = '/api/studio/social';

export default async function SocialPage({ searchParams }: { searchParams: Promise<{ channel?: string; status?: string; tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('social')!);
  const q = await searchParams;
  const resumo = await chamar<DashboardSummary>(dispatchSocial, `${API}/summary`);
  if (naoConfigurado(resumo)) {
    return (
      <>
        <h1>Social dashboard</h1>
        <SemBanco modulo="O Social dashboard" />
      </>
    );
  }
  if (ehErro(resumo)) {
    return (
      <>
        <h1>Social dashboard</h1>
        <div className="st-alert err" role="alert">
          {mensagemErro(resumo)}
        </div>
      </>
    );
  }
  const fila = await chamar<QueueResult>(dispatchSocial, `${API}/queue`, { query: { channel: q.channel, status: q.status } });
  const recibos = await chamar<{ items: ReceiptRow[] }>(dispatchSocial, `${API}/receipts`);
  const aprovadas = await api.materias.listar({ status: 'aprovado' });
  const podeGerar = checkAccess(session, ['admin', 'editor_chefe', 'editor']).ok;
  return (
    <>
      <h1>Social dashboard</h1>
      <p>
        Pacotes sociais por canal, com bloqueios e recibos, vindos das rotas reais do Backend (<code>/api/studio/social</code>). A publicação é <strong>somente simulada</strong>: nada vai ao mLabs (identidade de publicação separada, ADR-008). Instagram e The Loyal estão construídos e desligados por flag.
      </p>
      <Flash tipo={q.tipo} aviso={q.aviso} />
      <DashboardSummaryCards summary={resumo.body as DashboardSummary} />
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
      {ehErro(fila) ? (
        <div className="st-alert err" role="alert">
          Filtro inválido.
        </div>
      ) : (
        <PackageQueue result={fila.body as QueueResult} hrefFor={(it) => `/studio/social/${encodeURIComponent(it.id)}`} />
      )}

      {podeGerar ? (
        <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="gerar">
          <h2 id="gerar" style={{ marginTop: 0 }}>
            Gerar pacotes
          </h2>
          <p className="st-hint">Só matérias aprovadas. Os fatos vêm da checagem editorial aprovada: sem fato aprovado o pacote vira &quot;falhou&quot;, com as regras violadas.</p>
          <form action={gerarPacotesAction}>
            <div className="st-field">
              <label htmlFor="articleId">Matéria aprovada</label>
              <select id="articleId" name="articleId">
                {(ehErro(aprovadas) ? [] : aprovadas.body.data).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.titulo}
                  </option>
                ))}
              </select>
            </div>
            <div className="st-field">
              <label htmlFor="canal">Canal</label>
              <select id="canal" name="canal" defaultValue="linkedin">
                <option value="linkedin">LinkedIn</option>
                <option value="instagram">Instagram (flag desligada)</option>
              </select>
            </div>
            <button className="st-btn" type="submit">
              Gerar pacote
            </button>
          </form>
        </section>
      ) : null}
      <p className="st-hint">
        <Link href="/studio/cms">Ver o CMS</Link>.
      </p>

      <h2>Recibos</h2>
      {!ehErro(recibos) && (recibos.body as { items: ReceiptRow[] }).items.length > 0 ? (
        <ul>
          {(recibos.body as { items: ReceiptRow[] }).items.map((r) => (
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
