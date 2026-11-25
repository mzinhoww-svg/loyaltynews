import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { checkAccess } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { CMS_EDIT, CMS_READ, CMS_REVIEW } from '@/lib/studio/cms/roles';
import { estadoDaFilaDeChecagem } from '@/lib/studio/cms/checagem-fila';
import { QUEUE_DECISIONS } from '@ln/workers/queues';
import { requireStudio } from '../../../../_lib/guard';
import { Flash } from '../../../../_components/Flash';
import { QuadroRolavel } from '../../../../_components/QuadroRolavel';
import { SemBanco } from '../../../../_components/SemBanco';
import { decidirRevisaoAction, rechecarAction } from '../../actions';

export const metadata: Metadata = { title: 'Revisão da matéria' };
export const dynamic = 'force-dynamic';

interface Revisao {
  articleId: string;
  status: string;
  editoria: string;
  rascunho: { titulo: string; corpo: string; assinatura: string; claims: { id: string; kind: string; text: string; verdict: string | null }[] } | null;
  evidencias: { id: string; url: string; titulo: string; suspeita: boolean }[];
  gate: { passou: boolean; achados: { code: string; message: string }[]; independencia: { checked: boolean; independent: boolean }; todasClaimsAprovadas: boolean };
  bloqueios: string[];
  revisoes: { at: string; userId: string; decision: string; note: string }[];
}

export default async function RevisaoPage({ params, searchParams }: { params: Promise<{ articleId: string }>; searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireStudio(CMS_READ);
  const articleId = decodeURIComponent((await params).articleId);
  const { tipo, aviso } = await searchParams;
  const r = await api.editorial.revisao(articleId);
  if (naoConfigurado(r)) return <SemBanco modulo="A revisão editorial" />;
  if (r.status === 404 || r.status === 400) notFound();
  if (ehErro(r)) throw new Error(mensagemErro(r));
  const v = r.body as Revisao;
  const podeRevisar = checkAccess(session, CMS_REVIEW).ok;
  const podeRechecar = checkAccess(session, CMS_EDIT).ok;
  const filaChecagem = estadoDaFilaDeChecagem(QUEUE_DECISIONS.checagem);
  return (
    <>
      <p>
        <Link href="/studio/cms/checagem">← Fila de checagem</Link>
      </p>
      <h1>{v.rascunho?.titulo ?? v.articleId}</h1>
      <p className="st-hint">
        {v.status} · {v.editoria} · assinatura {v.rascunho?.assinatura ?? '—'}
      </p>
      <Flash tipo={tipo} aviso={aviso} />
      <section className="st-card" aria-labelledby="gate" data-gate={v.gate.passou ? 'passou' : 'nao-passou'}>
        <h2 id="gate" style={{ marginTop: 0 }}>
          Gate de fatos: {v.gate.passou ? 'passou' : 'não passou'}
        </h2>
        <p>
          Todas as afirmações aprovadas: {v.gate.todasClaimsAprovadas ? 'sim' : 'não'} · checagem independente do redator: {v.gate.independencia.independent ? 'sim' : 'não'}. O gate é recalculado a cada leitura; humano não força aprovação.
        </p>
        {v.gate.achados.length > 0 ? (
          <ul className="st-issues" aria-label="Achados do gate">
            {v.gate.achados.map((a, i) => (
              <li key={i} className="bloqueio">
                {a.code}: {a.message}
              </li>
            ))}
          </ul>
        ) : null}
        {v.bloqueios.length ? <p>Bloqueios: {v.bloqueios.join('; ')}</p> : null}
      </section>

      <h2>Afirmações (claims)</h2>
      {v.rascunho && v.rascunho.claims.length > 0 ? (
        <QuadroRolavel rotulo="Checagem da matéria">
<table className="st-table">
          <thead>
            <tr>
              <th scope="col">Afirmação</th>
              <th scope="col">Tipo</th>
              <th scope="col">Veredito</th>
            </tr>
          </thead>
          <tbody>
            {v.rascunho.claims.map((c) => (
              <tr key={c.id}>
                <th scope="row">{c.text}</th>
                <td>{c.kind}</td>
                <td>{c.verdict ?? 'sem veredito'}</td>
              </tr>
            ))}
          </tbody>
        </table>
</QuadroRolavel>
      ) : (
        <p className="st-hint">Sem afirmações registradas.</p>
      )}

      <h2>Evidências ({v.evidencias.length})</h2>
      <ul>
        {v.evidencias.map((e) => (
          <li key={e.id}>
            {e.titulo} — {e.url} {e.suspeita ? '(suspeita)' : ''}
          </li>
        ))}
      </ul>

      <div className="st-actions" style={{ marginTop: 14 }}>
        {podeRechecar && filaChecagem.pedidoAceito ? (
          <form action={rechecarAction}>
            <input type="hidden" name="id" value={v.articleId} />
            <button className="st-btn sec" type="submit">
              Pedir nova checagem
            </button>
          </form>
        ) : null}
      </div>
      {podeRechecar && !filaChecagem.pedidoAceito ? (
        // fila desligada: estado permanente, não falha transitória — sem botão porque o pedido não seria aceito
        <p className="st-hint" data-fila-checagem="off">
          {filaChecagem.aviso}
        </p>
      ) : null}
      {podeRevisar ? (
        <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="decisao">
          <h2 id="decisao" style={{ marginTop: 0 }}>
            Decisão de revisão
          </h2>
          <form action={decidirRevisaoAction}>
            <input type="hidden" name="id" value={v.articleId} />
            <div className="st-field">
              <label htmlFor="decisao-sel">Decisão</label>
              <select id="decisao-sel" name="decisao" defaultValue="send_back">
                <option value="confirm">Confirmar (só vale com gate passando e matéria aprovada)</option>
                <option value="send_back">Devolver a rascunho</option>
                <option value="block">Bloquear</option>
              </select>
            </div>
            <div className="st-field">
              <label htmlFor="nota-rev">Nota (mínimo 3 caracteres)</label>
              <input id="nota-rev" name="nota" type="text" />
            </div>
            <button className="st-btn" type="submit">
              Registrar decisão
            </button>
          </form>
        </section>
      ) : null}

      <h2 style={{ marginTop: 24 }}>Revisões registradas ({v.revisoes.length})</h2>
      {v.revisoes.length === 0 ? (
        <p className="st-hint">Nenhuma revisão humana ainda.</p>
      ) : (
        <ul className="st-issues">
          {v.revisoes.map((rv, i) => (
            <li key={i}>
              {rv.at.slice(0, 16).replace('T', ' ')} · {rv.decision} — {rv.note}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
