import type { Metadata } from 'next';
import Link from 'next/link';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { elegiveisParaLote, filtrarFontes, filtroEstado, type FonteFabrica } from '@/lib/studio/fabrica-fontes';
import { requireModule } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { SemBanco } from '../../../_components/SemBanco';
import { CartaoFonte } from './CartaoFonte';
import { habilitarPaginaAction } from './actions';

export const metadata: Metadata = { title: 'Fontes da Fábrica editorial' };
export const dynamic = 'force-dynamic';

export default async function FontesFabricaPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string; q?: string; pagina?: string; estado?: string }> }) {
  const { session } = await requireModule(findModule('fontes')!);
  const { tipo, aviso, q = '', pagina: paginaParam = '1', estado: estadoParam } = await searchParams;
  const estado = filtroEstado(estadoParam);
  const r = await api.editorial.fontesRegistro();
  if (naoConfigurado(r)) {
    return (
      <>
        <h1>Fontes da Fábrica editorial</h1>
        <SemBanco modulo="O registro de fontes da Fábrica" />
      </>
    );
  }
  if (ehErro(r)) {
    return (
      <>
        <h1>Fontes da Fábrica editorial</h1>
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      </>
    );
  }
  const todas = (r.body as { items: FonteFabrica[] }).items;
  const itens = filtrarFontes(todas, q, estado);
  // P2-09: o cadastro tem mais de 100 fontes; a tela mostra 20 por vez (a busca por nome ou host e o filtro de estado continuam)
  const POR_PAGINA = 20;
  const totalPaginas = Math.max(1, Math.ceil(itens.length / POR_PAGINA));
  const pagina = Math.min(Math.max(1, Math.floor(Number(paginaParam)) || 1), totalPaginas);
  const daPagina = itens.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const irPara = (n: number) => `/studio/fontes/fabrica?${new URLSearchParams({ ...(q ? { q } : {}), ...(estado ? { estado } : {}), pagina: String(n) }).toString()}`;
  const podeRevisar = checkAccess(session, ['admin', 'editor_chefe', 'revisor']).ok;
  const podeHabilitar = checkAccess(session, ['admin', 'editor_chefe']).ok;
  const ehAdmin = session.roles.includes('admin');
  const paraLote = ehAdmin ? elegiveisParaLote(daPagina) : [];
  return (
    <>
      <p>
        <Link href="/studio/fontes">← Banco de fontes</Link>
      </p>
      <h1>Fontes da Fábrica editorial</h1>
      <p>
        Cadastro imutável de fontes que a coleta pode usar. O administrador habilita com um clique e a habilitação fica registrada (quem e quando); fontes com aviso de segurança (login, paywall, inacessível) pedem a sua confirmação. A observação é opcional. A coleta segue desligada nesta fase.
      </p>
      <Flash tipo={tipo} aviso={aviso} />
      <form className="st-filters" method="get" role="search" aria-label="Buscar fonte da Fábrica">
        <div className="st-field">
          <label htmlFor="q">Buscar por nome ou host</label>
          <input id="q" name="q" type="search" defaultValue={q} />
        </div>
        <div className="st-field">
          <label>
            <input type="checkbox" name="estado" value="desabilitadas" defaultChecked={estado === 'desabilitadas'} /> Só desabilitadas
          </label>
        </div>
        <button className="st-btn sec" type="submit">
          Buscar
        </button>
      </form>
      {itens.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhuma fonte encontrada</h2>
          <p>O cadastro da Fábrica não tem fontes para esta busca.</p>
        </section>
      ) : (
        <>
          <p className="st-hint">
            {itens.length} fonte(s); {itens.filter((f) => f.habilitada).length} habilitada(s) · página {pagina} de {totalPaginas}.
          </p>
          {ehAdmin ? (
            <form action={habilitarPaginaAction} aria-label="Habilitar todas desta página" className="st-actions" style={{ marginBottom: 12 }}>
              <input type="hidden" name="ids" value={daPagina.map((f) => f.id).join(',')} />
              <input type="hidden" name="q" value={q} />
              <input type="hidden" name="estado" value={estado} />
              <input type="hidden" name="pagina" value={pagina} />
              <button className="st-btn sec" type="submit" disabled={paraLote.length === 0}>
                Habilitar todas desta página ({paraLote.length})
              </button>
              <span className="st-hint">Só as desabilitadas e sem aviso de segurança; as com aviso ficam para você confirmar uma a uma.</span>
            </form>
          ) : null}
          {daPagina.map((f) => (
            <CartaoFonte key={f.id} inicial={f} podeHabilitar={podeHabilitar} podeRevisar={podeRevisar} ehAdmin={ehAdmin} />
          ))}
          {totalPaginas > 1 ? (
            <nav aria-label="Paginação das fontes" className="st-actions">
              {pagina > 1 ? <Link className="st-btn sec" href={irPara(pagina - 1)}>Anterior</Link> : null}
              {pagina < totalPaginas ? <Link className="st-btn sec" href={irPara(pagina + 1)}>Próxima</Link> : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
