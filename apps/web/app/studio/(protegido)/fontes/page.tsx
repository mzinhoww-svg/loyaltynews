import type { Metadata } from 'next';
import Link from 'next/link';
import { EDITORIAS } from '@ln/contracts';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { ESCRITA_EDITORIAL } from '@/lib/studio/papeis';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { alterarFonteAction, criarFonteAction } from './actions';

export const metadata: Metadata = { title: 'Banco de fontes' };
export const dynamic = 'force-dynamic';

export default async function FontesPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('fontes')!);
  const { tipo, aviso } = await searchParams;
  const r = await api.fontes.listar();
  if (naoConfigurado(r)) {
    return (
      <>
        <h1>Banco de fontes</h1>
        <SemBanco modulo="O banco de fontes" />
      </>
    );
  }
  if (ehErro(r)) {
    return (
      <>
        <h1>Banco de fontes</h1>
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      </>
    );
  }
  const fontes = r.body.data;
  const podeEscrever = checkAccess(session, ESCRITA_EDITORIAL).ok;
  return (
    <>
      <h1>Banco de fontes</h1>
      <p>Só fontes de acesso público: nada de contornar login ou paywall. A fonte nasce inativa e só pode ser ativada depois de revisar os termos de uso. As evidências (URL, data e hash do conteúdo capturado) alimentam as matérias.</p>
      <Flash tipo={tipo} aviso={aviso} />
      <p>
        <Link href="/studio/fontes/fabrica">Fontes da Fábrica editorial (habilitação da coleta)</Link>
      </p>

      {fontes.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhuma fonte cadastrada</h2>
          <p>O banco de fontes está vazio. Cadastre as fontes oficiais abaixo; a coleta automática depende da Fábrica editorial e está desligada nesta fase.</p>
        </section>
      ) : (
        <table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {fontes.length} fonte(s)
          </caption>
          <thead>
            <tr>
              <th scope="col">Fonte</th>
              <th scope="col">Tipo</th>
              <th scope="col">Editorias</th>
              <th scope="col">Termos</th>
              <th scope="col">Estado</th>
              {podeEscrever ? <th scope="col">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {fontes.map((f) => (
              <tr key={f.id} data-fonte={f.id}>
                <th scope="row">
                  <Link href={`/studio/fontes/${encodeURIComponent(f.id)}`}>{f.nome}</Link>
                  <br />
                  <a href={f.url} rel="noreferrer noopener">
                    {f.url}
                  </a>
                </th>
                <td>{f.tipo}</td>
                <td>{f.editorias.join(', ')}</td>
                <td>{f.termosRevisados ? 'Revisados' : 'Pendentes'}</td>
                <td>
                  <span className={`st-badge ${f.ativo ? 'aprovado' : 'rascunho'}`}>{f.ativo ? 'Ativa' : 'Inativa'}</span>
                </td>
                {podeEscrever ? (
                  <td>
                    <div className="st-actions">
                      {!f.termosRevisados ? (
                        <form action={alterarFonteAction}>
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="op" value="termos" />
                          <button className="st-btn sec" type="submit" aria-label={`Marcar termos revisados: ${f.nome}`}>
                            Marcar termos revisados
                          </button>
                        </form>
                      ) : null}
                      <form action={alterarFonteAction}>
                        <input type="hidden" name="id" value={f.id} />
                        <input type="hidden" name="op" value={f.ativo ? 'desativar' : 'ativar'} />
                        <button className="st-btn sec" type="submit" aria-label={`${f.ativo ? 'Desativar' : 'Ativar'}: ${f.nome}`}>
                          {f.ativo ? 'Desativar' : 'Ativar'}
                        </button>
                      </form>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {podeEscrever ? (
        <section className="st-card" style={{ marginTop: 18 }} aria-labelledby="nova">
          <h2 id="nova" style={{ marginTop: 0 }}>
            Nova fonte
          </h2>
          <form action={criarFonteAction}>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="nome">Nome</label>
                <input id="nome" name="nome" type="text" />
              </div>
              <div className="st-field">
                <label htmlFor="url">URL pública</label>
                <input id="url" name="url" type="url" />
              </div>
            </div>
            <div className="st-field">
              <label htmlFor="tipo">Tipo</label>
              <select id="tipo" name="tipo" defaultValue="site">
                <option value="site">Site</option>
                <option value="rss">RSS</option>
                <option value="api">API</option>
                <option value="comunicado">Comunicado</option>
              </select>
            </div>
            <fieldset className="st-field">
              <legend>Editorias atendidas</legend>
              {EDITORIAS.map((e) => (
                <label key={e.slug}>
                  <input type="checkbox" name="editorias" value={e.slug} /> {e.nome}
                </label>
              ))}
            </fieldset>
            <div className="st-field">
              <label>
                <input type="checkbox" name="termos" /> Termos de uso já revisados
              </label>
            </div>
            <button className="st-btn" type="submit">
              Cadastrar fonte
            </button>
          </form>
        </section>
      ) : (
        <p className="st-hint">Seu papel só lê o banco de fontes.</p>
      )}
    </>
  );
}
