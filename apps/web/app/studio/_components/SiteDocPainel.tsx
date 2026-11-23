import { ehErro } from '@/lib/studio/backend';
import { api } from '@/lib/studio/rotas-api';
import { ROTULO_TIPO, type TipoDoc } from '@/lib/studio/site-docs';
import { cancelarAgendamentoAction, publicarDocAction, rollbackDocAction } from '../_actions/site-doc';

export interface MetaDoc {
  id: string;
  tipo: string;
  versao: number | null;
  estado: string;
  publicarEm: string | null;
  publicadoEm: string | null;
  nota: string | null;
  criadoPor: string;
  criadoEm: string;
  efetivoAgora: boolean;
  conteudo?: unknown;
}
export interface EstadoDoc {
  tipo: string;
  vigente: MetaDoc | null;
  rascunho: MetaDoc | null;
  agendado: MetaDoc | null;
}

const quando = (s: string | null) => (s ? s.slice(0, 16).replace('T', ' ') + ' UTC' : '—');

/** Ciclo de vida de um documento do site: situação, pendências do rascunho, publicar/agendar, cancelar e rollback. */
export async function SiteDocPainel({ tipo, estado, podePublicar, retorno }: { tipo: TipoDoc; estado: EstadoDoc; podePublicar: boolean; retorno: string }) {
  const pre = estado.rascunho ? await api.site.preview(tipo) : null;
  const pendencias = pre && !ehErro(pre) ? ((pre.body as { data: { pendencias: { path: string; message: string }[] } }).data.pendencias ?? []) : [];
  const lista = await api.site.documentos();
  const versoes = (ehErro(lista) ? [] : (lista.body as { data: MetaDoc[] }).data).filter((d) => d.tipo === tipo && d.versao !== null);
  return (
    <section className="st-card" aria-label={`Publicação de ${ROTULO_TIPO[tipo]}`} data-doc={tipo}>
      <h2 style={{ marginTop: 0 }}>Publicação — {ROTULO_TIPO[tipo]}</h2>
      <ul className="st-issues" aria-label="Situação do documento">
        <li data-situacao="vigente">
          Em vigor: {estado.vigente ? `v${estado.vigente.versao} (publicada em ${quando(estado.vigente.publicadoEm ?? estado.vigente.publicarEm)})` : 'nenhuma versão publicada: o portal usa o padrão dele'}
        </li>
        <li data-situacao="rascunho">Rascunho: {estado.rascunho ? `em edição (por ${estado.rascunho.criadoPor.slice(0, 8)}…)` : 'nenhum'}</li>
        <li data-situacao="agendado">Agendado: {estado.agendado ? `v${estado.agendado.versao} para ${quando(estado.agendado.publicarEm)}` : 'nenhum'}</li>
      </ul>
      {estado.rascunho ? (
        pendencias.length === 0 ? (
          <p data-pendencias="0">Sem pendências: o rascunho pode ser publicado.</p>
        ) : (
          <div className="st-alert err" role="alert" data-pendencias={pendencias.length}>
            Pendências que impedem publicar:
            <ul>
              {pendencias.map((p) => (
                <li key={p.path}>
                  {p.path}: {p.message}
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}

      {podePublicar ? (
        <>
          {estado.rascunho ? (
            <div className="st-actions" style={{ marginTop: 8 }}>
              <form action={publicarDocAction} aria-label={`Publicar ${ROTULO_TIPO[tipo]} agora`}>
                <input type="hidden" name="tipo" value={tipo} />
                <input type="hidden" name="retorno" value={retorno} />
                <button className="st-btn" type="submit">
                  Publicar agora
                </button>
              </form>
              <form action={publicarDocAction} className="st-actions" aria-label={`Agendar ${ROTULO_TIPO[tipo]}`}>
                <input type="hidden" name="tipo" value={tipo} />
                <input type="hidden" name="retorno" value={retorno} />
                <label htmlFor={`agendar-${tipo}`}>Agendar para (Brasília)</label>
                <input id={`agendar-${tipo}`} name="agendarPara" type="datetime-local" />
                <button className="st-btn sec" type="submit">
                  Agendar
                </button>
              </form>
            </div>
          ) : (
            <p className="st-hint">Sem rascunho: edite o documento para criar um e então publicar.</p>
          )}
          {estado.agendado ? (
            <form action={cancelarAgendamentoAction} style={{ marginTop: 8 }}>
              <input type="hidden" name="tipo" value={tipo} />
              <input type="hidden" name="retorno" value={retorno} />
              <button className="st-btn danger" type="submit">
                Cancelar agendamento
              </button>
            </form>
          ) : null}
        </>
      ) : (
        <p className="st-hint">Seu papel edita o rascunho, mas só editor-chefe e admin publicam.</p>
      )}

      <h3>Versões</h3>
      {versoes.length === 0 ? (
        <p className="st-hint" data-vazio="versoes">
          Nenhuma versão publicada ainda.
        </p>
      ) : (
        <ol reversed className="st-issues" aria-label="Versões publicadas">
          {versoes.map((v) => (
            <li key={v.id} data-versao={v.versao}>
              v{v.versao} · {v.estado} · {quando(v.publicadoEm ?? v.publicarEm)}
              {v.nota ? ` · ${v.nota}` : ''}
              {podePublicar && (v.estado === 'publicado' || v.estado === 'substituido') && v.id !== estado.vigente?.id ? (
                <form action={rollbackDocAction} style={{ display: 'inline', marginLeft: 8 }}>
                  <input type="hidden" name="tipo" value={tipo} />
                  <input type="hidden" name="versao" value={v.versao ?? ''} />
                  <input type="hidden" name="retorno" value={retorno} />
                  <button className="st-btn sec" type="submit" aria-label={`Reverter ${ROTULO_TIPO[tipo]} para v${v.versao}`}>
                    Reverter para esta
                  </button>
                </form>
              ) : v.id === estado.vigente?.id ? (
                <span className="st-badge aprovado"> em vigor</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
