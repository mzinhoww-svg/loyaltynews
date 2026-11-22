import type { Metadata } from 'next';
import { isEnabled } from '@ln/contracts';
import { studioAlertQueue, studioWatchlistBoard } from '@ln/intelligence';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { bancoOuNulo } from '@/lib/studio/intelligence-db';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { OrigemBanco, SemBanco } from '../../_components/SemBanco';
import { acompanharAction, criarWatchlistAction, revisarAlertaAction } from './actions';

export const metadata: Metadata = { title: 'Watchlists' };
export const dynamic = 'force-dynamic';

type Lista = { id: string; name: string; entities?: unknown[] };
type Alerta = { id: string; status: string; [k: string]: unknown };

export default async function WatchlistsPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('watchlists')!);
  const { tipo, aviso } = await searchParams;
  const banco = await bancoOuNulo();
  const podeEscrever = checkAccess(session, ['admin', 'editor_chefe', 'editor', 'revisor']).ok;
  const podeRevisar = checkAccess(session, ['admin', 'editor_chefe', 'revisor']).ok;
  return (
    <>
      <h1>Watchlists</h1>
      <p>Acompanhamento de empresas e executivos. Todo alerta nasce &quot;pendente de revisão&quot;: nada sai sem revisão humana. Alertas e watchlists são só do Studio, nunca do portal.</p>
      <div className="st-alert" role="status">
        Ingestão de pessoas (flag intelligencePessoas): <strong>{isEnabled('intelligencePessoas') ? 'ligada' : 'desligada'}</strong>.
      </div>
      <Flash tipo={tipo} aviso={aviso} />
      {!banco ? (
        <SemBanco />
      ) : (
        <>
          <OrigemBanco origem={banco.origem} />
          <Quadro db={banco.db} podeEscrever={podeEscrever} podeRevisar={podeRevisar} />
        </>
      )}
    </>
  );
}

async function Quadro({ db, podeEscrever, podeRevisar }: { db: Parameters<typeof studioWatchlistBoard>[0]; podeEscrever: boolean; podeRevisar: boolean }) {
  const listas = (await studioWatchlistBoard(db)) as unknown as Lista[];
  const alertas = await studioAlertQueue(db);
  const pendentes = alertas.pending as unknown as Alerta[];
  return (
    <>
      <h2>Listas</h2>
      {listas.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhuma watchlist</h2>
          <p>Crie uma lista para acompanhar empresas e executivos.</p>
        </section>
      ) : (
        <ul aria-label="Watchlists">
          {listas.map((l) => (
            <li key={l.id} data-lista={l.id}>
              <strong>{l.name}</strong> · {l.entities?.length ?? 0} entidade(s) <span className="st-hint">({l.id})</span>
            </li>
          ))}
        </ul>
      )}
      {podeEscrever ? (
        <>
          <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="nova">
            <h2 id="nova" style={{ marginTop: 0 }}>
              Nova watchlist
            </h2>
            <form action={criarWatchlistAction}>
              <div className="st-field">
                <label htmlFor="nome">Nome</label>
                <input id="nome" name="nome" type="text" />
              </div>
              <button className="st-btn" type="submit">
                Criar watchlist
              </button>
            </form>
          </section>
          {listas.length > 0 ? (
            <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="acomp">
              <h2 id="acomp" style={{ marginTop: 0 }}>
                Acompanhar entidade
              </h2>
              <form action={acompanharAction}>
                <div className="st-field">
                  <label htmlFor="lista">Lista</label>
                  <select id="lista" name="lista">
                    {listas.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="st-row">
                  <div className="st-field">
                    <label htmlFor="tipoEntidade">Tipo</label>
                    <select id="tipoEntidade" name="tipoEntidade">
                      <option value="organization">Empresa</option>
                      <option value="person">Executivo</option>
                    </select>
                  </div>
                  <div className="st-field">
                    <label htmlFor="entidade">ID da entidade (UUID)</label>
                    <input id="entidade" name="entidade" type="text" />
                  </div>
                </div>
                <button className="st-btn" type="submit">
                  Acompanhar
                </button>
              </form>
            </section>
          ) : null}
        </>
      ) : (
        <p className="st-hint">Seu papel só lê as watchlists.</p>
      )}

      <h2 style={{ marginTop: 24 }}>Alertas pendentes de revisão ({pendentes.length})</h2>
      {pendentes.length === 0 ? (
        <p className="st-hint" data-vazio="alertas">
          Nenhum alerta pendente.
        </p>
      ) : (
        <ul>
          {pendentes.map((a) => (
            <li key={a.id}>
              {a.id}{' '}
              {podeRevisar
                ? (['approved', 'rejected'] as const).map((s) => (
                    <form action={revisarAlertaAction} key={s} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="status" value={s} />
                      <button className="st-btn sec" type="submit" aria-label={`${s === 'approved' ? 'Aprovar' : 'Rejeitar'} alerta ${a.id}`}>
                        {s === 'approved' ? 'Aprovar' : 'Rejeitar'}
                      </button>
                    </form>
                  ))
                : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
