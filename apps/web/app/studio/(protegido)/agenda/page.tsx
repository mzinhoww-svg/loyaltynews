import type { Metadata } from 'next';
import { EDITORIAS } from '@ln/contracts';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api, type EventoAgenda } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { eventoVigente, hojeSP } from '@/lib/studio/datas';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { criarEventoAction, removerEventoAction } from './actions';

export const metadata: Metadata = { title: 'Agenda e eventos' };
export const dynamic = 'force-dynamic';

function Tabela({ id, titulo, eventos, podeRemover }: { id: string; titulo: string; eventos: EventoAgenda[]; podeRemover: boolean }) {
  return (
    <section aria-labelledby={`t-${id}`}>
      <h2 id={`t-${id}`}>{titulo}</h2>
      {eventos.length === 0 ? (
        <p className="st-hint">Nenhum evento.</p>
      ) : (
        <table className="st-table">
          <thead>
            <tr>
              <th scope="col">Evento</th>
              <th scope="col">Datas</th>
              <th scope="col">Local</th>
              <th scope="col">Fonte oficial</th>
              {podeRemover ? <th scope="col">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id}>
                <th scope="row">
                  {e.titulo}
                  {e.patrocinado ? <span className="st-hint"> (patrocinado)</span> : null}
                </th>
                <td>
                  {e.inicio}
                  {e.fim !== e.inicio ? ` a ${e.fim}` : ''}
                </td>
                <td>{e.local}</td>
                <td>
                  <a href={e.fonteUrl} rel="noreferrer noopener">
                    {e.fonteUrl}
                  </a>
                </td>
                {podeRemover ? (
                  <td>
                    <form action={removerEventoAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <button className="st-btn danger" type="submit" aria-label={`Remover ${e.titulo}`}>
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
    </section>
  );
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('agenda')!);
  const { tipo, aviso } = await searchParams;
  const r = await api.agenda.listar();
  if (naoConfigurado(r)) {
    return (
      <>
        <h1>Agenda e eventos</h1>
        <SemBanco modulo="A agenda" />
      </>
    );
  }
  if (ehErro(r)) {
    return (
      <>
        <h1>Agenda e eventos</h1>
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      </>
    );
  }
  const hoje = hojeSP();
  const todos = r.body.data;
  const proximos = todos.filter((e) => eventoVigente(e.fim, hoje));
  const passados = todos.filter((e) => !eventoVigente(e.fim, hoje)).sort((a, b) => b.fim.localeCompare(a.fim));
  const podeEscrever = checkAccess(session, ['admin', 'editor_chefe', 'editor']).ok;
  const podeRemover = checkAccess(session, ['admin', 'editor_chefe']).ok;
  return (
    <>
      <h1>Agenda e eventos</h1>
      <p>Evento só entra com fonte oficial (URL). Evento encerrado sai da lista de próximos e fica no arquivo. Hoje (São Paulo): {hoje}.</p>
      <Flash tipo={tipo} aviso={aviso} />
      {todos.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhum evento cadastrado</h2>
          <p>A agenda está vazia. Cadastre eventos com a fonte oficial abaixo.</p>
        </section>
      ) : null}
      <Tabela id="proximos" titulo="Próximos" eventos={proximos} podeRemover={podeRemover} />
      <Tabela id="arquivo" titulo="Arquivo (encerrados)" eventos={passados} podeRemover={podeRemover} />
      {podeEscrever ? (
        <section className="st-card" style={{ marginTop: 18 }} aria-labelledby="novo">
          <h2 id="novo" style={{ marginTop: 0 }}>
            Novo evento
          </h2>
          <form action={criarEventoAction}>
            <div className="st-field">
              <label htmlFor="titulo">Título</label>
              <input id="titulo" name="titulo" type="text" />
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="inicio">Início (AAAA-MM-DD)</label>
                <input id="inicio" name="inicio" type="text" placeholder="2026-12-01" />
              </div>
              <div className="st-field">
                <label htmlFor="fim">Fim (AAAA-MM-DD)</label>
                <input id="fim" name="fim" type="text" placeholder="2026-12-02" />
              </div>
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="local">Local</label>
                <input id="local" name="local" type="text" />
              </div>
              <div className="st-field">
                <label htmlFor="url">Site do evento (opcional)</label>
                <input id="url" name="url" type="url" />
              </div>
            </div>
            <div className="st-field">
              <label htmlFor="fonteUrl">Fonte oficial (URL)</label>
              <input id="fonteUrl" name="fonteUrl" type="url" />
            </div>
            <fieldset className="st-field">
              <legend>Editorias</legend>
              {EDITORIAS.map((e) => (
                <label key={e.slug}>
                  <input type="checkbox" name="editorias" value={e.slug} /> {e.nome}
                </label>
              ))}
            </fieldset>
            <div className="st-field">
              <label>
                <input type="checkbox" name="patrocinado" /> Evento com patrocinador
              </label>
            </div>
            <button className="st-btn" type="submit">
              Criar evento
            </button>
          </form>
        </section>
      ) : (
        <p className="st-hint">Seu papel só lê a agenda.</p>
      )}
      <p className="st-hint">Arquivo de calendário (.ics) e submissão pública moderada dependem do portal.</p>
    </>
  );
}
