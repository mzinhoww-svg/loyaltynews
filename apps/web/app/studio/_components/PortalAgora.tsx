import { api, type BlocoPublico } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { Seta } from './Seta';

type Parte = 'home' | 'menus' | 'seo' | 'links' | 'agenda';

const TITULO: Record<Parte, string> = {
  home: 'Home',
  menus: 'Menus',
  seo: 'SEO global',
  links: 'Links internos',
  agenda: 'Agenda',
};

function Cartao({ parte, children, estado }: { parte: Parte; children: React.ReactNode; estado: 'ok' | 'vazio' | 'erro' | 'sem-banco' }) {
  return (
    <section className="st-card" aria-label={`O que o Portal lê agora: ${TITULO[parte]}`} data-portal={parte} data-estado={estado}>
      <h3 style={{ marginTop: 0 }}>O que o Portal lê agora — {TITULO[parte]}</h3>
      {children}
    </section>
  );
}

function descreve(b: BlocoPublico): string {
  switch (b.tipo) {
    case 'destaque':
      return `Destaque${b.titulo ? ` “${b.titulo}”` : ''}: ${b.materias.length} matéria(s)`;
    case 'lista_editoria':
      return `Editoria ${b.editoria}${b.titulo ? ` “${b.titulo}”` : ''}: ${b.materias.length} de até ${b.limite}`;
    case 'ultimas':
      return `Últimas${b.titulo ? ` “${b.titulo}”` : ''}: ${b.materias.length} de até ${b.limite}`;
    case 'agenda':
      return `Agenda${b.titulo ? ` “${b.titulo}”` : ''}: ${b.eventos.length} evento(s) de até ${b.limite}`;
    case 'publicidade':
      return `Publicidade ${b.posicao}: espaço reservado`;
  }
}

const Itens = ({ itens }: { itens: { rotulo: string; destino: string; filhos?: { rotulo: string }[] }[] }) => (
  <ul className="st-issues">
    {itens.map((i) => (
      <li key={`${i.rotulo}-${i.destino}`}>
        {i.rotulo} <Seta /> <code>{i.destino}</code>
        {i.filhos?.length ? ` (${i.filhos.map((f) => f.rotulo).join(', ')})` : ''}
      </li>
    ))}
  </ul>
);

/**
 * O que o Portal lê de verdade agora (GET /api/publico/site, /sitemap, /redirects e /api/publico/agenda), na versão em vigor.
 * A tela de edição grava rascunho; esta caixa mostra o resultado publicado, com estados de vazio e de erro. Nada é simulado.
 */
export async function PortalAgora({ parte }: { parte: Parte }) {
  if (parte === 'agenda') {
    const r = await api.agenda.publica();
    if (naoConfigurado(r)) return <Cartao parte={parte} estado="sem-banco"><p className="st-hint">Banco não configurado: o Portal não tem o que ler.</p></Cartao>;
    if (ehErro(r)) return <Cartao parte={parte} estado="erro"><div className="st-alert err" role="alert">{mensagemErro(r)}</div></Cartao>;
    const ev = r.body.data;
    return (
      <Cartao parte={parte} estado={ev.length ? 'ok' : 'vazio'}>
        {ev.length === 0 ? (
          <p className="st-hint" data-vazio="portal">Nenhum evento aprovado e vigente: a agenda do Portal está vazia.</p>
        ) : (
          <>
            <p data-total={ev.length}>{ev.length} evento(s) aprovado(s) e não encerrado(s) visíveis no Portal.</p>
            <ul className="st-issues">
              {ev.slice(0, 5).map((e) => (
                <li key={e.id}>
                  {e.titulo} · {e.inicio}
                </li>
              ))}
            </ul>
          </>
        )}
      </Cartao>
    );
  }

  const r = await api.site.publico();
  if (naoConfigurado(r)) return <Cartao parte={parte} estado="sem-banco"><p className="st-hint">Banco não configurado: o Portal não tem o que ler.</p></Cartao>;
  if (ehErro(r)) return <Cartao parte={parte} estado="erro"><div className="st-alert err" role="alert">{mensagemErro(r)}</div></Cartao>;
  const site = r.body.data;

  if (parte === 'home') {
    if (!site.home) {
      return (
        <Cartao parte={parte} estado="vazio">
          <p className="st-hint" data-vazio="portal">Nenhuma home publicada: o Portal usa a home padrão dele.</p>
        </Cartao>
      );
    }
    return (
      <Cartao parte={parte} estado="ok">
        <p data-versao={site.home.versao}>Versão publicada: v{site.home.versao}.</p>
        <ol className="st-issues" aria-label="Blocos da home no Portal">
          {site.home.blocos.map((b) => (
            <li key={b.id} data-bloco-portal={b.id}>
              {descreve(b)}
            </li>
          ))}
        </ol>
      </Cartao>
    );
  }
  if (parte === 'menus') {
    const { principal, rodape } = site.menus;
    if (!principal && !rodape) {
      return (
        <Cartao parte={parte} estado="vazio">
          <p className="st-hint" data-vazio="portal">Nenhum menu publicado: o Portal usa os menus padrão dele.</p>
        </Cartao>
      );
    }
    return (
      <Cartao parte={parte} estado="ok">
        <h4>Principal</h4>
        {principal ? <Itens itens={principal.itens} /> : <p className="st-hint">Não publicado (padrão do Portal).</p>}
        <h4>Rodapé</h4>
        {rodape ? <Itens itens={rodape.itens} /> : <p className="st-hint">Não publicado (padrão do Portal).</p>}
      </Cartao>
    );
  }
  if (parte === 'seo') {
    const [mapa, redirs] = await Promise.all([api.site.publicoSitemap(), api.site.publicoRedirects()]);
    if (!site.seo) {
      return (
        <Cartao parte={parte} estado="vazio">
          <p className="st-hint" data-vazio="portal">SEO global não publicado: o Portal não indexa por padrão e o sitemap fica vazio.</p>
        </Cartao>
      );
    }
    return (
      <Cartao parte={parte} estado="ok">
        <dl>
          <dt>Título padrão</dt>
          <dd data-seo="titulo">{site.seo.tituloPadrao}</dd>
          <dt>Descrição padrão</dt>
          <dd>{site.seo.descricaoPadrao}</dd>
          <dt>Imagem de compartilhamento</dt>
          <dd>{site.seo.imagemOgUrl ?? 'não definida'}</dd>
          <dt>Indexação</dt>
          <dd data-seo="indexacao">{site.seo.indexacao}</dd>
          <dt>Sitemap</dt>
          <dd>{ehErro(mapa) ? 'indisponível' : `${mapa.body.data.urls.length} URL(s) de matérias`}</dd>
          <dt>Redirecionamentos ativos</dt>
          <dd>{ehErro(redirs) ? 'indisponível' : redirs.body.data.length}</dd>
        </dl>
      </Cartao>
    );
  }
  // links
  if (site.linksInternos.length === 0) {
    return (
      <Cartao parte={parte} estado="vazio">
        <p className="st-hint" data-vazio="portal">Nenhuma regra de link interno publicada.</p>
      </Cartao>
    );
  }
  return (
    <Cartao parte={parte} estado="ok">
      <ul className="st-issues" aria-label="Links internos no Portal">
        {site.linksInternos.map((l) => (
          <li key={l.termo}>
            {l.termo} <Seta /> <code>{l.destino}</code>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}
