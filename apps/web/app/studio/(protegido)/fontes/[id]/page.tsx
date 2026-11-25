import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { ESCRITA_EDITORIAL } from '@/lib/studio/papeis';
import { requireModule } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { QuadroRolavel } from '../../../_components/QuadroRolavel';
import { SemBanco } from '../../../_components/SemBanco';
import { capturarEvidenciaAction } from '../actions';
import { Seta } from '../../../_components/Seta';

export const metadata: Metadata = { title: 'Fonte' };
export const dynamic = 'force-dynamic';

export default async function FontePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('fontes')!);
  const id = decodeURIComponent((await params).id);
  const { tipo, aviso } = await searchParams;
  const lista = await api.fontes.listar();
  if (naoConfigurado(lista)) return <SemBanco modulo="O banco de fontes" />;
  if (ehErro(lista)) throw new Error(mensagemErro(lista));
  const fonte = lista.body.data.find((f) => f.id === id);
  if (!fonte) notFound();
  const ev = await api.fontes.evidencias(id);
  const evidencias = ehErro(ev) ? [] : ev.body.data;
  const podeEscrever = checkAccess(session, ESCRITA_EDITORIAL).ok;
  return (
    <>
      <p>
        <Link href="/studio/fontes"><Seta direcao="esquerda" /> Banco de fontes</Link>
      </p>
      <h1>{fonte.nome}</h1>
      <p className="st-hint">
        {fonte.tipo} · {fonte.ativo ? 'ativa' : 'inativa'} · termos {fonte.termosRevisados ? 'revisados' : 'pendentes'} ·{' '}
        <a href={fonte.url} rel="noreferrer noopener">
          {fonte.url}
        </a>
      </p>
      <Flash tipo={tipo} aviso={aviso} />
      <h2>Evidências ({evidencias.length})</h2>
      {evidencias.length === 0 ? (
        <p className="st-hint" data-vazio="evidencias">
          Nenhuma evidência capturada.
        </p>
      ) : (
        <QuadroRolavel rotulo="Evidências da fonte">
<table className="st-table">
          <thead>
            <tr>
              <th scope="col">URL</th>
              <th scope="col">Capturada em</th>
              <th scope="col">SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {evidencias.map((e) => (
              <tr key={e.id}>
                <th scope="row">{e.url}</th>
                <td>{e.capturadoEm}</td>
                <td>
                  <code>{e.sha256.slice(0, 16)}…</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</QuadroRolavel>
      )}
      {podeEscrever ? (
        fonte.ativo ? (
          <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="cap">
            <h2 id="cap" style={{ marginTop: 0 }}>
              Registrar evidência (captura manual)
            </h2>
            <p className="st-hint">O hash SHA-256 é calculado no servidor a partir do texto capturado que você informa; não é digitado.</p>
            <form action={capturarEvidenciaAction}>
              <input type="hidden" name="id" value={fonte.id} />
              <div className="st-field">
                <label htmlFor="url">URL da página</label>
                <input id="url" name="url" type="url" />
              </div>
              <div className="st-field">
                <label htmlFor="texto-capturado">Texto capturado</label>
                <textarea id="texto-capturado" name="conteudo" style={{ minHeight: 100 }} />
              </div>
              <button className="st-btn" type="submit">
                Registrar evidência
              </button>
            </form>
          </section>
        ) : (
          <p className="st-hint">Evidência só pode ser registrada em fonte ativa.</p>
        )
      ) : null}
    </>
  );
}
