import type { Metadata } from 'next';
import { EDITORIAS } from '@ln/contracts';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { getFontes } from '@/lib/studio/fontes';
import { ESCRITA_EDITORIAL } from '@/lib/studio/papeis';
import { requireModule } from '../../_lib/guard';
import { Flash, SemBackend } from '../../_components/Flash';
import { alternarFonteAction, criarFonteAction, revisarTermosAction } from './actions';

export const metadata: Metadata = { title: 'Banco de fontes' };
export const dynamic = 'force-dynamic';

export default async function FontesPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('fontes')!);
  const { tipo, aviso } = await searchParams;
  const fontes = getFontes().list();
  const podeEscrever = checkAccess(session, ESCRITA_EDITORIAL).ok;
  return (
    <>
      <h1>Banco de fontes</h1>
      <p>Só fontes de acesso público: nada de contornar login ou paywall. A fonte só fica ativa depois que os termos de uso são revisados.</p>
      <Flash tipo={tipo} aviso={aviso} />

      {fontes.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhuma fonte cadastrada</h2>
          <p>O banco de fontes está vazio. Cadastre as fontes oficiais abaixo; conectores e coleta dependem da Fábrica editorial (flag editorialCollector desligada).</p>
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
              <tr key={f.id}>
                <th scope="row">
                  {f.nome}
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
                        <form action={revisarTermosAction}>
                          <input type="hidden" name="id" value={f.id} />
                          <button className="st-btn sec" type="submit" aria-label={`Marcar termos revisados: ${f.nome}`}>
                            Marcar termos revisados
                          </button>
                        </form>
                      ) : null}
                      <form action={alternarFonteAction}>
                        <input type="hidden" name="id" value={f.id} />
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
                <input type="checkbox" name="termos" /> Termos de uso revisados
              </label>
              <label>
                <input type="checkbox" name="ativo" /> Ativa (exige termos revisados)
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
      <SemBackend>Teste de fetch e cooldown dependem do coletor.</SemBackend>
    </>
  );
}
