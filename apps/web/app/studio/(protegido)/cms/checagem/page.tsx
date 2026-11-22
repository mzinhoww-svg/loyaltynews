import type { Metadata } from 'next';
import Link from 'next/link';
import { checkAccess } from '@/lib/studio/modules';
import { checkVersion, currentVersion, editoriaNome, getCmsService } from '@/lib/studio/cms/articles';
import { CMS_READ, CMS_REVIEW } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../../_lib/guard';
import { approveAction, blockAction } from '../actions';

export const metadata: Metadata = { title: 'Fila de checagem' };
export const dynamic = 'force-dynamic';

export default async function Checagem() {
  const { session } = await requireStudio(CMS_READ);
  const fila = getCmsService().list().filter((a) => a.status === 'em_checagem');
  const podeRevisar = checkAccess(session, CMS_REVIEW).ok;
  return (
    <>
      <p>
        <Link href="/studio/cms">← CMS editorial</Link>
      </p>
      <h1>Fila de checagem</h1>
      <p className="st-hint">Aprovação vale para a versão exibida e exige identidade diferente da autora da versão.</p>
      {fila.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhuma matéria aguardando checagem</h2>
          <p>Matérias enviadas para checagem aparecem aqui.</p>
        </section>
      ) : (
        <div className="st-grid" style={{ gridTemplateColumns: '1fr' }}>
          {fila.map((a) => {
            const v = currentVersion(a);
            const issues = checkVersion(v);
            const proprio = v.autor === session.userId;
            return (
              <article className="st-card" key={a.id} aria-label={v.titulo}>
                <h2 style={{ marginTop: 0 }}>
                  <Link href={`/studio/cms/${a.id}`}>{v.titulo}</Link>
                </h2>
                <p className="st-hint">
                  {editoriaNome(v.editoria)} · v{v.numero} · autor {v.autor} · {v.fontes.length} fonte(s)
                </p>
                <ul className="st-issues">
                  {issues.length === 0 ? <li>Sem pendências.</li> : issues.map((i, n) => <li key={n} className={i.severidade}>{i.mensagem}</li>)}
                </ul>
                {podeRevisar ? (
                  <div className="st-actions" style={{ marginTop: 10, alignItems: 'end' }}>
                    <form action={approveAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="versao" value={v.numero} />
                      <button className="st-btn" type="submit" disabled={proprio} title={proprio ? 'O autor não pode aprovar a própria versão' : undefined}>
                        Aprovar v{v.numero}
                      </button>
                    </form>
                    <form action={blockAction} className="st-actions" style={{ alignItems: 'end' }}>
                      <input type="hidden" name="id" value={a.id} />
                      <div className="st-field" style={{ marginBottom: 0 }}>
                        <label htmlFor={`motivo-${a.id}`}>Motivo do bloqueio</label>
                        <input id={`motivo-${a.id}`} name="motivo" type="text" />
                      </div>
                      <button className="st-btn danger" type="submit">
                        Bloquear
                      </button>
                    </form>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
