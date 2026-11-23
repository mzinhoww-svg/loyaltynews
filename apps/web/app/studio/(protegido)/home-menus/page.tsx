import type { Metadata } from 'next';
import { isEnabled } from '@ln/contracts';
import { findModule } from '@/lib/studio/modules';
import { EDITORIAS_MENU, getHome, validarHome } from '@/lib/studio/home';
import { requireModule } from '../../_lib/guard';
import { Flash, SemBackend } from '../../_components/Flash';
import { descartarRascunhoAction, editarHomeAction, reverterAction, salvarVersaoAction } from './actions';

export const metadata: Metadata = { title: 'Home e menus' };
export const dynamic = 'force-dynamic';

function Mover({ op, id, nome }: { op: string; id: string; nome: string }) {
  return (
    <>
      {(['up', 'down'] as const).map((d) => (
        <form action={editarHomeAction} key={d} style={{ display: 'inline' }}>
          <input type="hidden" name="op" value={op} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="dir" value={d} />
          <button className="st-btn sec" type="submit" aria-label={`${d === 'up' ? 'Subir' : 'Descer'} ${nome}`}>
            {d === 'up' ? '↑' : '↓'}
          </button>
        </form>
      ))}
    </>
  );
}

export default async function HomeMenusPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  await requireModule(findModule('home-menus')!);
  const { tipo, aviso } = await searchParams;
  const home = getHome();
  const vigente = home.vigente();
  const cfg = home.rascunho ?? vigente.config;
  const problemas = validarHome(cfg);
  return (
    <>
      <h1>Home e menus</h1>
      <p>
        Ordem dos blocos do blueprint (0–12). Header, footer e ticker têm posição fixa; header e footer não se escondem. Posições de anúncio mantêm a dimensão reservada mesmo vazias, para o layout não deslocar. Editar altera um <strong>rascunho</strong>; só &quot;Salvar versão&quot; cria versão, e voltar atrás cria nova versão.
      </p>
      <Flash tipo={tipo} aviso={aviso} />
      <p>
        <span className="st-badge">Versão vigente: v{vigente.numero}</span>{' '}
        {home.rascunho ? <span className="st-badge em_checagem">Rascunho com alterações não salvas</span> : <span className="st-badge aprovado">Sem alterações pendentes</span>}
      </p>
      {problemas.length ? (
        <div className="st-alert err" role="alert">
          Configuração inválida: {problemas.join(' ')}
        </div>
      ) : null}

      <div className="st-two">
        <section aria-labelledby="blocos">
          <h2 id="blocos">Blocos da home</h2>
          <ol className="st-issues" aria-label="Blocos da home em ordem">
            {cfg.blocos.map((b, i) => (
              <li key={b.id} data-bloco={b.id}>
                <strong>
                  {i}. {b.nome}
                </strong>{' '}
                <span className="st-badge">{b.visivel ? 'visível' : 'oculto'}</span>
                {b.dimensao ? <span className="st-badge"> reserva {b.dimensao}</span> : null}
                {b.fixo ? <span className="st-badge"> posição fixa</span> : null}{' '}
                {!b.fixo ? <Mover op="mover-bloco" id={b.id} nome={b.nome} /> : null}
                {!b.obrigatorio ? (
                  <form action={editarHomeAction} style={{ display: 'inline' }}>
                    <input type="hidden" name="op" value="alternar-bloco" />
                    <input type="hidden" name="id" value={b.id} />
                    <button className="st-btn sec" type="submit" aria-label={`${b.visivel ? 'Ocultar' : 'Mostrar'} ${b.nome}`}>
                      {b.visivel ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
        <aside>
          <section className="st-card" aria-labelledby="menu">
            <h2 id="menu" style={{ marginTop: 0 }}>
              Menu principal
            </h2>
            <ol className="st-issues" aria-label="Itens do menu">
              {cfg.menu.map((m) => {
                const bloqueado = m.flag ? !isEnabled(m.flag) : false;
                return (
                  <li key={m.id} data-menu={m.id}>
                    {m.nome} <span className="st-badge">{m.visivel ? 'visível' : 'oculto'}</span>
                    {bloqueado ? <span className="st-flagtag"> flag {m.flag} desligada</span> : null} <Mover op="mover-menu" id={m.id} nome={m.nome} />
                    <form action={editarHomeAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="op" value="alternar-menu" />
                      <input type="hidden" name="id" value={m.id} />
                      <button className="st-btn sec" type="submit" aria-label={`${m.visivel ? 'Ocultar' : 'Mostrar'} ${m.nome} no menu`}>
                        {m.visivel ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ol>
            <p className="st-hint">Dropdown Notícias: {EDITORIAS_MENU.map((e) => e.nome).join(' · ')}.</p>
          </section>

          <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="salvar">
            <h2 id="salvar" style={{ marginTop: 0 }}>
              Salvar
            </h2>
            <form action={salvarVersaoAction}>
              <div className="st-field">
                <label htmlFor="nota">Nota da versão</label>
                <input id="nota" name="nota" type="text" />
              </div>
              <div className="st-actions">
                <button className="st-btn" type="submit" disabled={!home.rascunho}>
                  Salvar versão
                </button>
              </div>
            </form>
            <form action={descartarRascunhoAction} style={{ marginTop: 8 }}>
              <button className="st-btn sec" type="submit" disabled={!home.rascunho}>
                Descartar rascunho
              </button>
            </form>
          </section>

          <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="versoes">
            <h2 id="versoes" style={{ marginTop: 0 }}>
              Versões
            </h2>
            <ol reversed className="st-issues">
              {[...home.versoes].reverse().map((v) => (
                <li key={v.numero}>
                  v{v.numero} · {v.autor} · {v.em.slice(0, 16).replace('T', ' ')} UTC · {v.nota}
                  {v.numero !== vigente.numero ? (
                    <form action={reverterAction} style={{ display: 'inline', marginLeft: 6 }}>
                      <input type="hidden" name="versao" value={v.numero} />
                      <button className="st-btn sec" type="submit" aria-label={`Reverter para v${v.numero}`}>
                        Reverter para esta
                      </button>
                    </form>
                  ) : (
                    <span className="st-badge aprovado"> vigente</span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
      <SemBackend>A publicação da configuração no portal depende do backend; aqui a versão vigente é só a do Studio.</SemBackend>
    </>
  );
}
