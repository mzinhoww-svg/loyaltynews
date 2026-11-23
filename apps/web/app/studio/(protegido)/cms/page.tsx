import type { Metadata } from 'next';
import Link from 'next/link';
import { EDITORIAS } from '@ln/contracts';
import { checkAccess } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { CMS_EDIT, CMS_READ, CMS_REVIEW } from '@/lib/studio/cms/roles';
import { STATUS_LABEL } from '@/lib/studio/cms/status';
import { requireStudio } from '../../_lib/guard';
import { SemBanco } from '../../_components/SemBanco';
import { StatusArtigo } from '../../_components/StatusArtigo';

export const metadata: Metadata = { title: 'CMS editorial' };
export const dynamic = 'force-dynamic';

const STATUSES = ['rascunho', 'em_checagem', 'bloqueado', 'aprovado', 'publicado'] as const;

export default async function CmsList({ searchParams }: { searchParams: Promise<{ status?: string; editoria?: string; q?: string }> }) {
  const { session } = await requireStudio(CMS_READ);
  const { status = '', editoria = '', q = '' } = await searchParams;
  const r = await api.materias.listar({ status, editoria, q });
  if (naoConfigurado(r)) {
    return (
      <>
        <h1>CMS editorial</h1>
        <SemBanco modulo="O CMS editorial" />
      </>
    );
  }
  const podeEditar = checkAccess(session, CMS_EDIT).ok;
  const podeRevisar = checkAccess(session, CMS_REVIEW).ok;
  const filtroInvalido = ehErro(r);
  const lista = filtroInvalido ? [] : r.body.data;
  const total = filtroInvalido ? 0 : r.body.total;
  return (
    <>
      <h1>CMS editorial</h1>
      <div className="st-actions" style={{ marginBottom: 14 }}>
        {podeEditar ? (
          <Link className="st-btn" href="/studio/cms/nova">
            Nova matéria
          </Link>
        ) : null}
        {podeRevisar || podeEditar ? (
          <Link className="st-btn sec" href="/studio/cms/checagem">
            Fila de checagem
          </Link>
        ) : null}
        <Link className="st-btn sec" href="/studio/cms/correcoes">
          Correções e direito de resposta
        </Link>
      </div>

      <form className="st-filters" method="get" role="search" aria-label="Filtrar matérias">
        <div className="st-field">
          <label htmlFor="q">Buscar no título</label>
          <input id="q" name="q" type="search" defaultValue={q} />
        </div>
        <div className="st-field">
          <label htmlFor="status">Estado</label>
          <select id="status" name="status" defaultValue={status}>
            <option value="">Todos</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="st-field">
          <label htmlFor="editoria">Editoria</label>
          <select id="editoria" name="editoria" defaultValue={editoria}>
            <option value="">Todas</option>
            {EDITORIAS.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>

      {filtroInvalido ? (
        <div className="st-alert err" role="alert">
          Filtro inválido: {mensagemErro(r)}
        </div>
      ) : lista.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">{status || editoria || q ? 'Nenhuma matéria com esses filtros' : 'Nenhuma matéria ainda'}</h2>
          <p>{status || editoria || q ? 'Ajuste os filtros para ver outras matérias.' : 'A fila editorial está vazia. As matérias chegam pela Fábrica editorial ou são criadas aqui. Nada foi simulado.'}</p>
          {!status && !editoria && !q && podeEditar ? (
            <Link className="st-btn" href="/studio/cms/nova">
              Criar a primeira matéria
            </Link>
          ) : null}
        </section>
      ) : (
        <table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left', padding: '4px 0' }}>
            {total} matéria(s)
          </caption>
          <thead>
            <tr>
              <th scope="col">Título</th>
              <th scope="col">Editoria</th>
              <th scope="col">Estado</th>
              <th scope="col">Versão</th>
              <th scope="col">Criada</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.id}>
                <th scope="row">
                  <Link href={`/studio/cms/${a.id}`}>{a.titulo}</Link>
                </th>
                <td>{EDITORIAS.find((e) => e.slug === a.editoria)?.nome ?? a.editoria}</td>
                <td>
                  <StatusArtigo status={a.status as keyof typeof STATUS_LABEL} />
                </td>
                <td>v{a.versao}</td>
                <td>{a.criadoEm.slice(0, 16).replace('T', ' ')} UTC</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="st-hint">Publicação no portal: pela rota oficial, com recibo válido da versão e a flag publicacaoPortal ligada, para quem tem permissão de publicar (editor-chefe, admin). Quem aprova e quem publica podem ser a mesma pessoa.</p>
    </>
  );
}
