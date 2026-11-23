import type { Metadata } from 'next';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { ESCRITA_EDITORIAL, CHEFIA_EDITORIAL } from '@/lib/studio/papeis';
import { LINKS_PADRAO, SEO_PADRAO, type LinksConteudo, type SeoConteudo } from '@/lib/studio/site-docs';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { SiteDocPainel, type EstadoDoc } from '../../_components/SiteDocPainel';
import { PortalAgora } from '../../_components/PortalAgora';
import { adicionarLinkAction, alternarRedirectAction, criarRedirectAction, removerLinkAction, removerRedirectAction, salvarSeoAction } from './actions';

export const metadata: Metadata = { title: 'SEO' };
export const dynamic = 'force-dynamic';

interface Redirect {
  id: string;
  origem: string;
  destino: string;
  codigo: number;
  ativo: boolean;
}

export default async function SeoPage({ searchParams }: { searchParams: Promise<{ tipoMsg?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('seo')!);
  const q = await searchParams;
  const [rSeo, rLinks, rRedirects] = await Promise.all([api.site.documento('seo_global'), api.site.documento('links_internos'), api.site.redirects()]);
  if (naoConfigurado(rSeo) || naoConfigurado(rLinks) || naoConfigurado(rRedirects)) {
    return (
      <>
        <h1>SEO</h1>
        <SemBanco modulo="A gestão de SEO, links internos e redirecionamentos" />
      </>
    );
  }
  if (ehErro(rSeo) || ehErro(rLinks) || ehErro(rRedirects)) {
    const falha = [rSeo, rLinks, rRedirects].find(ehErro)!;
    return (
      <>
        <h1>SEO</h1>
        <div className="st-alert err" role="alert">
          {mensagemErro(falha)}
        </div>
      </>
    );
  }
  const seoEstado = (rSeo.body as { data: EstadoDoc }).data;
  const linksEstado = (rLinks.body as { data: EstadoDoc }).data;
  const redirects = (rRedirects.body as { data: Redirect[] }).data;
  const seo = (seoEstado.rascunho?.conteudo ?? seoEstado.vigente?.conteudo ?? SEO_PADRAO) as SeoConteudo;
  const links = (linksEstado.rascunho?.conteudo ?? linksEstado.vigente?.conteudo ?? LINKS_PADRAO) as LinksConteudo;
  const podeEscrever = checkAccess(session, ESCRITA_EDITORIAL).ok;
  const chefia = checkAccess(session, CHEFIA_EDITORIAL).ok;
  const admin = checkAccess(session, ['admin']).ok;
  const org = seo.dadosEstruturados.organizacao;
  return (
    <>
      <h1>SEO</h1>
      <p>
        SEO global e links internos são documentos versionados: a redação grava o <strong>rascunho</strong>; só editor-chefe e admin publicam. Redirecionamentos não podem formar laço nem cadeia longa. Rascunho de matéria nunca entra em sitemap.
      </p>
      <Flash tipo={q.tipoMsg} aviso={q.aviso} />

      <h2>SEO global</h2>
      {podeEscrever ? (
        <form action={salvarSeoAction} aria-label="SEO global" className="st-card">
          <div className="st-field">
            <label htmlFor="tituloPadrao">Título padrão (até 70)</label>
            <input id="tituloPadrao" name="tituloPadrao" type="text" defaultValue={seo.tituloPadrao} />
          </div>
          <div className="st-field">
            <label htmlFor="descricaoPadrao">Descrição padrão (até 200)</label>
            <textarea id="descricaoPadrao" name="descricaoPadrao" rows={2} defaultValue={seo.descricaoPadrao} />
          </div>
          <div className="st-field">
            <label htmlFor="imagemOgUrl">Imagem de compartilhamento (URL http/https, opcional)</label>
            <input id="imagemOgUrl" name="imagemOgUrl" type="text" defaultValue={seo.imagemOgUrl ?? ''} />
          </div>
          <div className="st-row">
            <div className="st-field">
              <label htmlFor="indexacao">Indexação do site</label>
              <select id="indexacao" name="indexacao" defaultValue={seo.indexacao}>
                <option value="indexar">Indexar</option>
                <option value="noindex">noindex (desliga robots, meta e sitemap)</option>
              </select>
            </div>
            <div className="st-field">
              <label>
                <input type="checkbox" name="incluirMaterias" defaultChecked={seo.sitemap.incluirMaterias} /> Sitemap inclui matérias publicadas
              </label>
            </div>
          </div>
          <h3>Organização (dados estruturados)</h3>
          <div className="st-row">
            <div className="st-field">
              <label htmlFor="orgNome">Nome</label>
              <input id="orgNome" name="orgNome" type="text" defaultValue={org.nome} />
            </div>
            <div className="st-field">
              <label htmlFor="orgUrl">URL do site</label>
              <input id="orgUrl" name="orgUrl" type="text" defaultValue={org.url} />
            </div>
          </div>
          <div className="st-field">
            <label htmlFor="orgLogoUrl">URL do logo (opcional)</label>
            <input id="orgLogoUrl" name="orgLogoUrl" type="text" defaultValue={org.logoUrl ?? ''} />
          </div>
          <div className="st-field">
            <label htmlFor="orgSameAs">Perfis oficiais (uma URL por linha, até 10)</label>
            <textarea id="orgSameAs" name="orgSameAs" rows={3} defaultValue={org.sameAs.join('\n')} />
          </div>
          <button className="st-btn" type="submit">
            Salvar rascunho do SEO
          </button>
        </form>
      ) : (
        <p className="st-hint">Seu papel só lê as configurações de SEO.</p>
      )}
      <div style={{ marginTop: 14 }}>
        <SiteDocPainel tipo="seo_global" estado={seoEstado} podePublicar={chefia} retorno="/studio/seo" />
      </div>
      <div style={{ marginTop: 14 }}>
        <PortalAgora parte="seo" />
      </div>

      <h2 style={{ marginTop: 24 }}>Links internos</h2>
      <p className="st-hint">Termo que vira link para um caminho do portal (um termo por regra, sem repetir).</p>
      {links.regras.length === 0 ? (
        <p className="st-hint" data-vazio="links">
          Nenhuma regra de link interno.
        </p>
      ) : (
        <table className="st-table" aria-label="Regras de links internos">
          <thead>
            <tr>
              <th scope="col">Termo</th>
              <th scope="col">Destino</th>
              {podeEscrever ? <th scope="col">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {links.regras.map((r, i) => (
              <tr key={r.termo} data-termo={r.termo}>
                <th scope="row">{r.termo}</th>
                <td>
                  <code>{r.destino}</code>
                </td>
                {podeEscrever ? (
                  <td>
                    <form action={removerLinkAction}>
                      <input type="hidden" name="indice" value={i} />
                      <button className="st-btn danger" type="submit" aria-label={`Remover regra ${r.termo}`}>
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
      {podeEscrever ? (
        <form action={adicionarLinkAction} aria-label="Nova regra de link interno" className="st-card" style={{ marginTop: 10 }}>
          <div className="st-row">
            <div className="st-field">
              <label htmlFor="termo">Termo</label>
              <input id="termo" name="termo" type="text" />
            </div>
            <div className="st-field">
              <label htmlFor="destino-link">Destino (caminho interno)</label>
              <input id="destino-link" name="destino" type="text" placeholder="/editoria/mercado" />
            </div>
          </div>
          <button className="st-btn" type="submit">
            Adicionar regra ao rascunho
          </button>
        </form>
      ) : null}
      <div style={{ marginTop: 14 }}>
        <SiteDocPainel tipo="links_internos" estado={linksEstado} podePublicar={chefia} retorno="/studio/seo" />
      </div>
      <div style={{ marginTop: 14 }}>
        <PortalAgora parte="links" />
      </div>

      <h2 style={{ marginTop: 24 }}>Redirecionamentos</h2>
      {redirects.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h3 id="vazio">Nenhum redirecionamento</h3>
          <p>Nenhum redirecionamento cadastrado.</p>
        </section>
      ) : (
        <table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {redirects.length} redirecionamento(s)
          </caption>
          <thead>
            <tr>
              <th scope="col">Origem</th>
              <th scope="col">Destino</th>
              <th scope="col">Código</th>
              <th scope="col">Situação</th>
              {chefia ? <th scope="col">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {redirects.map((r) => (
              <tr key={r.id} data-origem={r.origem} data-ativo={r.ativo}>
                <th scope="row">
                  <code>{r.origem}</code>
                </th>
                <td>
                  <code>{r.destino}</code>
                </td>
                <td>{r.codigo}</td>
                <td>{r.ativo ? 'ativo' : 'desativado'}</td>
                {chefia ? (
                  <td className="st-actions">
                    <form action={alternarRedirectAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="ativo" value={r.ativo ? 'false' : 'true'} />
                      <button className="st-btn sec" type="submit" aria-label={`${r.ativo ? 'Desativar' : 'Ativar'} redirecionamento de ${r.origem}`}>
                        {r.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                    </form>
                    {admin ? (
                      <form action={removerRedirectAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="st-btn danger" type="submit" aria-label={`Remover redirecionamento de ${r.origem}`}>
                          Remover
                        </button>
                      </form>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {chefia ? (
        <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="novo">
          <h3 id="novo" style={{ marginTop: 0 }}>
            Novo redirecionamento
          </h3>
          <form action={criarRedirectAction}>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="origem">Origem (caminho)</label>
                <input id="origem" name="origem" type="text" placeholder="/noticia-antiga" />
              </div>
              <div className="st-field">
                <label htmlFor="destino">Destino (caminho ou URL http/https)</label>
                <input id="destino" name="destino" type="text" placeholder="/noticia/nova" />
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
          {!admin ? <p className="st-hint">Excluir um redirecionamento é só do admin; você pode desativar.</p> : null}
        </section>
      ) : (
        <p className="st-hint">Criar redirecionamento é do editor-chefe e do admin.</p>
      )}
      <p className="st-hint">Sitemap de matérias, RSS e Lighthouse dependem do portal publicado.</p>
    </>
  );
}
