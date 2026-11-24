import type { Metadata } from 'next';
import Link from 'next/link';
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
import { metricasVista, rotuloEstado } from '@/lib/studio/social-metricas';
import { flagAtiva } from '@/lib/studio/flags'; // ADR-022: flag pelo resolvedor de runtime, só no servidor (página force-dynamic)
import { QuadroRolavel } from '../../_components/QuadroRolavel';

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
        Pacotes sociais por canal, com bloqueios e recibos, vindos das rotas reais do Backend (<code>/api/studio/social</code>). A publicação é <strong>somente simulada</strong>: nada vai ao mLabs (identidade de publicação separada, ADR-008). Instagram e The Loyal estão construídos e desligados nesta fase.
      </p>
      <Flash tipo={q.tipo} aviso={q.aviso} />
      <DashboardSummaryCards summary={resumo.body as DashboardSummary} />
      <MetricasMlabs metricas={(resumo.body as DashboardSummary).metrics} />
      <p className="st-hint">
        Canais: LinkedIn {flagAtiva('linkedinPublicacao') ? 'ligado' : 'desligado nesta fase'} · Instagram {flagAtiva('instagram') ? 'ligado' : 'desligado nesta fase'} · The Loyal {flagAtiva('theLoyal') ? 'ligado' : 'desligado nesta fase'}.
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
        // a tabela da fila vem do @ln/growth/ui: o quadro do Studio dá a ela região com nome e foco no celular (ressalva do QA 7 no bfad5fc)
        <QuadroRolavel rotulo="Fila de pacotes sociais">
          <PackageQueue result={fila.body as QueueResult} hrefFor={(it) => `/studio/social/${encodeURIComponent(it.id)}`} />
        </QuadroRolavel>
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
                <option value="instagram">Instagram (desligado nesta fase)</option>
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
        <p className="st-hint">Nenhum recibo de publicação (simulada).</p>
      )}
    </>
  );
}

/** Métricas do LinkedIn lidas do mLabs (só leitura). Sem fonte ou com falha: estado vazio honesto; valor ausente é "—", nunca 0. */
function MetricasMlabs({ metricas }: { metricas: DashboardSummary['metrics'] }) {
  const v = metricasVista(metricas);
  return (
    <section aria-labelledby="metricas" style={{ marginTop: 18 }} data-metricas={v.disponivel ? 'disponivel' : 'indisponivel'}>
      <h2 id="metricas">Métricas do LinkedIn (mLabs, só leitura)</h2>
      {!v.disponivel ? (
        <div className="st-empty" data-vazio="metricas">
          <p style={{ margin: 0 }}>
            <strong>Métricas indisponíveis.</strong> {v.motivo}.
          </p>
          <p className="st-hint" style={{ margin: '6px 0 0' }}>
            O Studio só mostra números lidos do mLabs. Enquanto não houver leitura, nada é estimado nem preenchido com zero.
          </p>
        </div>
      ) : (
        <>
          <p className="st-hint">
            Período {v.periodo} · lido em {v.lidoEm.slice(0, 16).replace('T', ' ')} UTC. Somente leitura: nada é publicado pelo Studio.
          </p>
          <dl className="st-row" aria-label="Indicadores">
            {v.celulas.map((c) => (
              <div key={c.rotulo} className="st-card" data-metrica={c.rotulo} data-estado={c.estado}>
                <dt>{c.rotulo}</dt>
                <dd style={{ margin: 0, fontSize: '1.4em' }}>
                  <strong>{c.valor}</strong>
                </dd>
                <dd className="st-hint" style={{ margin: 0 }}>
                  {rotuloEstado(c.estado)}
                  {c.nota ? ` · ${c.nota}` : ''}
                </dd>
              </div>
            ))}
          </dl>
          {v.posts.length === 0 ? (
            <p className="st-hint" data-vazio="posts-mlabs">
              Nenhum post publicado no período, segundo o mLabs.
            </p>
          ) : (
            <QuadroRolavel rotulo="Posts publicados no mLabs">
            <table className="st-table">
              <caption>Posts publicados (mLabs){v.cortada ? ' — lista cortada; o total está acima' : ''}</caption>
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Curtidas</th>
                  <th scope="col">Comentários</th>
                  <th scope="col">Visualizações</th>
                </tr>
              </thead>
              <tbody>
                {v.posts.map((p) => (
                  <tr key={p.chave}>
                    <td>{p.data}</td>
                    <td>{p.tipo}</td>
                    <td>{p.curtidas}</td>
                    <td>{p.comentarios}</td>
                    <td>{p.visualizacoes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </QuadroRolavel>
          )}
        </>
      )}
    </section>
  );
}
