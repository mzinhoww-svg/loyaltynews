import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { findModule } from '@/lib/studio/modules';
import { ESTADOS, ROTULO_ALVO, ROTULO_ESTADO, ROTULO_PEDIDO, ROTULO_PRAZO, estadoDoFiltro, situacaoDoPrazo } from '@/lib/studio/titular-view';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';

export const metadata: Metadata = { title: 'Pedidos do titular' };
export const dynamic = 'force-dynamic';

const data = (iso: string) => iso.slice(0, 10);

export default async function PedidosTitularPage({ searchParams }: { searchParams: Promise<{ estado?: string; meus?: string; tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('correcoes-titular')!);
  const b = await searchParams;
  const estado = estadoDoFiltro(b.estado);
  const meus = b.meus === '1';
  const r = await api.titular.listar({ estado, responsavel: meus ? session.userId : undefined });
  const agora = new Date();
  return (
    <>
      <h1>Pedidos do titular</h1>
      <p>
        Pedidos de correção ou remoção enviados pelo canal público do titular (direito de resposta, DP-38) sobre pessoas, cargos e Moves. Só editor-chefe e
        admin veem esta fila. A lista mostra só dados operacionais (prazo, alvo, estado e responsável); o texto do pedido, o nome e o contato do titular ficam no detalhe, e cada abertura do detalhe e cada decisão entram na trilha de auditoria.
      </p>
      <div className="st-alert" role="note" data-aviso="prazo-interno">
        O prazo mostrado é <strong>interno</strong> (15 dias corridos a partir do recebimento), não um prazo legal: o parecer jurídico ainda está pendente.
      </div>
      <Flash tipo={b.tipo} aviso={b.aviso} />
      <form className="st-filters" method="get" role="search" aria-label="Filtrar pedidos">
        <div className="st-field">
          <label htmlFor="estado">Estado</label>
          <select id="estado" name="estado" defaultValue={estado ?? ''}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {ROTULO_ESTADO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="st-field">
          <label>
            <input type="checkbox" name="meus" value="1" defaultChecked={meus} /> Só os atribuídos a mim
          </label>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>
      {naoConfigurado(r) ? (
        <SemBanco modulo="A fila de pedidos do titular" />
      ) : ehErro(r) ? (
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      ) : r.body.items.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhum pedido</h2>
          <p>{estado || meus ? 'Nenhum pedido com estes filtros.' : 'Nenhum pedido do titular recebido até agora.'}</p>
        </section>
      ) : (
        <table className="st-table" tabIndex={0} aria-label="Fila de pedidos do titular">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {r.body.items.length} {r.body.items.length === 1 ? 'pedido' : 'pedidos'}, do prazo mais próximo ao mais distante
          </caption>
          <thead>
            <tr>
              <th scope="col">Prazo interno</th>
              <th scope="col">Pedido</th>
              <th scope="col">Alvo</th>
              <th scope="col">Estado</th>
              <th scope="col">Responsável</th>
            </tr>
          </thead>
          <tbody>
            {r.body.items.map((p) => {
              const sit = situacaoDoPrazo(p, agora);
              return (
                <tr key={p.id} data-pedido={p.id} data-estado={p.estado} data-prazo={sit}>
                  <td>
                    {data(p.prazo_em)}
                    <div className="st-hint">{ROTULO_PRAZO[sit]}</div>
                  </td>
                  <td>
                    <Link href={`/studio/correcoes-titular/${encodeURIComponent(p.id)}`}>{ROTULO_PEDIDO[p.pedido]}</Link>
                    <div className="st-hint">recebido em {data(p.recebido_em)}</div>
                  </td>
                  <td>{p.alvo ? `${ROTULO_ALVO[p.alvo.tipo]} ${p.alvo.id}` : <span className="st-hint">não identificado na URL</span>}</td>
                  <td>{ROTULO_ESTADO[p.estado]}</td>
                  <td>{p.responsavel ? (p.responsavel === session.userId ? 'você' : p.responsavel) : <span className="st-hint">sem responsável</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
