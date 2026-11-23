import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { CMS_READ } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../../_lib/guard';
import { SemBanco } from '../../../_components/SemBanco';

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

export default async function CorrecoesPage({ searchParams }: { searchParams: Promise<{ kind?: string; state?: string }> }) {
  await requireStudio(CMS_READ);
  const { kind = '', state = '' } = await searchParams;
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
        <Link href="/studio/cms">← CMS editorial</Link>
      </p>
      <h1>Correções e direito de resposta</h1>
      <p>Casos de erratas e direito de resposta. O formulário público do Portal registra pedidos (identidade sempre não verificada, contato nunca devolvido por API). Aqui a redação acompanha prazos, evidências e publicação do aviso.</p>
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
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      ) : casos.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhum caso registrado</h2>
          <p>Nenhuma errata ou pedido de direito de resposta até agora.</p>
        </section>
      ) : (
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
                <th scope="row">
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
      )}
    </>
  );
}
