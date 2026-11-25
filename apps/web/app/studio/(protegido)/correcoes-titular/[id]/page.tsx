import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { findModule } from '@/lib/studio/modules';
import { ROTULO_ACAO, ROTULO_ALVO, ROTULO_ESTADO, ROTULO_PEDIDO, ROTULO_PRAZO, aberto, linkDoAlvo, protocoloDoPedido, rotuloAcaoAuditoria, situacaoDoPrazo } from '@/lib/studio/titular-view';
import { requireModule } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { SemBanco } from '../../../_components/SemBanco';
import { atribuirAMimAction, decidirAction } from '../actions';
import { Seta } from '../../../_components/Seta';

export const metadata: Metadata = { title: 'Pedido do titular' };
export const dynamic = 'force-dynamic';

const quando = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export default async function PedidoTitularPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('correcoes-titular')!);
  const { id } = await params;
  const b = await searchParams;
  const r = await api.titular.obter(id);
  if (r.status === 404) notFound();
  const voltar = (
    <p>
      <Link href="/studio/correcoes-titular"><Seta direcao="esquerda" /> Voltar à fila</Link>
    </p>
  );
  if (naoConfigurado(r)) return (<><h1>Pedido do titular</h1>{voltar}<SemBanco modulo="A fila de pedidos do titular" /></>);
  if (ehErro(r)) {
    return (
      <>
        <h1>Pedido do titular</h1>
        {voltar}
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      </>
    );
  }
  const p = r.body;
  const sit = situacaoDoPrazo(p, new Date());
  const alvoHref = linkDoAlvo(p.alvo);
  const podeDecidir = aberto(p.estado);
  return (
    <>
      <h1>
        Pedido de {ROTULO_PEDIDO[p.pedido].toLowerCase()} do titular
      </h1>
      {voltar}
      <Flash tipo={b.tipo} aviso={b.aviso} />
      <section className="st-card" aria-labelledby="dados" data-estado={p.estado}>
        <h2 id="dados" style={{ marginTop: 0 }}>
          {ROTULO_ESTADO[p.estado]}
        </h2>
        <dl>
          <dt>Protocolo</dt>
          <dd>
            <code data-protocolo>{protocoloDoPedido(p.id)}</code> <span className="st-hint">(o número que o titular recebeu; não é credencial de acesso)</span>
          </dd>
          <dt>Prazo interno</dt>
          <dd data-prazo={sit}>
            {p.prazo_em.slice(0, 10)} · {ROTULO_PRAZO[sit]} <span className="st-hint">(15 dias corridos; não é prazo legal)</span>
          </dd>
          <dt>Recebido em</dt>
          <dd>{quando(p.recebido_em)} UTC</dd>
          <dt>Responsável</dt>
          <dd data-responsavel>{p.responsavel ? (p.responsavel === session.userId ? 'você' : p.responsavel) : 'sem responsável'}</dd>
          <dt>Alvo</dt>
          <dd>
            {p.alvo ? (
              <>
                {ROTULO_ALVO[p.alvo.tipo]} <code>{p.alvo.id}</code>
                {alvoHref ? (
                  <>
                    {' '}
                    · <Link href={alvoHref}>conferir no Entity Intelligence</Link>
                  </>
                ) : null}
              </>
            ) : (
              'não identificado na URL do pedido'
            )}
          </dd>
          <dt>Página citada</dt>
          <dd>
            <a href={p.url} rel="noreferrer noopener">
              {p.url}
            </a>
          </dd>
        </dl>
      </section>

      <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="titular">
        <h2 id="titular" style={{ marginTop: 0 }}>
          Titular e pedido
        </h2>
        <p className="st-hint" role="note">
          Dado pessoal: use só para responder a este pedido. Esta consulta foi registrada na trilha de auditoria.
        </p>
        <dl>
          <dt>Nome</dt>
          <dd data-titular-nome>{p.nome}</dd>
          <dt>Contato</dt>
          <dd>{p.contato}</dd>
        </dl>
        <blockquote style={{ whiteSpace: 'pre-wrap', margin: 0 }} data-texto>
          {p.texto}
        </blockquote>
      </section>

      {p.decidido_em ? (
        <div className="st-alert" role="note" data-decisao={p.estado} style={{ marginTop: 14 }}>
          Decisão registrada{p.decidido_por ? ` por ${p.decidido_por === session.userId ? 'você' : p.decidido_por}` : ''} em {quando(p.decidido_em)} UTC.
          {p.estado === 'negado' ? (
            ' O pedido foi negado: nada muda na exibição pública.'
          ) : p.efeitoPublico === 'aplicado' ? (
            <span data-efeito="aplicado">
              {' '}
              <strong>Efeito na exibição pública: aplicado.</strong> O portal já reflete esta decisão.
            </span>
          ) : p.efeitoPublico === 'pendente' ? (
            <span data-efeito="pendente">
              {' '}
              <strong>Efeito na exibição pública: pendente.</strong> O portal ainda não aplica esta decisão automaticamente.
            </span>
          ) : null}
        </div>
      ) : null}

      {podeDecidir ? (
        <>
          {p.responsavel !== session.userId ? (
            <form action={atribuirAMimAction} style={{ marginTop: 14 }}>
              <input type="hidden" name="id" value={p.id} />
              <button className="st-btn sec" type="submit">
                Atribuir a mim
              </button>
            </form>
          ) : null}
          <section aria-labelledby="decidir" style={{ marginTop: 18 }}>
            <h2 id="decidir">Decidir</h2>
            <p className="st-hint">A decisão é definitiva e auditada. Nenhuma ação apaga evidência; o efeito no portal ainda é aplicado à parte.</p>
            <form action={decidirAction} className="st-card" aria-label="Corrigir">
              <h3 style={{ marginTop: 0 }}>{ROTULO_ACAO.corrigir}</h3>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="acao" value="corrigir" />
              {[0, 1, 2].map((i) => (
                <div className="st-row" key={i}>
                  <div className="st-field">
                    <label htmlFor={`campo${i}`}>Campo {i + 1}</label>
                    <input id={`campo${i}`} name={`campo${i}`} type="text" maxLength={60} placeholder={i === 0 ? 'ex.: nome, cargo, período' : undefined} />
                  </div>
                  <div className="st-field">
                    <label htmlFor={`valor${i}`}>Valor corrigido {i + 1}</label>
                    <input id={`valor${i}`} name={`valor${i}`} type="text" maxLength={2000} />
                  </div>
                </div>
              ))}
              <div className="st-field">
                <label htmlFor="motivo-corrigir">Motivo (opcional)</label>
                <input id="motivo-corrigir" name="motivo" type="text" maxLength={2000} />
              </div>
              <button className="st-btn" type="submit">
                Registrar correção
              </button>
            </form>
            {(['remover_cargo', 'remover_pessoa'] as const).map((acao) => (
              <form action={decidirAction} className="st-card" style={{ marginTop: 12 }} aria-label={ROTULO_ACAO[acao]} key={acao}>
                <h3 style={{ marginTop: 0 }}>{ROTULO_ACAO[acao]}</h3>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="acao" value={acao} />
                <div className="st-field">
                  <label htmlFor={`motivo-${acao}`}>Motivo (opcional)</label>
                  <input id={`motivo-${acao}`} name="motivo" type="text" maxLength={2000} />
                </div>
                <div className="st-field">
                  <label>
                    <input type="checkbox" name="confirmo" value="sim" /> Confirmo a decisão de {acao === 'remover_cargo' ? 'remover o cargo' : 'remover a pessoa'} da exibição
                  </label>
                </div>
                <button className="st-btn danger" type="submit">
                  Registrar remoção
                </button>
              </form>
            ))}
            <form action={decidirAction} className="st-card" style={{ marginTop: 12 }} aria-label="Negar">
              <h3 style={{ marginTop: 0 }}>{ROTULO_ACAO.negar}</h3>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="acao" value="negar" />
              <div className="st-field">
                <label htmlFor="motivo-negar">Motivo (obrigatório)</label>
                <textarea id="motivo-negar" name="motivo" minLength={5} maxLength={2000} required rows={3} />
              </div>
              <button className="st-btn danger" type="submit">
                Negar pedido
              </button>
            </form>
          </section>
        </>
      ) : null}

      <section aria-labelledby="trilha" style={{ marginTop: 24 }}>
        <h2 id="trilha">Trilha de auditoria</h2>
        {p.auditoria.length === 0 ? (
          <p className="st-hint" data-vazio="auditoria">
            Sem eventos registrados.
          </p>
        ) : (
          <ol aria-label="Eventos do pedido" data-auditoria>
            {p.auditoria.map((e, i) => (
              <li key={`${e.em}-${i}`}>
                {quando(e.em)} UTC · {e.ator === session.userId ? 'você' : e.ator} · {rotuloAcaoAuditoria(e.acao)}
                {e.motivo ? ` · motivo: ${e.motivo}` : ''}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
