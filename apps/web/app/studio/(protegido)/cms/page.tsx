import type { Metadata } from 'next';
import Link from 'next/link';
import { EDITORIAS } from '@ln/contracts';
import { checkAccess } from '@/lib/studio/modules';
import { currentVersion, editoriaNome, getCmsService, STATUS_LABEL } from '@/lib/studio/cms/articles';
import { CMS_EDIT, CMS_READ, CMS_REVIEW } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../_lib/guard';

export const metadata: Metadata = { title: 'CMS editorial' };
export const dynamic = 'force-dynamic';

const STATUSES = ['rascunho', 'em_checagem', 'bloqueado', 'aprovado'] as const;

export default async function CmsList({ searchParams }: { searchParams: Promise<{ status?: string; editoria?: string; q?: string }> }) {
  const { session } = await requireStudio(CMS_READ);
  const { status = '', editoria = '', q = '' } = await searchParams;
  const todas = getCmsService().list();
  const termo = q.trim().toLowerCase();
  const lista = todas.filter((a) => {
    const v = currentVersion(a);
    return (!status || a.status === status) && (!editoria || v.editoria === editoria) && (!termo || v.titulo.toLowerCase().includes(termo));
  });
  const podeEditar = checkAccess(session, CMS_EDIT).ok;
  const podeRevisar = checkAccess(session, CMS_REVIEW).ok;
  const naChecagem = todas.filter((a) => a.status === 'em_checagem').length;
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
            Fila de checagem ({naChecagem})
          </Link>
        ) : null}
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

      {lista.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">{todas.length === 0 ? 'Nenhuma matéria ainda' : 'Nenhuma matéria com esses filtros'}</h2>
          <p>
            {todas.length === 0
              ? 'A fila editorial está vazia. As matérias chegam pela Fábrica editorial ou são criadas aqui. Nada foi simulado.'
              : 'Ajuste os filtros para ver outras matérias.'}
          </p>
          {todas.length === 0 && podeEditar ? (
            <Link className="st-btn" href="/studio/cms/nova">
              Criar a primeira matéria
            </Link>
          ) : null}
        </section>
      ) : (
        <table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left', padding: '4px 0' }}>
            {lista.length} matéria(s)
          </caption>
          <thead>
            <tr>
              <th scope="col">Título</th>
              <th scope="col">Editoria</th>
              <th scope="col">Estado</th>
              <th scope="col">Versão</th>
              <th scope="col">Atualizada</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((a) => {
              const v = currentVersion(a);
              return (
                <tr key={a.id}>
                  <th scope="row">
                    <Link href={`/studio/cms/${a.id}`}>{v.titulo}</Link>
                  </th>
                  <td>{editoriaNome(v.editoria)}</td>
                  <td>
                    <span className={`st-badge ${a.status}`}>{STATUS_LABEL[a.status]}</span>
                  </td>
                  <td>v{v.numero}</td>
                  <td>{a.atualizadaEm.slice(0, 16).replace('T', ' ')} UTC</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="st-hint">Publicação no portal não está disponível aqui: depende do backend (R3-07) e dos gates. Armazenamento temporário.</p>
    </>
  );
}
