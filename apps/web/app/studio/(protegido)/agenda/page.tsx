import type { Metadata } from 'next';
import { EDITORIAS } from '@ln/contracts';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { getAgenda, hojeSP, type EventoRegistro } from '@/lib/studio/agenda';
import { ESCRITA_EDITORIAL, MODERACAO } from '@/lib/studio/papeis';
import { requireModule } from '../../_lib/guard';
import { Flash, SemBackend } from '../../_components/Flash';
import { criarEventoAction, moderarEventoAction } from './actions';

export const metadata: Metadata = { title: 'Agenda e eventos' };
export const dynamic = 'force-dynamic';

function Tabela({ id, titulo, eventos, podeModerar }: { id: string; titulo: string; eventos: EventoRegistro[]; podeModerar: boolean }) {
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
              <th scope="col">Moderação</th>
              {podeModerar ? <th scope="col">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id}>
                <th scope="row">{e.titulo}</th>
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
                <td>
                  <span className={`st-badge ${e.moderacao === 'aprovado' ? 'aprovado' : e.moderacao === 'rejeitado' ? 'bloqueado' : 'em_checagem'}`}>{e.moderacao}</span>
                  {e.motivoRejeicao ? <div className="st-hint">{e.motivoRejeicao}</div> : null}
                </td>
                {podeModerar ? (
                  <td>
                    {e.moderacao === 'pendente' ? (
                      <div className="st-actions">
                        <form action={moderarEventoAction}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="decisao" value="aprovado" />
                          <button className="st-btn" type="submit" aria-label={`Aprovar ${e.titulo}`}>
                            Aprovar
                          </button>
                        </form>
                        <form action={moderarEventoAction} className="st-actions">
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="decisao" value="rejeitado" />
                          <input name="motivo" type="text" aria-label={`Motivo da rejeição de ${e.titulo}`} placeholder="Motivo" />
                          <button className="st-btn danger" type="submit" aria-label={`Rejeitar ${e.titulo}`}>
                            Rejeitar
                          </button>
                        </form>
                      </div>
                    ) : null}
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
  const hoje = hojeSP();
  const agenda = getAgenda();
  const proximos = agenda.proximos(hoje);
  const passados = agenda.passados(hoje);
  const podeEscrever = checkAccess(session, ESCRITA_EDITORIAL).ok;
  const podeModerar = checkAccess(session, MODERACAO).ok;
  return (
    <>
      <h1>Agenda e eventos</h1>
      <p>Evento só entra com fonte oficial. Evento encerrado sai da lista de próximos e fica no arquivo. Hoje (São Paulo): {hoje}.</p>
      <Flash tipo={tipo} aviso={aviso} />
      {proximos.length === 0 && passados.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhum evento cadastrado</h2>
          <p>A agenda está vazia. Cadastre eventos com a fonte oficial abaixo.</p>
        </section>
      ) : null}
      <Tabela id="proximos" titulo="Próximos" eventos={proximos} podeModerar={podeModerar} />
      <Tabela id="arquivo" titulo="Arquivo (encerrados)" eventos={passados} podeModerar={false} />
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
      <SemBackend>Arquivo de calendário (.ics) e submissão pública moderada dependem do portal e do backend.</SemBackend>
    </>
  );
}
