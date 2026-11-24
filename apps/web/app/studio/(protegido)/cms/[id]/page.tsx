import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EDITORIAS } from '@ln/contracts';
import { flagAtiva } from '@/lib/studio/flags';
import { urlPublicaDaMateria } from '@/lib/studio/cms/url-publica';
import { checkAccess } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { evidenciasDisponiveis } from '@/lib/studio/cms/evidencias';
import { CMS_EDIT, CMS_READ, CMS_REVIEW } from '@/lib/studio/cms/roles';
import { STATUS_EDITAVEIS, STATUS_LABEL, TIPOS_CHECAGEM } from '@/lib/studio/cms/status';
import { requireStudio } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { SemBanco } from '../../../_components/SemBanco';
import { StatusArtigo } from '../../../_components/StatusArtigo';
import { FonteRapidaPainel } from '../../../_components/FonteRapidaPainel';
import { rotuloAprovador } from '@/lib/studio/cms/aprovador';
import { MateriaForm } from '../MateriaForm';
import { aprovarAction, bloquearAction, descartarRevisaoAction, emitirReciboAction, enviarChecagemAction, publicarAction, salvarRevisaoAction, voltarRascunhoAction } from '../actions';

export const metadata: Metadata = { title: 'Matéria' };
export const dynamic = 'force-dynamic';

// ids do CMS são UUID; ids de matéria da Fábrica não têm formato fixo: aceita só caracteres seguros e deixa a API dizer se existe
const ID_SEGURO = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export default async function Materia({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { session } = await requireStudio(CMS_READ);
  const { id } = await params;
  const qs = await searchParams;
  const { tipo, aviso, fonte, proximo } = qs;
  const valoresRapida = Object.fromEntries(Object.entries(qs).filter(([k, v]) => /^(fr|ev)_/.test(k) && typeof v === 'string')) as Record<string, string>;
  if (!ID_SEGURO.test(id)) notFound();
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
  // flag pelo resolvedor de runtime (ADR-022): o mesmo da API e do /api/health
  const publicacaoLigada = flagAtiva('publicacaoPortal');
  const podePublicar = checkAccess(session, ['admin', 'editor_chefe']).ok;
  // URL pública canônica da matéria no Portal: /noticia/{slug} (não se digita)
  const urlPublica = urlPublicaDaMateria(m.slug);
  const publicada = m.status === 'publicado' || m.status === 'corrigido';
  // correção: revisão em aberto (404 = não há) e casos desta matéria (o Backend confere se o caso é aceito, no PATCH)
  const revisao = publicada ? await api.materias.revisao(m.id) : null;
  const rev = revisao && !ehErro(revisao) ? revisao.body.data : null;
  // matéria da Fábrica = existe registro editorial com este id: a correção segue o recibo + publicação com `correcao`, não a revisão do CMS
  const ehFabrica = publicada ? !ehErro(await api.editorial.revisao(m.id)) : false;
  const casosResp = publicada ? await api.editorial.correcoes({}) : null;
  const casos = casosResp && !ehErro(casosResp) ? ((casosResp.body as { items: { id: string; articleId: string; kind: string; state: string }[] }).items ?? []).filter((c) => c.articleId === m.id) : [];
  const casosAceitos = casos.filter((c) => ['accepted', 'escalated_legal', 'notice_published', 'social_reconciled'].includes(c.state));
  return (
    <>
      <p>
        <Link href="/studio/cms">← CMS editorial</Link>
      </p>
      <h1>{m.titulo}</h1>
      <p>
        <StatusArtigo status={m.status as Parameters<typeof StatusArtigo>[0]['status']} /> · v{m.versao} · {EDITORIAS.find((e) => e.slug === m.editoria)?.nome ?? m.editoria} · assinatura {m.assinatura} · {m.tempoLeituraMin} min de leitura
      </p>
      <Flash tipo={tipo} aviso={aviso} proximo={proximo} />
      <div className="st-two">
        <section aria-label="Editor">
          {!editavel ? (
            <div className="st-alert" role="note" data-travada="sim">
              Esta matéria está em <strong>{STATUS_LABEL[m.status as keyof typeof STATUS_LABEL] ?? m.status}</strong>: os campos abaixo ficam travados. Só rascunho e bloqueado são editáveis; para alterar, volte a matéria a rascunho.
            </div>
          ) : null}
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
            {m.status === 'rascunho' && podeEditar ? (
              <p className="st-hint" data-dica="checagem-fontes">
                Para enviar à checagem, a matéria precisa de fonte <strong>ativa, com termos revisados</strong>, e de evidência registrada no <Link href="/studio/fontes">Banco de fontes</Link>. A fonte e a evidência rápidas (a confirmar) não bastam.
              </p>
            ) : null}
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
                Recibo da v{m.recibo.versao}: {m.recibo.checagens.map((c) => c.tipo).join(', ')}. <span data-aprovador={m.recibo.aprovador}>Aprovado por {rotuloAprovador(m.recibo.aprovador, m.recibo.aprovadorNome, session.userId)}.</span>
              </p>
            ) : null}
            <section aria-labelledby="pub-titulo" style={{ marginTop: 12 }}>
              <h3 id="pub-titulo" style={{ margin: 0 }}>
                Publicação
              </h3>
              {publicada ? (
                <p data-publicado={m.status === 'corrigido' ? 'corrigido' : 'sim'}>
                  {m.status === 'corrigido' ? 'Publicada e corrigida' : 'Publicada'}
                  {m.publicadoEm ? ` em ${m.publicadoEm.slice(0, 16).replace('T', ' ')} UTC` : ''}. Conteúdo publicado é imutável; só muda por uma correção aceita (seção Correção).
                </p>
              ) : m.status === 'aprovado' && m.recibo && podePublicar ? (
                <form action={publicarAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="recibo" value={m.recibo.id} />
                  <div className="st-field">
                    <label htmlFor="url-publica">URL pública da matéria</label>
                    <input id="url-publica" name="url" type="url" defaultValue={urlPublica} readOnly={Boolean(urlPublica)} />
                    {urlPublica ? <span className="st-hint">É a URL da matéria no Portal; não se digita.</span> : null}
                  </div>
                  <button className="st-btn" type="submit" disabled={!publicacaoLigada} aria-describedby="pub-hint">
                    Publicar
                  </button>
                </form>
              ) : (
                <p>
                  <button className="st-btn" type="button" disabled aria-disabled="true" aria-describedby="pub-hint">
                    Publicar
                  </button>
                </p>
              )}
              <p className="st-hint" id="pub-hint">
                {!publicacaoLigada
                  ? 'Publicação desligada nesta fase.'
                  : m.status === 'aprovado' && m.recibo
                    ? podePublicar
                      ? 'Publica quem tem permissão de publicar (editor-chefe, admin), com o recibo válido da versão aprovada; quem aprovou e quem publica podem ser a mesma pessoa.'
                      : 'Seu papel não publica (exige editor-chefe ou admin).'
                    : 'Publica quando a matéria está aprovada e tem recibo da versão.'}
              </p>
            </section>
          </div>

          {podeEditar && !publicada ? <FonteRapidaPainel articleId={m.id} status={m.status} retorno={`/studio/cms/${m.id}`} valores={valoresRapida} {...(fonte ? { fonteNova: fonte } : {})} /> : null}

          {publicada ? (
            <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="corr-titulo" data-correcao={rev ? rev.estado : 'nenhuma'}>
              <h2 id="corr-titulo" style={{ marginTop: 0 }}>
                Correção
              </h2>
              <p className="st-hint">
                Corrigir matéria publicada exige um caso de correção ACEITO sobre ela. A revisão não altera a página pública: só a publicação oficial da revisão (com recibo) gera a nova versão, marcada como corrigida, com o aviso no fim do corpo. Matéria da Fábrica segue outro caminho (recibo e publicação com `correcao`).
              </p>
              {casos.length === 0 ? (
                <p className="st-hint" data-casos="0">
                  Nenhum caso de correção para esta matéria. <Link href="/studio/cms/correcoes">Abra um caso em Correções.</Link>
                </p>
              ) : (
                <ul className="st-issues" aria-label="Casos desta matéria">
                  {casos.map((c) => (
                    <li key={c.id}>
                      <Link href={`/studio/cms/correcoes/${encodeURIComponent(c.id)}`}>{c.id}</Link> · {c.kind} · {c.state}
                    </li>
                  ))}
                </ul>
              )}

              {ehFabrica ? (
                <div data-origem="fabrica">
                  <p>
                    Matéria da Fábrica: o texto corrigido é um novo rascunho editorial com checagem de outro provedor, e o recibo e a publicação levam o mesmo <code>correcao</code>.
                  </p>
                  <Link className="st-btn" href={`/studio/cms/${encodeURIComponent(m.id)}/corrigir-fabrica`}>
                    Corrigir pela Fábrica
                  </Link>
                </div>
              ) : null}

              {!ehFabrica && rev ? (
                <div data-revisao={rev.estado}>
                  <h3>
                    Revisão v{rev.versao} <span className="st-badge">{rev.estado}</span>
                  </h3>
                  <p className="st-hint">Aviso que entra no fim do corpo (e no hash): {rev.aviso}</p>
                  {podeEditar ? (
                    <form action={descartarRevisaoAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={m.id} />
                      <button className="st-btn danger" type="submit">
                        Descartar revisão
                      </button>
                    </form>
                  ) : null}
                  {rev.estado === 'rascunho' && podeRevisar ? (
                    <form action={emitirReciboAction} style={{ marginTop: 10 }} aria-label="Recibo da revisão">
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="versao" value={rev.versao} />
                      <fieldset className="st-field">
                        <legend>Checagens aprovadas (recibo da revisão v{rev.versao})</legend>
                        {TIPOS_CHECAGEM.map((c) => (
                          <label key={c}>
                            <input type="checkbox" name="checagem" value={c} /> {c}
                          </label>
                        ))}
                      </fieldset>
                      <button className="st-btn" type="submit">
                        Emitir recibo da revisão
                      </button>
                    </form>
                  ) : null}
                  {rev.estado === 'aprovada' && rev.receiptId ? (
                    podePublicar ? (
                      <form action={publicarAction} style={{ marginTop: 10 }} aria-label="Publicar correção">
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="recibo" value={rev.receiptId} />
                        <input type="hidden" name="correcao" value="1" />
                        <div className="st-field">
                          <label htmlFor="url-correcao">URL pública da matéria</label>
                          <input id="url-correcao" name="url" type="url" defaultValue={urlPublica} readOnly={Boolean(urlPublica)} />
                        </div>
                        <button className="st-btn" type="submit" disabled={!publicacaoLigada}>
                          Publicar correção
                        </button>
                        {!publicacaoLigada ? <p className="st-hint">Publicação desligada nesta fase.</p> : null}
                      </form>
                    ) : (
                      <p className="st-hint">Revisão com recibo: a publicação é do editor-chefe ou do admin.</p>
                    )
                  ) : null}
                </div>
              ) : null}

              {!ehFabrica && podeEditar && (!rev || rev.estado === 'rascunho') ? (
                <form action={salvarRevisaoAction} style={{ marginTop: 12 }} aria-label="Revisão de correção">
                  <h3 style={{ marginTop: 0 }}>{rev ? 'Refazer a revisão' : 'Nova revisão de correção'}</h3>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="versaoEsperada" value={m.versao} />
                  <div className="st-field">
                    <label htmlFor="casoCorrecaoId">Caso de correção aceito</label>
                    <select id="casoCorrecaoId" name="casoCorrecaoId" defaultValue={rev?.casoId ?? casosAceitos[0]?.id ?? ''}>
                      {casosAceitos.length === 0 ? <option value="">(nenhum caso aceito)</option> : null}
                      {casosAceitos.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.id} ({c.kind}, {c.state})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="st-field">
                    <label htmlFor="rev-titulo">Título</label>
                    <input id="rev-titulo" name="titulo" type="text" defaultValue={rev?.titulo ?? m.titulo} />
                  </div>
                  <div className="st-field">
                    <label htmlFor="rev-subtitulo">Subtítulo</label>
                    <input id="rev-subtitulo" name="subtitulo" type="text" defaultValue={(rev ? rev.subtitulo : m.subtitulo) ?? ''} />
                  </div>
                  <div className="st-field">
                    <label htmlFor="rev-resumo">Resumo</label>
                    <textarea id="rev-resumo" name="resumo" rows={2} defaultValue={(rev ? rev.resumo : m.resumo) ?? ''} />
                  </div>
                  <div className="st-field">
                    <label htmlFor="rev-corpo">Corpo (sem o aviso: o Backend o acrescenta no fim)</label>
                    <textarea id="rev-corpo" name="corpo" rows={8} defaultValue={rev?.corpo ?? m.corpo} />
                  </div>
                  <button className="st-btn" type="submit">
                    Salvar revisão
                  </button>
                </form>
              ) : null}
            </section>
          ) : null}

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
