import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { checkAccess } from '@/lib/studio/modules';
import { checkVersion, currentVersion, editoriaNome, getCmsService, STATUS_LABEL } from '@/lib/studio/cms/articles';
import { CMS_EDIT, CMS_READ, CMS_REVIEW } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../../_lib/guard';
import { ArticleForm } from '../ArticleForm';
import { approveAction, blockAction, reopenAction, submitReviewAction } from '../actions';

export const metadata: Metadata = { title: 'Matéria' };
export const dynamic = 'force-dynamic';

export default async function Materia({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tipo?: string; aviso?: string }>;
}) {
  const { session } = await requireStudio(CMS_READ);
  const { id } = await params;
  const { tipo, aviso } = await searchParams;
  const rec = getCmsService().get(id);
  if (!rec) notFound();
  const v = currentVersion(rec);
  const issues = checkVersion(v);
  const podeEditar = checkAccess(session, CMS_EDIT).ok;
  const podeRevisar = checkAccess(session, CMS_REVIEW).ok;
  const proprio = v.autor === session.userId;
  return (
    <>
      <p>
        <Link href="/studio/cms">← CMS editorial</Link>
      </p>
      <h1>{v.titulo}</h1>
      <p>
        <span className={`st-badge ${rec.status}`}>{STATUS_LABEL[rec.status]}</span> · v{v.numero} · {editoriaNome(v.editoria)} · assinatura {rec.assinatura}
      </p>
      {aviso ? (
        <div className={`st-alert ${tipo === 'err' ? 'err' : 'ok'}`} role={tipo === 'err' ? 'alert' : 'status'}>
          {aviso}
        </div>
      ) : null}
      {rec.status === 'bloqueado' && rec.motivoBloqueio ? <div className="st-alert err">Bloqueada: {rec.motivoBloqueio}</div> : null}

      <div className="st-two">
        <section aria-label="Editor">
          <ArticleForm key={`${rec.id}-${v.numero}`} id={rec.id} valor={v} somenteLeitura={!podeEditar} />
        </section>
        <aside aria-label="Revisão">
          <div className="st-card">
            <h2 style={{ marginTop: 0 }}>Checagem automática</h2>
            {issues.length === 0 ? (
              <p>Sem pendências.</p>
            ) : (
              <ul className="st-issues">
                {issues.map((i, n) => (
                  <li key={n} className={i.severidade}>
                    {i.mensagem}
                  </li>
                ))}
              </ul>
            )}
            <div className="st-actions" style={{ marginTop: 12 }}>
              {rec.status === 'rascunho' && podeEditar ? (
                <form action={submitReviewAction}>
                  <input type="hidden" name="id" value={rec.id} />
                  <button className="st-btn" type="submit">
                    Enviar para checagem
                  </button>
                </form>
              ) : null}
              {(rec.status === 'bloqueado' || rec.status === 'aprovado') && podeEditar ? (
                <form action={reopenAction}>
                  <input type="hidden" name="id" value={rec.id} />
                  <button className="st-btn sec" type="submit">
                    Reabrir como rascunho
                  </button>
                </form>
              ) : null}
            </div>
            {rec.status === 'em_checagem' && podeRevisar ? (
              <div style={{ marginTop: 12 }}>
                {proprio ? <p className="st-hint">Você é o autor da v{v.numero}: outra pessoa precisa aprová-la (quatro olhos).</p> : null}
                <form action={approveAction} className="st-actions">
                  <input type="hidden" name="id" value={rec.id} />
                  <input type="hidden" name="versao" value={v.numero} />
                  <button className="st-btn" type="submit" disabled={proprio}>
                    Aprovar v{v.numero}
                  </button>
                </form>
                <form action={blockAction} style={{ marginTop: 10 }}>
                  <input type="hidden" name="id" value={rec.id} />
                  <div className="st-field">
                    <label htmlFor="motivo">Motivo do bloqueio</label>
                    <input id="motivo" name="motivo" type="text" />
                  </div>
                  <button className="st-btn danger" type="submit">
                    Bloquear
                  </button>
                </form>
              </div>
            ) : null}
            {rec.aprovacao ? (
              <p className="st-hint">
                Aprovada na v{rec.aprovacao.versao} por {rec.aprovacao.por}.
              </p>
            ) : null}
            <p style={{ marginTop: 12 }}>
              <button className="st-btn" type="button" disabled aria-disabled="true" aria-describedby="pub-hint">
                Publicar
              </button>
            </p>
            <p className="st-hint" id="pub-hint">
              Publicar não está disponível: depende do backend e de aprovação ligada à versão (R3-07), além do gate de publicação.
            </p>
          </div>

          <div className="st-card" style={{ marginTop: 14 }}>
            <h2 style={{ marginTop: 0 }}>Versões</h2>
            <ol reversed>
              {[...rec.versoes].reverse().map((x) => (
                <li key={x.numero}>
                  v{x.numero} · {x.autor} · {x.criadaEm.slice(0, 16).replace('T', ' ')} UTC{x.nota ? ` · ${x.nota}` : ''}
                </li>
              ))}
            </ol>
          </div>
          <div className="st-card" style={{ marginTop: 14 }}>
            <h2 style={{ marginTop: 0 }}>Histórico</h2>
            <ul className="st-issues">
              {[...rec.historico].reverse().map((h, i) => (
                <li key={i}>
                  {h.em.slice(11, 19)} · {h.quem} · {h.acao.replaceAll('_', ' ')} (v{h.versao}){h.detalhe ? ` — ${h.detalhe}` : ''}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}
