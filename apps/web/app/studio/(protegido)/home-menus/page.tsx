import type { Metadata } from 'next';
import Link from 'next/link';
import { EDITORIAS } from '@ln/contracts';
import { POSITIONS } from '@ln/commercial';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { HOME_PADRAO, MENU_PADRAO, ROTULO_TIPO, descreverBloco, type Bloco, type HomeConteudo, type MenuConteudo, type TipoDoc } from '@/lib/studio/site-docs';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { SiteDocPainel, type EstadoDoc } from '../../_components/SiteDocPainel';
import { PortalAgora } from '../../_components/PortalAgora';
import { editarDocAction } from './actions';

export const metadata: Metadata = { title: 'Home e menus' };
export const dynamic = 'force-dynamic';

const ABAS: readonly TipoDoc[] = ['home', 'menu_principal', 'menu_rodape'];

function Setas({ tipo, indice }: { tipo: TipoDoc; indice: number }) {
  return (
    <>
      {(['up', 'down'] as const).map((d) => (
        <form action={editarDocAction} key={d} style={{ display: 'inline' }}>
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="op" value="mover" />
          <input type="hidden" name="indice" value={indice} />
          <input type="hidden" name="dir" value={d} />
          <button className="st-btn sec" type="submit" aria-label={`${d === 'up' ? 'Subir' : 'Descer'} item ${indice + 1}`}>
            {d === 'up' ? '↑' : '↓'}
          </button>
        </form>
      ))}
      <form action={editarDocAction} style={{ display: 'inline' }}>
        <input type="hidden" name="tipo" value={tipo} />
        <input type="hidden" name="op" value="remover" />
        <input type="hidden" name="indice" value={indice} />
        <button className="st-btn danger" type="submit" aria-label={`Remover item ${indice + 1}`}>
          Remover
        </button>
      </form>
    </>
  );
}

function EditarBloco({ b, i }: { b: Bloco; i: number }) {
  return (
    <details>
      <summary>Editar bloco {i + 1}</summary>
      <form action={editarDocAction} aria-label={`Editar bloco ${i + 1}`} className="st-card">
        <input type="hidden" name="tipo" value="home" />
        <input type="hidden" name="op" value="editar-bloco" />
        <input type="hidden" name="indice" value={i} />
        {b.tipo !== 'publicidade' ? (
          <div className="st-field">
            <label htmlFor={`bt-${i}`}>Título do bloco {i + 1}</label>
            <input id={`bt-${i}`} name="titulo" type="text" defaultValue={b.titulo ?? ''} />
          </div>
        ) : null}
        {b.tipo === 'destaque' ? (
          <div className="st-field">
            <label htmlFor={`bs-${i}`}>Slugs das matérias do bloco {i + 1} (separados por vírgula)</label>
            <input id={`bs-${i}`} name="materiaSlugs" type="text" defaultValue={b.materiaSlugs.join(', ')} />
          </div>
        ) : null}
        {b.tipo === 'lista_editoria' ? (
          <div className="st-field">
            <label htmlFor={`be-${i}`}>Editoria do bloco {i + 1}</label>
            <select id={`be-${i}`} name="editoria" defaultValue={b.editoria}>
              {EDITORIAS.map((e) => (
                <option key={e.slug} value={e.slug}>
                  {e.nome}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {b.tipo === 'lista_editoria' || b.tipo === 'ultimas' || b.tipo === 'agenda' ? (
          <div className="st-field">
            <label htmlFor={`bl-${i}`}>Limite de itens do bloco {i + 1}</label>
            <input id={`bl-${i}`} name="limite" type="text" defaultValue={String(b.limite)} />
          </div>
        ) : null}
        {b.tipo === 'publicidade' ? (
          <div className="st-field">
            <label htmlFor={`bp-${i}`}>Posição do bloco {i + 1}</label>
            <select id={`bp-${i}`} name="posicao" defaultValue={b.posicao}>
              {POSITIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} {p.desktop ? `(${p.desktop})` : '(sem dimensão: não publica)'}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button className="st-btn sec" type="submit">
          Salvar bloco {i + 1}
        </button>
      </form>
    </details>
  );
}

export default async function HomeMenusPage({ searchParams }: { searchParams: Promise<{ tipo?: string; tipoMsg?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('home-menus')!);
  const q = await searchParams;
  const tipo: TipoDoc = ABAS.includes(q.tipo as TipoDoc) ? (q.tipo as TipoDoc) : 'home';
  const r = await api.site.documento(tipo);
  if (naoConfigurado(r)) {
    return (
      <>
        <h1>Home e menus</h1>
        <SemBanco modulo="A gestão da home e dos menus" />
      </>
    );
  }
  if (ehErro(r)) {
    return (
      <>
        <h1>Home e menus</h1>
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      </>
    );
  }
  const estado = (r.body as { data: EstadoDoc }).data;
  const podeEditar = checkAccess(session, ['admin', 'editor_chefe']).ok;
  const emEdicao = (estado.rascunho?.conteudo ?? estado.vigente?.conteudo ?? (tipo === 'home' ? HOME_PADRAO : MENU_PADRAO)) as HomeConteudo | MenuConteudo;
  const origem = estado.rascunho ? 'rascunho' : estado.vigente ? 'versão em vigor (sem rascunho: editar cria um)' : 'padrão mínimo (nada publicado ainda)';
  return (
    <>
      <h1>Home e menus</h1>
      <p>
        Documentos versionados: editar muda só o <strong>rascunho</strong>; publicar cria a próxima versão (ou agenda); voltar atrás cria nova versão. Matéria fixada precisa estar publicada e posição de anúncio precisa ter dimensão reservada, ou o Backend recusa a publicação.
      </p>
      <nav aria-label="Documentos do site" className="st-actions">
        {ABAS.map((a) => (
          <Link key={a} className={a === tipo ? 'st-btn' : 'st-btn sec'} href={`/studio/home-menus?tipo=${a}`} aria-current={a === tipo ? 'page' : undefined}>
            {ROTULO_TIPO[a]}
          </Link>
        ))}
      </nav>
      <Flash tipo={q.tipoMsg} aviso={q.aviso} />

      <h2>
        {ROTULO_TIPO[tipo]} em edição <span className="st-hint">(origem: {origem})</span>
      </h2>
      {tipo === 'home' ? (
        <ol className="st-issues" aria-label="Blocos da home em ordem">
          {(emEdicao as HomeConteudo).blocos.map((b, i) => (
            <li key={b.id} data-bloco={b.id}>
              <strong>{i + 1}.</strong> {descreverBloco(b)}
              {podeEditar ? <Setas tipo={tipo} indice={i} /> : null}
              {podeEditar ? <EditarBloco b={b} i={i} /> : null}
            </li>
          ))}
        </ol>
      ) : (
        <ol className="st-issues" aria-label={`Itens de ${ROTULO_TIPO[tipo]}`}>
          {(emEdicao as MenuConteudo).itens.map((it, i) => (
            <li key={`${it.rotulo}-${i}`} data-item={it.rotulo}>
              <strong>{it.rotulo}</strong> → <code>{it.destino}</code>
              {it.filhos.length ? (
                <ul className="st-issues" aria-label={`Subitens de ${it.rotulo}`}>
                  {it.filhos.map((f, j) => (
                    <li key={`${f.rotulo}-${j}`} data-filho={f.rotulo}>
                      {f.rotulo} → <code>{f.destino}</code>
                      {podeEditar ? (
                        <form action={editarDocAction} style={{ display: 'inline', marginLeft: 8 }}>
                          <input type="hidden" name="tipo" value={tipo} />
                          <input type="hidden" name="op" value="remover-filho" />
                          <input type="hidden" name="indice" value={i} />
                          <input type="hidden" name="filho" value={j} />
                          <button className="st-btn danger" type="submit" aria-label={`Remover subitem ${f.rotulo} de ${it.rotulo}`}>
                            Remover subitem
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {podeEditar ? (
                <details>
                  <summary>Editar item {it.rotulo}</summary>
                  <form action={editarDocAction} aria-label={`Editar item ${it.rotulo}`} className="st-card">
                    <input type="hidden" name="tipo" value={tipo} />
                    <input type="hidden" name="op" value="editar-item" />
                    <input type="hidden" name="indice" value={i} />
                    <div className="st-field">
                      <label htmlFor={`ir-${i}`}>Rótulo de {it.rotulo}</label>
                      <input id={`ir-${i}`} name="rotulo" type="text" defaultValue={it.rotulo} />
                    </div>
                    <div className="st-field">
                      <label htmlFor={`id-${i}`}>Destino de {it.rotulo}</label>
                      <input id={`id-${i}`} name="destino" type="text" defaultValue={it.destino} />
                    </div>
                    <button className="st-btn sec" type="submit">
                      Salvar item {it.rotulo}
                    </button>
                  </form>
                </details>
              ) : null}
              {podeEditar ? <Setas tipo={tipo} indice={i} /> : null}
              {podeEditar ? (
                <form action={editarDocAction} className="st-actions" aria-label={`Adicionar subitem a ${it.rotulo}`}>
                  <input type="hidden" name="tipo" value={tipo} />
                  <input type="hidden" name="op" value="adicionar-filho" />
                  <input type="hidden" name="indice" value={i} />
                  <input name="rotulo" type="text" placeholder="Subitem" aria-label={`Rótulo do subitem de ${it.rotulo}`} />
                  <input name="destino" type="text" placeholder="/caminho" aria-label={`Destino do subitem de ${it.rotulo}`} />
                  <button className="st-btn sec" type="submit" aria-label={`Adicionar subitem a ${it.rotulo}`}>
                    + subitem
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {podeEditar ? (
        <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="add">
          <h3 id="add" style={{ marginTop: 0 }}>
            {tipo === 'home' ? 'Adicionar bloco' : 'Adicionar item'}
          </h3>
          {tipo === 'home' ? (
            <form action={editarDocAction}>
              <input type="hidden" name="tipo" value={tipo} />
              <input type="hidden" name="op" value="adicionar" />
              <div className="st-row">
                <div className="st-field">
                  <label htmlFor="blocoTipo">Tipo de bloco</label>
                  <select id="blocoTipo" name="blocoTipo" defaultValue="ultimas">
                    <option value="ultimas">Últimas</option>
                    <option value="destaque">Destaque (matérias fixadas)</option>
                    <option value="lista_editoria">Lista de uma editoria</option>
                    <option value="agenda">Agenda</option>
                    <option value="publicidade">Posição de publicidade</option>
                  </select>
                </div>
                <div className="st-field">
                  <label htmlFor="titulo-bloco">Título (opcional)</label>
                  <input id="titulo-bloco" name="titulo" type="text" />
                </div>
              </div>
              <div className="st-row">
                <div className="st-field">
                  <label htmlFor="materiaSlugs">Destaque: slugs das matérias (separados por vírgula)</label>
                  <input id="materiaSlugs" name="materiaSlugs" type="text" />
                </div>
                <div className="st-field">
                  <label htmlFor="editoria-bloco">Lista de editoria: editoria</label>
                  <select id="editoria-bloco" name="editoria" defaultValue="mercado">
                    {EDITORIAS.map((e) => (
                      <option key={e.slug} value={e.slug}>
                        {e.nome}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="st-row">
                <div className="st-field">
                  <label htmlFor="limite-bloco">Limite de itens</label>
                  <input id="limite-bloco" name="limite" type="text" />
                </div>
                <div className="st-field">
                  <label htmlFor="posicao-bloco">Publicidade: posição</label>
                  <select id="posicao-bloco" name="posicao" defaultValue="TOP">
                    {POSITIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id} {p.desktop ? `(${p.desktop})` : '(sem dimensão: não publica)'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button className="st-btn" type="submit">
                Adicionar bloco ao rascunho
              </button>
            </form>
          ) : (
            <form action={editarDocAction}>
              <input type="hidden" name="tipo" value={tipo} />
              <input type="hidden" name="op" value="adicionar" />
              <div className="st-row">
                <div className="st-field">
                  <label htmlFor="rotulo-item">Rótulo</label>
                  <input id="rotulo-item" name="rotulo" type="text" />
                </div>
                <div className="st-field">
                  <label htmlFor="destino-item">Destino (caminho interno ou URL http/https)</label>
                  <input id="destino-item" name="destino" type="text" />
                </div>
              </div>
              <button className="st-btn" type="submit">
                Adicionar item ao rascunho
              </button>
            </form>
          )}
          {!estado.rascunho ? (
            <form action={editarDocAction} style={{ marginTop: 10 }}>
              <input type="hidden" name="tipo" value={tipo} />
              <input type="hidden" name="op" value="iniciar" />
              <button className="st-btn sec" type="submit">
                Criar rascunho a partir do conteúdo atual
              </button>
            </form>
          ) : null}
        </section>
      ) : (
        <p className="st-hint">Seu papel só lê a home e os menus.</p>
      )}

      <div style={{ marginTop: 18 }}>
        <SiteDocPainel tipo={tipo} estado={estado} podePublicar={podeEditar} retorno={`/studio/home-menus?tipo=${tipo}`} />
      </div>
      <div style={{ marginTop: 14 }}>
        <PortalAgora parte={tipo === 'home' ? 'home' : 'menus'} />
      </div>
    </>
  );
}
