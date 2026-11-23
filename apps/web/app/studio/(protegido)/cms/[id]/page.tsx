import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EDITORIAS } from '@ln/contracts';
import { checkAccess } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { evidenciasDisponiveis } from '@/lib/studio/cms/evidencias';
import { CMS_EDIT, CMS_READ, CMS_REVIEW } from '@/lib/studio/cms/roles';
import { STATUS_EDITAVEIS, TIPOS_CHECAGEM } from '@/lib/studio/cms/status';
import { requireStudio } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { SemBanco } from '../../../_components/SemBanco';
import { StatusArtigo } from '../../../_components/StatusArtigo';
import { MateriaForm } from '../MateriaForm';
import { aprovarAction, bloquearAction, emitirReciboAction, enviarChecagemAction, voltarRascunhoAction } from '../actions';

export const metadata: Metadata = { title: 'Matéria' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Materia({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireStudio(CMS_READ);
  const { id } = await params;
  const { tipo, aviso } = await searchParams;
  if (!UUID.test(id)) notFound();
  const r = await api.materias.obter(id);
  if (naoConfigurado(r)) return <SemBanco modulo="O CMS editorial" />;
  if (r.status === 404) notFound();
  if (ehErro(r)) throw new Error(mensagemErro(r));
  const m = r.body.data;
  const evidencias = await evidenciasDisponiveis();
  // evidências já anexadas entram na lista mesmo que a fonte tenha sido desativada
  for (const f of m.fontes) if (!evidencias.some((e) => e.id === f.id)) evidencias.push({ id: f.id, url: f.url, fonte: f.sourceId, capturadoEm: f.capturadoEm });
  const podeEditar = checkAccess(session, CMS_EDIT).ok;
  const podeRevisar = checkAccess(session, CMS_REVIEW).ok;
  const editavel = STATUS_EDITAVEIS.includes(m.status);
  return (
    <>
      <p>
        <Link href="/studio/cms">← CMS editorial</Link>
      </p>
      <h1>{m.titulo}</h1>
      <p>
        <StatusArtigo status={m.status as Parameters<typeof StatusArtigo>[0]['status']} /> · v{m.versao} · {EDITORIAS.find((e) => e.slug === m.editoria)?.nome ?? m.editoria} · assinatura {m.assinatura} · {m.tempoLeituraMin} min de leitura
      </p>
      <Flash tipo={tipo} aviso={aviso} />
      <div className="st-two">
        <section aria-label="Editor">
          {!editavel ? <p className="st-hint">Só rascunho e bloqueado são editáveis; para alterar, volte a matéria a rascunho.</p> : null}
          <MateriaForm
            key={`${m.id}-${m.versao}`}
            id={m.id}
            somenteLeitura={!podeEditar || !editavel}
            evidencias={evidencias}
            valor={{
              titulo: m.titulo,
              subtitulo: m.subtitulo ?? '',
              resumo: m.resumo ?? '',
              tipoConteudo: m.tipoConteudo,
              editoria: m.editoria,
              corpo: m.corpo,
              evidenceIds: m.fontes.map((f) => f.id),
              imagem: m.imagem,
              patrocinado: m.patrocinado,
              rotulo: m.rotuloPublieditorial ?? '',
            }}
          />
        </section>
        <aside aria-label="Revisão">
          <div className="st-card">
            <h2 style={{ marginTop: 0 }}>Fluxo</h2>
            <div className="st-actions" style={{ marginBottom: 10 }}>
              {m.status === 'rascunho' && podeEditar ? (
                <form action={enviarChecagemAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="st-btn" type="submit">
                    Enviar para checagem
                  </button>
                </form>
              ) : null}
              {(m.status === 'bloqueado' || m.status === 'aprovado' || m.status === 'em_checagem') && podeEditar ? (
                <form action={voltarRascunhoAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="st-btn sec" type="submit">
                    Voltar a rascunho
                  </button>
                </form>
              ) : null}
            </div>

            {m.status === 'em_checagem' && podeRevisar ? (
              <>
                {!m.recibo ? (
                  <form action={emitirReciboAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="versao" value={m.versao} />
                    <fieldset className="st-field">
                      <legend>Checagens aprovadas (recibo da v{m.versao})</legend>
                      {TIPOS_CHECAGEM.map((c) => (
                        <label key={c}>
                          <input type="checkbox" name="checagem" value={c} /> {c}
                        </label>
                      ))}
                    </fieldset>
                    <button className="st-btn" type="submit">
                      Emitir recibo da versão
                    </button>
                    <p className="st-hint">O recibo liga as checagens ao hash do conteúdo desta versão; sem ele, não há aprovação.</p>
                  </form>
                ) : (
                  <form action={aprovarAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="st-btn" type="submit">
                      Aprovar v{m.versao}
                    </button>
                  </form>
                )}
                <form action={bloquearAction} style={{ marginTop: 10 }}>
                  <input type="hidden" name="id" value={m.id} />
                  <div className="st-field">
                    <label htmlFor="nota-bloqueio">Motivo do bloqueio</label>
                    <input id="nota-bloqueio" name="nota" type="text" />
                  </div>
                  <button className="st-btn danger" type="submit">
                    Bloquear
                  </button>
                </form>
              </>
            ) : null}

            {m.recibo ? (
              <p className="st-hint">
                Recibo da v{m.recibo.versao}: {m.recibo.checagens.map((c) => c.tipo).join(', ')}.
              </p>
            ) : null}
            <p style={{ marginTop: 12 }}>
              <button className="st-btn" type="button" disabled aria-disabled="true" aria-describedby="pub-hint">
                Publicar
              </button>
            </p>
            <p className="st-hint" id="pub-hint">
              Publicar não está no Studio: só a identidade de publicação do recibo publica (ADR-008), com a versão aprovada.
            </p>
          </div>

          <div className="st-card" style={{ marginTop: 14 }}>
            <h2 style={{ marginTop: 0 }}>Fontes ({m.fontes.length})</h2>
            {m.fontes.length === 0 ? (
              <p className="st-hint">Sem fontes: a matéria não vai à checagem.</p>
            ) : (
              <ul className="st-issues">
                {m.fontes.map((f) => (
                  <li key={f.id}>{f.url}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="st-card" style={{ marginTop: 14 }}>
            <h2 style={{ marginTop: 0 }}>Histórico</h2>
            {m.transicoes.length === 0 ? (
              <p className="st-hint">Sem transições.</p>
            ) : (
              <ul className="st-issues">
                {[...m.transicoes].reverse().map((t) => (
                  <li key={t.id}>
                    {t.at.slice(11, 19)} · {t.de} → {t.para}
                    {t.nota ? ` — ${t.nota}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
