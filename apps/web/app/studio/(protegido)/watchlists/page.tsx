import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { ROTULO_BASE, ROTULO_MOVE, antesEDepois, textoDaEvidencia, type LadoDoMove } from '@/lib/studio/intelligence-view';
import { ROTULO_ALERTA, ROTULO_ENTIDADE, ROTULO_ESTADO_MOVE, estadoDoFiltro, type AlertaLinha, type EstadoAlerta, type WatchlistLinha } from '@/lib/studio/watchlists-view';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { adicionarItemAction, apagarWatchlistAction, criarWatchlistAction, removerItemAction, revisarAlertaAction } from './actions';

export const metadata: Metadata = { title: 'Watchlists' };
export const dynamic = 'force-dynamic';

type Busca = { lista?: string; estado?: string; q?: string; tipoBusca?: string; tipo?: string; aviso?: string };
const ESTADOS: EstadoAlerta[] = ['pending_review', 'approved', 'rejected'];

const href = (p: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1]));
  const s = q.toString();
  return s ? `/studio/watchlists?${s}` : '/studio/watchlists';
};

export default async function WatchlistsPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const { session } = await requireModule(findModule('watchlists')!);
  const b = await searchParams;
  const podeEscrever = checkAccess(session, ['admin', 'editor_chefe', 'editor']).ok;
  const podeRevisar = podeEscrever; // revisão do alerta é do dono da lista (decisão do PM); só quem cria lista é dono
  const r = await api.intelligence.watchlists();
  return (
    <>
      <h1>Watchlists</h1>
      <p>
        Suas listas de empresas e executivos acompanhados. Cada watchlist é só de quem a criou. Todo alerta nasce &quot;pendente de revisão&quot; e só o dono da lista o revisa:
        nada sai sem revisão humana. Watchlists e alertas existem só no Studio, nunca no portal.
      </p>
      <Flash tipo={b.tipo} aviso={b.aviso} />
      {naoConfigurado(r) ? (
        <SemBanco modulo="As watchlists" />
      ) : ehErro(r) ? (
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      ) : (
        <Quadro listas={r.body.items} b={b} podeEscrever={podeEscrever} podeRevisar={podeRevisar} />
      )}
    </>
  );
}

function Quadro({ listas, b, podeEscrever, podeRevisar }: { listas: WatchlistLinha[]; b: Busca; podeEscrever: boolean; podeRevisar: boolean }) {
  const aberta = listas.find((l) => l.id === b.lista) ?? null;
  return (
    <>
      <h2>Minhas listas</h2>
      {listas.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhuma watchlist</h2>
          <p>{podeEscrever ? 'Crie uma lista abaixo para acompanhar empresas e executivos.' : 'Você ainda não tem listas, e seu papel não cria watchlists.'}</p>
        </section>
      ) : (
        <ul aria-label="Watchlists">
          {listas.map((l) => (
            <li key={l.id} data-lista={l.id}>
              <Link href={href({ lista: l.id })} aria-current={l.id === aberta?.id ? 'page' : undefined}>
                <strong>{l.name}</strong>
              </Link>{' '}
              · {l.items} {l.items === 1 ? 'entidade' : 'entidades'}
              {l.pending_alerts > 0 ? (
                <span className="st-badge" data-pendentes={l.pending_alerts}>
                  {' '}
                  · {l.pending_alerts} {l.pending_alerts === 1 ? 'alerta a revisar' : 'alertas a revisar'}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {b.lista && !aberta ? (
        <div className="st-alert err" role="alert" data-lista-ausente>
          Watchlist não encontrada entre as suas.
        </div>
      ) : null}
      {podeEscrever ? (
        <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="nova">
          <h2 id="nova" style={{ marginTop: 0 }}>
            Nova watchlist
          </h2>
          <form action={criarWatchlistAction} aria-label="Nova watchlist">
            <div className="st-field">
              <label htmlFor="nome">Nome</label>
              <input id="nome" name="nome" type="text" maxLength={120} required />
            </div>
            <button className="st-btn" type="submit">
              Criar watchlist
            </button>
          </form>
        </section>
      ) : (
        <p className="st-hint">Seu papel só lê as watchlists.</p>
      )}
      {aberta ? <ListaAberta lista={aberta} b={b} podeEscrever={podeEscrever} podeRevisar={podeRevisar} /> : null}
    </>
  );
}

async function ListaAberta({ lista, b, podeEscrever, podeRevisar }: { lista: WatchlistLinha; b: Busca; podeEscrever: boolean; podeRevisar: boolean }) {
  const r = await api.intelligence.watchlist(lista.id);
  if (ehErro(r)) {
    return (
      <div className="st-alert err" role="alert" style={{ marginTop: 14 }}>
        {mensagemErro(r)}
      </div>
    );
  }
  const itens = r.body.items;
  return (
    <section aria-labelledby="aberta" style={{ marginTop: 24 }} data-aberta={lista.id}>
      <h2 id="aberta">{lista.name}</h2>
      <h3>Acompanhadas</h3>
      {itens.length === 0 ? (
        <p className="st-hint" data-vazio="itens">
          Nenhuma empresa ou executivo nesta lista ainda.
        </p>
      ) : (
        <ul aria-label={`Entidades de ${lista.name}`}>
          {itens.map((i) => (
            <li key={`${i.entity_type}:${i.entity_id}`} data-item={i.entity_id}>
              <span className="st-hint">{ROTULO_ENTIDADE[i.entity_type]}:</span> {i.name}{' '}
              {podeEscrever ? (
                <form action={removerItemAction} style={{ display: 'inline' }}>
                  <input type="hidden" name="lista" value={lista.id} />
                  <input type="hidden" name="tipoEntidade" value={i.entity_type} />
                  <input type="hidden" name="entidade" value={i.entity_id} />
                  <button className="st-btn sec" type="submit" aria-label={`Remover ${i.name}`}>
                    Remover
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {podeEscrever ? <Adicionar lista={lista} b={b} jaNaLista={new Set(itens.map((i) => i.entity_id))} /> : null}
      <Alertas lista={lista} estado={estadoDoFiltro(b.estado)} podeRevisar={podeRevisar} />
      {podeEscrever ? (
        <section className="st-card" style={{ marginTop: 24 }} aria-labelledby="apagar">
          <h3 id="apagar" style={{ marginTop: 0 }}>
            Apagar watchlist
          </h3>
          <p className="st-hint">Apaga a lista, os itens e os alertas dela. Os Moves continuam no Intelligence.</p>
          <form action={apagarWatchlistAction} aria-label="Apagar watchlist">
            <input type="hidden" name="lista" value={lista.id} />
            <div className="st-field">
              <label>
                <input type="checkbox" name="confirmo" value="sim" /> Confirmo que quero apagar &quot;{lista.name}&quot;
              </label>
            </div>
            <button className="st-btn danger" type="submit">
              Apagar watchlist
            </button>
          </form>
        </section>
      ) : null}
    </section>
  );
}

/** Busca por nome (rotas companies/executives) e adiciona; nunca pede UUID ao usuário. */
async function Adicionar({ lista, b, jaNaLista }: { lista: WatchlistLinha; b: Busca; jaNaLista: Set<string> }) {
  const tipo = b.tipoBusca === 'person' ? 'person' : 'organization';
  const q = (b.q ?? '').trim();
  let resultado: { id: string; nome: string }[] | null = null;
  let erro: string | null = null;
  if (q) {
    if (tipo === 'organization') {
      const r = await api.intelligence.empresas(q);
      if (ehErro(r)) erro = mensagemErro(r);
      else resultado = r.body.items.map((o) => ({ id: o.id, nome: o.trade_name ?? o.legal_name }));
    } else {
      const r = await api.intelligence.executivos(q);
      if (ehErro(r)) erro = mensagemErro(r);
      else resultado = r.body.items.map((p) => ({ id: p.id, nome: p.full_name }));
    }
  }
  return (
    <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="adicionar">
      <h3 id="adicionar" style={{ marginTop: 0 }}>
        Adicionar empresa ou executivo
      </h3>
      <form method="get" action="/studio/watchlists" role="search" aria-label="Buscar entidade">
        <input type="hidden" name="lista" value={lista.id} />
        <div className="st-row">
          <div className="st-field">
            <label htmlFor="tipoBusca">Tipo</label>
            <select id="tipoBusca" name="tipoBusca" defaultValue={tipo}>
              <option value="organization">Empresa</option>
              <option value="person">Executivo</option>
            </select>
          </div>
          <div className="st-field">
            <label htmlFor="q">Nome</label>
            <input id="q" name="q" type="search" defaultValue={q} />
          </div>
        </div>
        <button className="st-btn sec" type="submit">
          Buscar
        </button>
      </form>
      {erro ? (
        <div className="st-alert err" role="alert">
          {erro}
        </div>
      ) : resultado === null ? null : resultado.length === 0 ? (
        <p className="st-hint" data-vazio="busca">
          Nada encontrado para &quot;{q}&quot;.
        </p>
      ) : (
        <ul aria-label="Resultados da busca">
          {resultado.map((e) => (
            <li key={e.id} data-resultado={e.id}>
              {e.nome}{' '}
              {jaNaLista.has(e.id) ? (
                <span className="st-hint">(já na lista)</span>
              ) : (
                <form action={adicionarItemAction} style={{ display: 'inline' }}>
                  <input type="hidden" name="lista" value={lista.id} />
                  <input type="hidden" name="tipoEntidade" value={tipo} />
                  <input type="hidden" name="entidade" value={e.id} />
                  <button className="st-btn" type="submit" aria-label={`Adicionar ${e.nome}`}>
                    Adicionar
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Lado({ lado }: { lado: LadoDoMove }) {
  return (
    <div data-lado={lado.rotulo.toLowerCase()}>
      <strong>{lado.rotulo}</strong>
      {lado.cargo ? (
        <>
          <div>
            {lado.cargo.titulo} · {lado.cargo.organizacao}
          </div>
          {lado.evidencia ? (
            <div className="st-hint">
              Fonte:{' '}
              <a href={lado.evidencia.source_url} rel="noreferrer noopener">
                {textoDaEvidencia(lado.evidencia)}
              </a>
              {lado.validadoEm ? ` · validado em ${lado.validadoEm.slice(0, 10)}` : ''}
            </div>
          ) : (
            <div className="st-hint">Sem leitura com fonte para este lado.</div>
          )}
        </>
      ) : (
        <div className="st-hint">{lado.rotulo === 'Antes' ? 'Não havia cargo anterior registrado.' : 'Sem cargo depois (saída).'}</div>
      )}
    </div>
  );
}

async function Alertas({ lista, estado, podeRevisar }: { lista: WatchlistLinha; estado: EstadoAlerta; podeRevisar: boolean }) {
  const r = await api.intelligence.alertas({ watchlistId: lista.id, status: estado });
  return (
    <section aria-labelledby="alertas" style={{ marginTop: 24 }}>
      <h3 id="alertas">Alertas de Move</h3>
      <nav aria-label="Estado dos alertas" className="st-actions">
        {ESTADOS.map((s) => (
          <Link key={s} href={href({ lista: lista.id, estado: s === 'pending_review' ? undefined : s })} aria-current={s === estado ? 'page' : undefined} className="st-btn sec">
            {ROTULO_ALERTA[s]}
          </Link>
        ))}
      </nav>
      {ehErro(r) ? (
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      ) : r.body.items.length === 0 ? (
        <p className="st-hint" data-vazio="alertas">
          Nenhum alerta {ROTULO_ALERTA[estado].toLowerCase()} nesta lista.
        </p>
      ) : (
        <ul className="st-issues" aria-label="Alertas">
          {r.body.items.map((a) => (
            <Alerta key={a.id} a={a} lista={lista.id} podeRevisar={podeRevisar} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Alerta({ a, lista, podeRevisar }: { a: AlertaLinha; lista: string; podeRevisar: boolean }) {
  const lados = a.move ? antesEDepois(a.move) : null;
  return (
    <li data-alerta={a.id} data-estado={a.status}>
      <p style={{ margin: '4px 0' }}>
        <strong>{a.person_name}</strong> — {ROTULO_MOVE[a.kind]} <span className="st-hint">({ROTULO_BASE[a.basis]})</span>
      </p>
      <p className="st-hint" style={{ margin: 0 }}>
        Alerta: <span data-estado-alerta>{ROTULO_ALERTA[a.status]}</span>
        {a.reviewed_by ? ` por ${a.reviewed_by}` : ''} · <span data-estado-move>{a.move ? ROTULO_ESTADO_MOVE[a.move.status] : 'Move indisponível'}</span> · lido em {a.observed_on}
      </p>
      {lados ? (
        <div className="st-row" style={{ marginTop: 8 }}>
          <Lado lado={lados[0]} />
          <Lado lado={lados[1]} />
        </div>
      ) : (
        <p className="st-hint" data-move="indisponivel">
          Move indisponível: a pessoa foi removida da exibição ou o Move saiu da consulta.
        </p>
      )}
      {podeRevisar && a.status === 'pending_review' ? (
        <div className="st-actions" style={{ marginTop: 8 }}>
          {(['approved', 'rejected'] as const).map((s) => (
            <form action={revisarAlertaAction} key={s}>
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="status" value={s} />
              <input type="hidden" name="lista" value={lista} />
              <button className={s === 'rejected' ? 'st-btn danger' : 'st-btn'} type="submit" aria-label={`${s === 'approved' ? 'Aprovar' : 'Rejeitar'} alerta de ${a.person_name}`}>
                {s === 'approved' ? 'Aprovar' : 'Rejeitar'}
              </button>
            </form>
          ))}
        </div>
      ) : null}
    </li>
  );
}
