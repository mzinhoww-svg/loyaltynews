import type { Metadata } from 'next';
import { EmptyState } from '@ln/ui';
import { Recarregar } from '../../_components/Recarregar';
import { EDITORIAS } from '@ln/contracts';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api, type EventoAgenda } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { eventoVigente, hojeSP } from '@/lib/studio/datas';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { QuadroRolavel } from '../../_components/QuadroRolavel';
import { SemBanco } from '../../_components/SemBanco';
import { PortalAgora } from '../../_components/PortalAgora';
import { criarEventoAction, moderarEventoAction, removerEventoAction } from './actions';

export const metadata: Metadata = { title: 'Agenda e eventos' };
export const dynamic = 'force-dynamic';

function Tabela({ id, titulo, eventos, podeRemover, podeModerar }: { id: string; titulo: string; eventos: EventoAgenda[]; podeRemover: boolean; podeModerar: boolean }) {
  return (
    <section aria-labelledby={`t-${id}`}>
      <h2 id={`t-${id}`}>{titulo}</h2>
      {eventos.length === 0 ? (
        <p className="st-hint">Nenhum evento.</p>
      ) : (
        <QuadroRolavel rotulo="Itens da agenda">
<table className="st-table">
          <thead>
            <tr>
              <th scope="col">Evento</th>
              <th scope="col">Datas</th>
              <th scope="col">Local</th>
              <th scope="col">Fonte oficial</th>
              <th scope="col">Moderação</th>
              {podeRemover || podeModerar ? <th scope="col">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id}>
                <th scope="row" className="st-col-titulo">
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
                <td data-moderacao={e.moderacao}>
                  <span className={`st-badge ${e.moderacao === 'aprovado' ? 'aprovado' : e.moderacao === 'rejeitado' ? 'bloqueado' : 'em_checagem'}`}>{e.moderacao}</span>
                  <br />
                  <span className="st-hint">origem {e.origem}</span>
                  {e.motivoRejeicao ? <div className="st-hint">{e.motivoRejeicao}</div> : null}
                </td>
                {podeRemover || podeModerar ? (
                  <td>
                    {podeModerar && e.moderacao !== 'aprovado' ? (
                      <form action={moderarEventoAction} className="st-actions" aria-label={`Aprovar ${e.titulo}`}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="estado" value="aprovado" />
                        <button className="st-btn" type="submit" aria-label={`Aprovar ${e.titulo}`}>
                          Aprovar
                        </button>
                      </form>
                    ) : null}
                    {podeModerar && e.moderacao !== 'rejeitado' ? (
                      <form action={moderarEventoAction} className="st-actions" style={{ marginTop: 6 }} aria-label={`Rejeitar ${e.titulo}`}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="estado" value="rejeitado" />
                        <input name="motivo" type="text" placeholder="Motivo" aria-label={`Motivo da rejeição de ${e.titulo}`} />
                        <button className="st-btn danger" type="submit" aria-label={`Rejeitar ${e.titulo}`}>
                          Rejeitar
                        </button>
                      </form>
                    ) : null}
                    {podeRemover ? (
                    <form action={removerEventoAction} style={{ marginTop: 6 }}>
                      <input type="hidden" name="id" value={e.id} />
                      <button className="st-btn danger" type="submit" aria-label={`Remover ${e.titulo}`}>
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
</QuadroRolavel>
      )}
    </section>
  );
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string; moderacao?: string; origem?: string }> }) {
  const { session } = await requireModule(findModule('agenda')!);
  const { tipo, aviso, moderacao = '', origem = '' } = await searchParams;
  const r = await api.agenda.listar({ moderacao, origem });
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
        <EmptyState kind="error" title="Não foi possível carregar" description={mensagemErro(r)} action={<Recarregar />} />
      </>
    );
  }
  const hoje = hojeSP();
  const todos = r.body.data;
  const proximos = todos.filter((e) => eventoVigente(e.fim, hoje));
  const passados = todos.filter((e) => !eventoVigente(e.fim, hoje)).sort((a, b) => b.fim.localeCompare(a.fim));
  const podeEscrever = checkAccess(session, ['admin', 'editor_chefe', 'editor']).ok;
  const podeRemover = checkAccess(session, ['admin', 'editor_chefe']).ok;
  const podeModerar = podeRemover;
  const pendentes = todos.filter((e) => e.moderacao === 'pendente').length;
  return (
    <>
      <h1>Agenda e eventos</h1>
      <p>Evento só entra com fonte oficial (URL). Evento encerrado sai da lista de próximos e fica no arquivo. Hoje (São Paulo): {hoje}.</p>
      <Flash tipo={tipo} aviso={aviso} />
      <p data-pendentes={pendentes}>
        Pendentes de moderação: <strong>{pendentes}</strong>. Evento da redação nasce aprovado; sugestão pública entra pendente e só aparece no portal depois de aprovada.
      </p>
      <form className="st-filters" method="get" role="search" aria-label="Filtrar eventos">
        <div className="st-field">
          <label htmlFor="moderacao">Moderação</label>
          <select id="moderacao" name="moderacao" defaultValue={moderacao}>
            <option value="">Todas</option>
            <option value="pendente">Pendente</option>
            <option value="aprovado">Aprovado</option>
            <option value="rejeitado">Rejeitado</option>
          </select>
        </div>
        <div className="st-field">
          <label htmlFor="origem">Origem</label>
          <select id="origem" name="origem" defaultValue={origem}>
            <option value="">Todas</option>
            <option value="interno">Redação</option>
            <option value="publico">Sugestão pública</option>
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>
      {todos.length === 0 ? (
        <EmptyState title="Nenhum evento cadastrado" description="A agenda está vazia. Cadastre eventos com a fonte oficial abaixo." />
      ) : null}
      <PortalAgora parte="agenda" />
      <Tabela id="proximos" titulo="Próximos" eventos={proximos} podeRemover={podeRemover} podeModerar={podeModerar} />
      <Tabela id="arquivo" titulo="Arquivo (encerrados)" eventos={passados} podeRemover={podeRemover} podeModerar={podeModerar} />
      {podeEscrever ? (
        <section className="st-card" style={{ marginTop: 18 }} aria-labelledby="novo">
          <h2 id="novo" style={{ marginTop: 0 }}>
            Novo evento
          </h2>
          <form action={criarEventoAction}>
            <div className="st-field">
              <label htmlFor="titulo">Título (obrigatório)</label>
              <input id="titulo" name="titulo" type="text" />
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="inicio">Início (obrigatório)</label>
                <input id="inicio" name="inicio" type="date" />
              </div>
              <div className="st-field">
                <label htmlFor="fim">Fim (obrigatório)</label>
                <input id="fim" name="fim" type="date" />
              </div>
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="local">Local (obrigatório)</label>
                <input id="local" name="local" type="text" />
              </div>
              <div className="st-field">
                <label htmlFor="url">Site do evento (opcional)</label>
                <input id="url" name="url" type="url" />
              </div>
            </div>
            <div className="st-field">
              <label htmlFor="fonteUrl">Fonte oficial (URL, obrigatória)</label>
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
