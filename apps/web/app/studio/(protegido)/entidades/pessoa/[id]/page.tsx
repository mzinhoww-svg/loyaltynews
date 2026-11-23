import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PUBLIC_NOTICE } from '@ln/intelligence';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { nivelDoCargo, textoDaEvidencia } from '@/lib/studio/intelligence-view';
import { requireModule } from '../../../../_lib/guard';
import { Flash } from '../../../../_components/Flash';
import { QuadroRolavel } from '../../../../_components/QuadroRolavel';
import { SemBanco } from '../../../../_components/SemBanco';
import { abrirPedidoAction, exportarPedidoAction, removerPessoaAction, retificarPedidoAction } from './actions';

export const metadata: Metadata = { title: 'Executivo' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PessoaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; aviso?: string; pedido?: string; kind?: string; exportado?: string }> }) {
  const { session } = await requireModule(findModule('entidades')!);
  const { id } = await params;
  const q = await searchParams;
  const ehAdmin = checkAccess(session, ['admin']).ok;
  if (!UUID.test(id)) notFound();
  const r = await api.intelligence.executivo(id, { includeInferred: true });
  if (naoConfigurado(r)) return <SemBanco />;
  if (r.status === 404) notFound();
  if (ehErro(r)) {
    return (
      <div className="st-alert err" role="alert">
        {mensagemErro(r)}
      </div>
    );
  }
  const { person, roles } = r.body;
  const pedidoId = q.pedido && UUID.test(q.pedido) ? q.pedido : '';
  const exportado = ehAdmin && q.exportado && UUID.test(q.exportado) ? await api.intelligence.exportarPedido(q.exportado) : null;
  return (
    <>
      <p>
        <Link href="/studio/entidades">← Entity intelligence</Link>
      </p>
      <h1>{person.full_name}</h1>
      <p className="st-hint">{PUBLIC_NOTICE}</p>
      <Flash tipo={q.tipo} aviso={q.aviso} />
      <p className="st-hint">
        Identificação: {person.public_profile_url ? <a href={person.public_profile_url} rel="noreferrer noopener">perfil público</a> : 'sem perfil público registrado'} · fonte:{' '}
        <a href={person.evidence.source_url} rel="noreferrer noopener">{textoDaEvidencia(person.evidence)}</a>
      </p>
      <h2>Cargos ({roles.length})</h2>
      {roles.length === 0 ? (
        <p className="st-hint" data-vazio="cargos">
          Sem cargos registrados.
        </p>
      ) : (
        <QuadroRolavel rotulo="Cargos da pessoa">
<table className="st-table" aria-label="Cargos">
          <thead>
            <tr>
              <th scope="col">Empresa</th>
              <th scope="col">Cargo</th>
              <th scope="col">Vigência</th>
              <th scope="col">Nível</th>
              <th scope="col">Fonte e data</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((c) => {
              const nivel = nivelDoCargo(c.certainty);
              return (
                <tr key={c.role_id} data-cargo={c.title} data-nivel={nivel.chave}>
                  <th scope="row">
                    <Link href={`/studio/entidades/${c.organization_id}`}>{c.organization}</Link>
                  </th>
                  <td>{c.title}</td>
                  <td>
                    {c.valid_from} → {c.valid_to ?? 'em vigor'}
                  </td>
                  <td>
                    <span className={`st-badge ${nivel.chave === 'oficial' ? 'aprovado' : 'em_checagem'}`}>{nivel.rotulo}</span>
                  </td>
                  <td>
                    <a href={c.evidence.source_url} rel="noreferrer noopener">
                      {textoDaEvidencia(c.evidence)}
                    </a>
                    <div className="st-hint">validado em {c.validated_at.slice(0, 10)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
</QuadroRolavel>
      )}

      <section className="st-card" style={{ marginTop: 24 }} aria-labelledby="titular" data-secao="pedidos-do-titular">
        <h2 id="titular" style={{ marginTop: 0 }}>
          Pedidos do titular (correção ou remoção)
        </h2>
        <p className="st-hint">
          A pessoa pede acesso, correção do nome ou remoção pelo fluxo de direito de resposta. Aqui o admin registra e conclui o pedido; cada passo fica na trilha de auditoria. Remover tira a pessoa do portal, das consultas, dos Moves e dos alertas e bloqueia a reingestão. Só cargos de fonte oficial e Moves confirmados aparecem no portal; &quot;a confirmar&quot; nunca.
        </p>
        {!ehAdmin ? (
          <p className="st-hint" data-pedidos="so-admin">
            Pedidos do titular são tratados pelo admin (dado pessoal). Se alguém pediu correção ou remoção, encaminhe ao admin com o nome da pessoa.
          </p>
        ) : (
          <>
            <form action={abrirPedidoAction} aria-label="Abrir pedido do titular">
              <input type="hidden" name="pessoa" value={id} />
              <div className="st-row">
                <div className="st-field">
                  <label htmlFor="kind">Tipo do pedido</label>
                  <select id="kind" name="kind" defaultValue="rectification">
                    <option value="access">Acesso: ver o que guardamos</option>
                    <option value="rectification">Correção do nome</option>
                    <option value="suppression">Remoção da pessoa</option>
                  </select>
                </div>
                <div className="st-field">
                  <label htmlFor="note">Nota (origem do pedido, até 500 caracteres)</label>
                  <input id="note" name="note" type="text" />
                </div>
              </div>
              <button className="st-btn" type="submit">
                Abrir pedido
              </button>
            </form>

            {pedidoId && q.kind === 'access' ? (
              <form action={exportarPedidoAction} aria-label="Concluir pedido de acesso" style={{ marginTop: 12 }} data-pedido={pedidoId}>
                <input type="hidden" name="pessoa" value={id} />
                <input type="hidden" name="pedido" value={pedidoId} />
                <button className="st-btn" type="submit">
                  Exportar os dados do titular
                </button>
              </form>
            ) : null}
            {pedidoId && q.kind === 'rectification' ? (
              <form action={retificarPedidoAction} aria-label="Concluir correção do nome" style={{ marginTop: 12 }} data-pedido={pedidoId}>
                <input type="hidden" name="pessoa" value={id} />
                <input type="hidden" name="pedido" value={pedidoId} />
                <div className="st-field">
                  <label htmlFor="fullName">Nome correto</label>
                  <input id="fullName" name="fullName" type="text" defaultValue={person.full_name} />
                </div>
                <button className="st-btn" type="submit">
                  Corrigir o nome
                </button>
              </form>
            ) : null}
            {pedidoId && q.kind === 'suppression' ? (
              <form action={removerPessoaAction} aria-label="Concluir remoção da pessoa" style={{ marginTop: 12 }} data-pedido={pedidoId}>
                <input type="hidden" name="pessoa" value={id} />
                <input type="hidden" name="pedido" value={pedidoId} />
                <div className="st-field">
                  <label>
                    <input type="checkbox" name="confirmo" /> Confirmo a remoção de {person.full_name}: some do portal, das consultas, dos Moves e dos alertas, e a reingestão fica bloqueada.
                  </label>
                </div>
                <button className="st-btn danger" type="submit">
                  Remover a pessoa
                </button>
              </form>
            ) : null}
          </>
        )}
        {exportado ? (
          ehErro(exportado) ? (
            <div className="st-alert err" role="alert">
              {mensagemErro(exportado)}
            </div>
          ) : (
            <div data-exportado="sim" style={{ marginTop: 12 }}>
              <h3>Dados do titular</h3>
              <p className="st-hint">Nome, perfil público e cargos com a evidência de cada um; nada além disso é guardado.</p>
              <pre>{JSON.stringify(exportado.body.data, null, 2)}</pre>
            </div>
          )
        ) : null}
      </section>
    </>
  );
}
