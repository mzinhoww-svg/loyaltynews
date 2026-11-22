import type { Metadata } from 'next';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { getSeo, rotasCanonicas } from '@/lib/studio/seo';
import { ESCRITA_EDITORIAL } from '@/lib/studio/papeis';
import { requireModule } from '../../_lib/guard';
import { Flash, SemBackend } from '../../_components/Flash';
import { criarRedirectAction, removerRedirectAction } from './actions';

export const metadata: Metadata = { title: 'SEO' };
export const dynamic = 'force-dynamic';

export default async function SeoPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('seo')!);
  const { tipo, aviso } = await searchParams;
  const seo = getSeo();
  const lista = seo.list();
  const cadeias = seo.cadeias();
  const podeEscrever = checkAccess(session, ESCRITA_EDITORIAL).ok;
  return (
    <>
      <h1>SEO</h1>
      <p>Uma URL canônica por conteúdo, sem duplicata indexável. Redirecionamentos não podem ter ciclo nem partir de uma rota canônica ativa. Rascunho nunca entra em sitemap.</p>
      <Flash tipo={tipo} aviso={aviso} />

      <h2>Redirecionamentos</h2>
      {lista.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhum redirecionamento</h2>
          <p>Nenhum redirecionamento cadastrado.</p>
        </section>
      ) : (
        <table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {lista.length} redirecionamento(s)
          </caption>
          <thead>
            <tr>
              <th scope="col">Origem</th>
              <th scope="col">Destino</th>
              <th scope="col">Código</th>
              {podeEscrever ? <th scope="col">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {lista.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <code>{r.de}</code>
                </th>
                <td>
                  <code>{r.para}</code>
                </td>
                <td>{r.codigo}</td>
                {podeEscrever ? (
                  <td>
                    <form action={removerRedirectAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="st-btn danger" type="submit" aria-label={`Remover redirecionamento de ${r.de}`}>
                        Remover
                      </button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {cadeias.length ? (
        <div className="st-alert" role="status">
          Cadeias de redirecionamento (aponte direto para o destino final): {cadeias.join('; ')}
        </div>
      ) : null}

      {podeEscrever ? (
        <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="novo">
          <h2 id="novo" style={{ marginTop: 0 }}>
            Novo redirecionamento
          </h2>
          <form action={criarRedirectAction}>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="de">Origem (caminho)</label>
                <input id="de" name="de" type="text" placeholder="/noticia-antiga" />
              </div>
              <div className="st-field">
                <label htmlFor="para">Destino (caminho)</label>
                <input id="para" name="para" type="text" placeholder="/noticia/nova" />
              </div>
            </div>
            <div className="st-field">
              <label htmlFor="codigo">Código</label>
              <select id="codigo" name="codigo" defaultValue="301">
                <option value="301">301 permanente</option>
                <option value="302">302 temporário</option>
              </select>
            </div>
            <button className="st-btn" type="submit">
              Criar redirecionamento
            </button>
          </form>
        </section>
      ) : (
        <p className="st-hint">Seu papel só lê as configurações de SEO.</p>
      )}

      <h2 style={{ marginTop: 24 }}>Rotas canônicas (prévia do sitemap estrutural)</h2>
      <ul aria-label="Rotas canônicas">
        {rotasCanonicas().map((r) => (
          <li key={r}>
            <code>{r}</code>
          </li>
        ))}
      </ul>
      <SemBackend>Sitemap de matérias, RSS, dados estruturados e Lighthouse dependem do portal publicado.</SemBackend>
    </>
  );
}
