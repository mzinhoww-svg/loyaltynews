import type { Metadata } from 'next';
import Link from 'next/link';
import { EDITORIAS } from '@ln/contracts';
import { AUTORAL_LABEL, sourceTier, type SourceKind } from '@ln/editorial';
import { checkAccess } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { CMS_READ } from '@/lib/studio/cms/roles';
import { FORMATOS, MAX_ANCORAS, MIN_ANCORAS, estadoDaPauta, fontesDeAncora, type FonteRegistro, type PautaVista } from '@/lib/studio/cms/pauta';
import { requireStudio } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { SemBanco } from '../../../_components/SemBanco';
import { enviarPautaAction } from './actions';

export const metadata: Metadata = { title: 'Pauta autoral' };
export const dynamic = 'force-dynamic';

const PODE_ESCREVER = ['admin', 'editor_chefe', 'editor'] as const;

export default async function PautasPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireStudio(CMS_READ);
  const { tipo, aviso } = await searchParams;
  const [lista, reg] = await Promise.all([api.editorial.pautas(), api.editorial.fontesRegistro()]);
  if (naoConfigurado(lista) || naoConfigurado(reg)) {
    return (
      <>
        <h1>Pauta autoral</h1>
        <SemBanco modulo="A pauta autoral" />
      </>
    );
  }
  const pautas: PautaVista[] = ehErro(lista) ? [] : lista.body.items;
  const fontes = ehErro(reg) ? [] : fontesDeAncora((reg.body as { items: FonteRegistro[] }).items, (k) => sourceTier(k as SourceKind) === 'primary');
  const podeEscrever = checkAccess(session, PODE_ESCREVER).ok;
  return (
    <>
      <p>
        <Link href="/studio/cms">← CMS editorial</Link>
      </p>
      <h1>Pauta autoral</h1>
      <p>
        Pauta própria da redação (análise, explicador ou comparativo), ancorada em páginas de fontes <strong>primárias habilitadas</strong>. Você escreve a pauta; o worker coleta as âncoras, redige, checa em outro provedor e a matéria cai na <Link href="/studio/cms/checagem">fila de revisão</Link> como aprovada ou bloqueada. Não há botão de publicar aqui.
      </p>
      <div className="st-alert" role="note" data-aviso="autoral">
        <strong>Aviso fixo de conteúdo autoral</strong> (a Fábrica o põe no início do texto e o gate exige): “{AUTORAL_LABEL}”
      </div>
      <Flash tipo={tipo} aviso={aviso} />

      <h2>Acompanhamento</h2>
      {ehErro(lista) ? (
        <div className="st-alert err" role="alert">
          {mensagemErro(lista)}
        </div>
      ) : pautas.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h3 id="vazio">Nenhuma pauta</h3>
          <p>Nenhuma pauta autoral registrada.</p>
        </section>
      ) : (
        <table className="st-table" aria-label="Pautas autorais">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {pautas.length} pauta(s), da mais recente à mais antiga
          </caption>
          <thead>
            <tr>
              <th scope="col">Pauta</th>
              <th scope="col">Formato · editoria</th>
              <th scope="col">Âncoras</th>
              <th scope="col">Estado</th>
              <th scope="col">Enviada</th>
            </tr>
          </thead>
          <tbody>
            {pautas.map((p) => {
              const e = estadoDaPauta(p);
              return (
                <tr key={p.id} data-pauta={p.id} data-estado={e.chave}>
                  <th scope="row">
                    {p.titulo}
                    <div className="st-hint">
                      <code>{p.id}</code> — {p.angulo}
                    </div>
                  </th>
                  <td>
                    {FORMATOS.find((f) => f.valor === p.formato)?.rotulo ?? p.formato} · {EDITORIAS.find((x) => x.slug === p.editoria)?.nome ?? p.editoria}
                  </td>
                  <td>
                    <ul className="st-issues">
                      {p.ancoras.map((u) => (
                        <li key={u}>
                          <code>{u}</code>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    <strong>{e.rotulo}</strong>
                    {p.resultado?.articleId ? (
                      <div>
                        <Link href={`/studio/cms/checagem/${encodeURIComponent(p.resultado.articleId)}`}>Abrir na fila de revisão</Link>
                      </div>
                    ) : null}
                    {p.resultado && p.resultado.blockers.length > 0 ? (
                      <ul className="st-issues" aria-label={`Bloqueios de ${p.id}`}>
                        {p.resultado.blockers.map((b) => (
                          <li key={b} className="bloqueio">
                            {b}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {p.resultado && p.resultado.findings.length > 0 ? (
                      <ul className="st-issues" aria-label={`Achados de ${p.id}`}>
                        {p.resultado.findings.map((f) => (
                          <li key={f} className="aviso">
                            {f}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td>
                    {p.em.slice(0, 16).replace('T', ' ')} UTC
                    <div className="st-hint">por {p.submetidaPor ?? '—'}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: 24 }}>Nova pauta</h2>
      {!podeEscrever ? (
        <p className="st-hint">Seu papel só acompanha as pautas; quem escreve é o editor, o editor-chefe e o admin.</p>
      ) : fontes.length < 1 ? (
        <section className="st-empty" aria-labelledby="sem-fontes" data-sem-fontes>
          <h3 id="sem-fontes">Nenhuma fonte primária habilitada</h3>
          <p>
            A pauta autoral precisa de {MIN_ANCORAS} a {MAX_ANCORAS} âncoras em fontes primárias habilitadas. Revise e habilite fontes em <Link href="/studio/fontes/fabrica">Fontes da Fábrica</Link>.
          </p>
        </section>
      ) : (
        <form action={enviarPautaAction} aria-label="Nova pauta autoral" className="st-card">
          <div className="st-field">
            <label htmlFor="titulo">Título (10 a 140 caracteres)</label>
            <input id="titulo" name="titulo" type="text" />
          </div>
          <div className="st-field">
            <label htmlFor="id">Identificador (opcional: sai do título; minúsculas, números e hífens)</label>
            <input id="id" name="id" type="text" />
          </div>
          <div className="st-field">
            <label htmlFor="angulo">Ângulo (20 a 600 caracteres)</label>
            <textarea id="angulo" name="angulo" rows={4} style={{ minHeight: 0 }} />
          </div>
          <div className="st-row">
            <div className="st-field">
              <label htmlFor="formato">Formato</label>
              <select id="formato" name="formato" defaultValue="analise">
                {FORMATOS.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
            </div>
            <div className="st-field">
              <label htmlFor="editoria">Editoria</label>
              <select id="editoria" name="editoria" defaultValue="pontos">
                {EDITORIAS.map((e) => (
                  <option key={e.slug} value={e.slug}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="st-field">
            <legend>
              Âncoras: de {MIN_ANCORAS} a {MAX_ANCORAS} páginas de fontes primárias habilitadas
            </legend>
            <p className="st-hint">Escolha a fonte e cole a URL https da página dela. A página precisa ficar no host (e no caminho) da fonte escolhida. Linhas sem URL são ignoradas.</p>
            {Array.from({ length: MAX_ANCORAS }, (_, i) => (
              <div className="st-row" key={i}>
                <div className="st-field">
                  <label htmlFor={`fonte-${i}`}>Fonte da âncora {i + 1}</label>
                  <select id={`fonte-${i}`} name={`fonte-${i}`} defaultValue={fontes[i % fontes.length]!.id}>
                    {fontes.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome} — {f.host}
                        {f.pathPrefix ?? ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="st-field">
                  <label htmlFor={`url-${i}`}>Página da âncora {i + 1}</label>
                  <input id={`url-${i}`} name={`url-${i}`} type="text" placeholder="https://…" />
                </div>
              </div>
            ))}
          </fieldset>
          <button className="st-btn" type="submit">
            Registrar pauta na fila
          </button>
          <p className="st-hint">Registrar não publica nada: a pauta entra na fila, o worker a processa e a matéria vai para a revisão.</p>
        </form>
      )}
    </>
  );
}
