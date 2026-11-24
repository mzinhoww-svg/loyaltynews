import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { CMS_READ } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../../_lib/guard';
import { SemBanco } from '../../../_components/SemBanco';
import { QuadroRolavel } from '../../../_components/QuadroRolavel';
import { StatusArtigo } from '../../../_components/StatusArtigo';

export const metadata: Metadata = { title: 'Fila de checagem' };
export const dynamic = 'force-dynamic';

interface ItemFila {
  articleId: string;
  titulo: string | null;
  editoria: string;
  status: string;
  blockers: string[];
  atualizadoEm: string;
}

export default async function Checagem({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireStudio(CMS_READ);
  const { status = '' } = await searchParams;
  const [fabrica, cms] = await Promise.all([api.editorial.fila({ status }), api.materias.listar({ status: 'em_checagem' })]);
  if (naoConfigurado(fabrica)) {
    return (
      <>
        <h1>Fila de checagem</h1>
        <SemBanco modulo="A fila de checagem" />
      </>
    );
  }
  const itens = ehErro(fabrica) ? [] : ((fabrica.body as { items: ItemFila[] }).items ?? []);
  const emChecagem = ehErro(cms) ? [] : cms.body.data;
  return (
    <>
      <p>
        <Link href="/studio/cms">← CMS editorial</Link>
      </p>
      <h1>Fila de checagem</h1>
      <p className="st-hint">Duas origens: matérias do CMS aguardando recibo e aprovação, e matérias da Fábrica editorial com o gate de fatos recalculado a cada leitura.</p>

      <h2>Matérias do CMS em checagem ({emChecagem.length})</h2>
      {emChecagem.length === 0 ? (
        <p className="st-hint" data-vazio="cms-checagem">
          Nenhuma matéria do CMS aguardando checagem.
        </p>
      ) : (
        <ul aria-label="Matérias do CMS em checagem">
          {emChecagem.map((m) => (
            <li key={m.id}>
              <Link href={`/studio/cms/${m.id}`}>{m.titulo}</Link> · v{m.versao}
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 24 }}>Fábrica editorial</h2>
      <form className="st-filters" method="get" role="search" aria-label="Filtrar fila da Fábrica">
        <div className="st-field">
          <label htmlFor="status">Estado</label>
          <select id="status" name="status" defaultValue={status}>
            <option value="">Todos</option>
            <option value="rascunho">Rascunho</option>
            <option value="em_checagem">Em checagem</option>
            <option value="bloqueado">Bloqueado</option>
            <option value="aprovado">Aprovado</option>
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>
      {ehErro(fabrica) ? (
        <div className="st-alert err" role="alert">
          {mensagemErro(fabrica)}
        </div>
      ) : itens.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio-f">
          <h2 id="vazio-f">Nenhuma matéria da Fábrica na fila</h2>
          <p>A Fábrica editorial ainda não entregou rascunhos (coletor e pipeline desligados nesta fase). Nada é simulado.</p>
        </section>
      ) : (
        <QuadroRolavel rotulo="Fila de checagem">
<table className="st-table">
          <thead>
            <tr>
              <th scope="col">Matéria</th>
              <th scope="col">Editoria</th>
              <th scope="col">Estado</th>
              <th scope="col">Bloqueios</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.articleId} data-fabrica={i.articleId}>
                <th scope="row">
                  <Link href={`/studio/cms/checagem/${encodeURIComponent(i.articleId)}`}>{i.titulo ?? i.articleId}</Link>
                </th>
                <td>{i.editoria}</td>
                <td>
                  <StatusArtigo status={i.status as Parameters<typeof StatusArtigo>[0]['status']} />
                </td>
                <td>{i.blockers.length ? i.blockers.join('; ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
</QuadroRolavel>
      )}
    </>
  );
}
