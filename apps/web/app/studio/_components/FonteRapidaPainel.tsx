import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { EDITORIAS } from '@ln/contracts';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { LICENCAS, TIPOS_FONTE, TRECHO_MAX, novaChave } from '@/lib/studio/cms/fonte-rapida';
import { anexarEvidenciaAction, criarFonteRapidaAction } from '../(protegido)/cms/fonte-rapida-actions';

/**
 * Painel "Fonte e evidência rápidas" na Nova matéria e na edição (auditoria P2-05): cadastra a fonte e anexa a evidência sem sair da tela.
 * A fonte nasce a CONFIRMAR e INATIVA (não coleta nada); a evidência guarda só o trecho e NÃO conta para os gates de publicação.
 * `articleId` ausente = matéria ainda não salva: só a fonte pode ser criada; evidência exige o rascunho salvo.
 */
export async function FonteRapidaPainel({ articleId, status, retorno, fonteNova, valores = {} }: { articleId?: string; status?: string; retorno: string; fonteNova?: string; valores?: Record<string, string> }) {
  const rascunho = Boolean(articleId) && status === 'rascunho';
  const evidencias = articleId ? await api.fonteRapida.evidencias(articleId) : null;
  const indisponivel = evidencias && ehErro(evidencias) && evidencias.status === 404;
  // fontes para escolher na evidência: as cadastradas e a recém-criada (que veio na query)
  const lista = await api.fontes.listar();
  const fontes = ehErro(lista) ? [] : lista.body.data;
  return (
    <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="fr-titulo" data-painel="fonte-rapida">
      <h2 id="fr-titulo" style={{ marginTop: 0 }}>
        Fonte e evidência rápidas
      </h2>
      <p className="st-hint" data-aviso="a-confirmar">
        Cadastre a fonte e anexe a evidência sem sair daqui. A fonte nova fica <strong>a confirmar</strong> e <strong>inativa</strong>: não coleta nada até alguém revisar os termos e ativá-la no Banco de fontes. A evidência guarda só o trecho (até {TRECHO_MAX} caracteres) e <strong>não conta para os gates de publicação</strong>. Para <strong>enviar à checagem</strong>, a fonte ainda precisa estar ativa, com termos revisados e evidência registrada no <Link href="/studio/fontes">Banco de fontes</Link>.
      </p>
      {indisponivel ? (
        <div className="st-alert" role="status" data-indisponivel="fonte-rapida">
          A fonte rápida ainda não está disponível neste ambiente (rota do Backend pendente). Cadastre a fonte no Banco de fontes.
        </div>
      ) : (
        <>
          <details open={!articleId || Boolean(valores.fr_url || valores.fr_nome)}>
            <summary>Nova fonte rápida</summary>
            <form action={criarFonteRapidaAction} aria-label="Nova fonte rápida">
              <input type="hidden" name="chave" value={novaChave('fr', randomUUID())} />
              <input type="hidden" name="retorno" value={retorno} />
              <div className="st-field">
                <label htmlFor="fr-url">URL da fonte (https, obrigatória)</label>
                <input id="fr-url" name="url" type="text" placeholder="https://…" defaultValue={valores.fr_url ?? ''} />
              </div>
              <div className="st-field">
                <label htmlFor="fr-nome">Nome da fonte (obrigatório, até 120)</label>
                <input id="fr-nome" name="nome" type="text" defaultValue={valores.fr_nome ?? ''} />
              </div>
              <div className="st-row">
                <div className="st-field">
                  <label htmlFor="fr-tipo">Tipo</label>
                  <select id="fr-tipo" name="tipo" defaultValue={valores.fr_tipo ?? 'site'}>
                    {TIPOS_FONTE.map((x) => (
                      <option key={x.valor} value={x.valor}>
                        {x.rotulo}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="st-field">
                  <label htmlFor="fr-licenca">Licença</label>
                  <select id="fr-licenca" name="licenca" defaultValue={valores.fr_licenca ?? 'desconhecida'}>
                    {LICENCAS.map((x) => (
                      <option key={x.valor} value={x.valor}>
                        {x.rotulo}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="st-field">
                <label htmlFor="fr-editoria">Editoria da fonte</label>
                <select id="fr-editoria" name="editoria" defaultValue={valores.fr_editoria ?? ''}>
                  <option value="" disabled>
                    Escolha…
                  </option>
                  {EDITORIAS.map((e) => (
                    <option key={e.slug} value={e.slug}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </div>
              <button className="st-btn sec" type="submit">
                Criar fonte (a confirmar)
              </button>
            </form>
          </details>

          {articleId ? (
            rascunho ? (
              <form action={anexarEvidenciaAction} aria-label="Anexar evidência" style={{ marginTop: 12 }}>
                <h3>Anexar evidência</h3>
                <input type="hidden" name="chave" value={novaChave('ev', randomUUID())} />
                <input type="hidden" name="retorno" value={retorno} />
                <input type="hidden" name="articleId" value={articleId} />
                <div className="st-field">
                  <label htmlFor="ev-fonte">Fonte (opcional)</label>
                  <select id="ev-fonte" name="sourceId" defaultValue={fonteNova ?? ''}>
                    <option value="">Sem fonte (só a URL)</option>
                    {fonteNova && !fontes.some((f) => f.id === fonteNova) ? <option value={fonteNova}>Fonte criada agora (a confirmar)</option> : null}
                    {fontes.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                        {f.revisao === 'a_confirmar' ? ' (a confirmar)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="st-field">
                  <label htmlFor="ev-url">URL da evidência (https, obrigatória)</label>
                  <input id="ev-url" name="url" type="text" placeholder="https://…" defaultValue={valores.ev_url ?? ''} />
                </div>
                <div className="st-field">
                  <label htmlFor="ev-trecho">Trecho que sustenta (obrigatório, até {TRECHO_MAX} caracteres)</label>
                  <textarea id="ev-trecho" name="trecho" rows={4} maxLength={TRECHO_MAX + 200} style={{ minHeight: 0 }} defaultValue={valores.ev_trecho ?? ''} />
                </div>
                <button className="st-btn" type="submit">
                  Anexar evidência (a confirmar)
                </button>
              </form>
            ) : (
              <p className="st-hint" data-evidencia="so-rascunho">
                Só matéria em rascunho recebe evidência (esta está em {status}). Volte a matéria a rascunho para anexar.
              </p>
            )
          ) : (
            <p className="st-hint" data-evidencia="salve-primeiro">
              Para anexar evidência, salve o rascunho primeiro; a fonte já pode ser criada agora.
            </p>
          )}

          {articleId ? (
            <section aria-label="Evidências anexadas" style={{ marginTop: 12 }} data-evidencias-lista>
              <h3>Evidências anexadas</h3>
              {evidencias && ehErro(evidencias) ? (
                <div className="st-alert err" role="alert">
                  {mensagemErro(evidencias)}
                </div>
              ) : !evidencias || evidencias.body.data.length === 0 ? (
                <p className="st-hint" data-vazio="evidencias-rapidas">
                  Nenhuma evidência rápida anexada a esta matéria.
                </p>
              ) : (
                <ul className="st-issues">
                  {evidencias.body.data.map((e) => (
                    <li key={e.id} data-evidencia-id={e.id}>
                      <span className="st-badge em_checagem">a confirmar</span>{' '}
                      <a href={e.url} rel="noreferrer noopener">
                        {e.url}
                      </a>
                      <div>“{e.trecho}”</div>
                      <div className="st-hint">
                        {e.sourceId ? `fonte ${e.sourceId} · ` : 'sem fonte · '}
                        {e.criadoEm.slice(0, 16).replace('T', ' ')} UTC · não conta para os gates de publicação
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
