import type { Metadata } from 'next';
import { EmptyState } from '@ln/ui';
import { Recarregar } from '../../../_components/Recarregar';
import Link from 'next/link';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { CMS_READ } from '@/lib/studio/cms/roles';
import { checkAccess } from '@/lib/studio/modules';
import { requireStudio } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { QuadroRolavel } from '../../../_components/QuadroRolavel';
import { abrirCasoAction } from './actions';
import { SemBanco } from '../../../_components/SemBanco';
import { Seta } from '../../../_components/Seta';

export const metadata: Metadata = { title: 'Correções e direito de resposta' };
export const dynamic = 'force-dynamic';

interface Caso {
  id: string;
  articleId: string;
  kind: string;
  state: string;
  legal: boolean;
  receivedAt: string;
  deadlineAt: string | null;
  requester: { name: string; identityVerified: boolean };
}

export default async function CorrecoesPage({ searchParams }: { searchParams: Promise<{ kind?: string; state?: string; tipo?: string; aviso?: string }> }) {
  const { session } = await requireStudio(CMS_READ);
  const { kind = '', state = '', tipo, aviso } = await searchParams;
  const podeGerir = checkAccess(session, ['admin', 'editor_chefe']).ok;
  const r = await api.editorial.correcoes({ kind, state });
  if (naoConfigurado(r)) {
    return (
      <>
        <h1>Correções e direito de resposta</h1>
        <SemBanco modulo="O módulo de correções" />
      </>
    );
  }
  const casos = ehErro(r) ? [] : ((r.body as { items: Caso[] }).items ?? []);
  return (
    <>
      <p>
        <Link href="/studio/cms"><Seta direcao="esquerda" /> CMS editorial</Link>
      </p>
      <h1>Correções e direito de resposta</h1>
      <p>Casos de erratas e direito de resposta. O formulário público do Portal registra pedidos (identidade sempre não verificada, contato nunca devolvido por API). Aqui a redação acompanha prazos, evidências e publicação do aviso.</p>
      <Flash tipo={tipo} aviso={aviso} />
      <form className="st-filters" method="get" role="search" aria-label="Filtrar casos">
        <div className="st-field">
          <label htmlFor="kind">Tipo</label>
          <select id="kind" name="kind" defaultValue={kind}>
            <option value="">Todos</option>
            <option value="erratum">Errata</option>
            <option value="right_of_reply">Direito de resposta</option>
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>
      {ehErro(r) ? (
        <EmptyState kind="error" title="Não foi possível carregar" description={mensagemErro(r)} action={<Recarregar />} />
      ) : casos.length === 0 ? (
        <EmptyState title="Nenhum caso registrado" description="Nenhuma errata ou pedido de direito de resposta até agora." />
      ) : (
        <QuadroRolavel rotulo="Correções e direito de resposta">
<table className="st-table">
          <thead>
            <tr>
              <th scope="col">Caso</th>
              <th scope="col">Tipo</th>
              <th scope="col">Estado</th>
              <th scope="col">Prazo</th>
              <th scope="col">Solicitante</th>
            </tr>
          </thead>
          <tbody>
            {casos.map((c) => (
              <tr key={c.id}>
                <th scope="row" className="st-col-titulo">
                  <Link href={`/studio/cms/correcoes/${encodeURIComponent(c.id)}`}>{c.id}</Link>
                  <br />
                  <span className="st-hint">matéria {c.articleId}</span>
                </th>
                <td>{c.kind}</td>
                <td>{c.state}</td>
                <td>{c.deadlineAt ? c.deadlineAt.slice(0, 10) : '—'}</td>
                <td>
                  {c.requester.name} {c.requester.identityVerified ? '(identidade verificada)' : '(não verificada)'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</QuadroRolavel>
      )}
      {podeGerir ? (
        <section className="st-card" style={{ marginTop: 18 }} aria-labelledby="abrir">
          <h2 id="abrir" style={{ marginTop: 0 }}>
            Abrir caso
          </h2>
          <p className="st-hint">Errata interna ou direito de resposta registrado pela redação. O prazo legal é informado por quem abre (parecer jurídico pendente). A identidade do solicitante nasce não verificada.</p>
          <form action={abrirCasoAction}>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="articleId">ID da matéria (Fábrica editorial)</label>
                <input id="articleId" name="articleId" type="text" />
              </div>
              <div className="st-field">
                <label htmlFor="kind-novo">Tipo</label>
                <select id="kind-novo" name="kind" defaultValue="right_of_reply">
                  <option value="right_of_reply">Direito de resposta</option>
                  <option value="erratum">Errata</option>
                </select>
              </div>
            </div>
            <div className="st-field">
              <label htmlFor="contestado">Trecho ou afirmação contestada</label>
              <input id="contestado" name="contestado" type="text" />
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="solicitante">Solicitante</label>
                <input id="solicitante" name="solicitante" type="text" />
              </div>
              <div className="st-field">
                <label htmlFor="canal">Canal</label>
                <select id="canal" name="canal" defaultValue="internal">
                  <option value="internal">Interno</option>
                  <option value="email">E-mail</option>
                  <option value="form">Formulário</option>
                  <option value="phone">Telefone</option>
                  <option value="letter">Carta</option>
                </select>
              </div>
            </div>
            <div className="st-field">
              <label htmlFor="resposta">Texto da resposta do solicitante (direito de resposta)</label>
              <textarea id="resposta" name="resposta" style={{ minHeight: 80 }} />
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="contato">Contato (dado pessoal; nunca exibido)</label>
                <input id="contato" name="contato" type="text" />
              </div>
              <div className="st-field">
                <label htmlFor="prazo">Prazo (AAAA-MM-DD, opcional)</label>
                <input id="prazo" name="prazo" type="text" />
              </div>
            </div>
            <button className="st-btn" type="submit">
              Abrir caso
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
