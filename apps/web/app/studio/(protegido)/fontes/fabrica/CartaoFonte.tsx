'use client';

// Card de uma fonte da Fábrica (DP-51). As ações rodam NO LUGAR (useActionState sobre server action, sem navegar): a lista não recarrega, a
// rolagem e o foco ficam, e a mensagem de sucesso ou erro aparece no próprio card. O estado exibido é o da última resposta do Backend.
import { useActionState, useEffect, useRef } from 'react';
import type { FonteFabrica, ResultadoCartao } from '@/lib/studio/fabrica-fontes';
import { acaoDoCartaoAction } from './actions';

export function CartaoFonte({ inicial, podeHabilitar, podeRevisar, ehAdmin }: { inicial: FonteFabrica; podeHabilitar: boolean; podeRevisar: boolean; ehAdmin: boolean }) {
  const [recente, agir, ocupado] = useActionState<ResultadoCartao | null, FormData>(acaoDoCartaoAction, null);
  // a resposta mais recente traz a fonte já atualizada e a mensagem do card; sem resposta, vale o que a página carregou
  const f = recente?.fonte ?? inicial;
  const mensagemRef = useRef<HTMLDivElement>(null);

  // cada resposta nova: o foco vai para a mensagem do card (sem rolar a página), para a pessoa e o leitor de tela perceberem o resultado
  useEffect(() => {
    if (recente) mensagemRef.current?.focus({ preventScroll: true });
  }, [recente]);

  const exibida = f.habilitada ? 'habilitada' : 'desabilitada';
  const temAviso = f.riscos.length > 0;

  return (
    <section className="st-card" style={{ marginBottom: 12 }} aria-label={f.nome} data-fabrica-fonte={f.id} data-habilitada={f.habilitada ? 'sim' : 'nao'} aria-busy={ocupado}>
      <h2 style={{ marginTop: 0 }}>{f.nome}</h2>
      {f.acesso === 'via-provedor' ? (
        <p className="st-alert" role="note" data-acesso="via-provedor">
          <strong>Acesso via provedor</strong> (risco aceito, DP-31/DP-32): a página é lida por um serviço de extração, não pela coleta direta.
        </p>
      ) : null}
      {temAviso ? (
        <p className="st-alert" role="note" data-aviso-seguranca>
          <strong>Aviso de segurança:</strong> {f.riscos.join('; ')}. {ehAdmin ? 'Você decide, mas precisa confirmar para habilitar.' : 'Só um administrador pode habilitar esta fonte.'}
        </p>
      ) : null}
      <p className="st-hint">
        {f.host} · {f.kind} · {f.editorias.join(', ')} · pesquisada por {f.pesquisa.pesquisadoPor ?? 'desconhecido'}
      </p>
      <p>
        Estado: <strong data-estado>{exibida}</strong> · termos {f.termsStatus} · URL {f.urlVerificada ? 'verificada' : 'não verificada'} · paywall {f.paywall} · {f.elegivel ? 'elegível' : `inelegível (${f.motivosInelegivel.join('; ')})`}
      </p>
      {f.revisao ? (
        <p className="st-hint" data-revisao>
          {f.revisao.direta ? 'Habilitação direta' : 'Última revisão'}: {f.revisao.revisor} em {f.revisao.em.slice(0, 16).replace('T', ' ')} ({f.revisao.termos}){f.revisao.vencida ? ' — VENCIDA: a definição da fonte mudou' : ''}.
        </p>
      ) : (
        <p className="st-hint">Sem revisão registrada.</p>
      )}

      {recente ? (
        <div ref={mensagemRef} tabIndex={-1} className={`st-alert ${recente.ok ? 'ok' : 'err'}`} role={recente.ok ? 'status' : 'alert'} data-cartao-msg>
          {recente.mensagem}
        </div>
      ) : (
        <div ref={mensagemRef} tabIndex={-1} aria-live="polite" />
      )}

      <form action={agir} aria-label={`Habilitar ou desabilitar ${f.nome}`}>
        <input type="hidden" name="acao" value="alternar" />
        <input type="hidden" name="sourceId" value={f.id} />
        {podeHabilitar && !f.habilitada && temAviso && ehAdmin ? (
          <div className="st-field">
            <label>
              <input type="checkbox" name="confirmarRisco" /> Entendi o aviso de segurança ({f.riscos.join('; ')}) e quero habilitar mesmo assim
            </label>
          </div>
        ) : null}
        <details>
          <summary>Detalhes e observação</summary>
          <div className="st-field">
            <label htmlFor={`obs-${f.id}`}>Observação (opcional, sem mínimo de caracteres)</label>
            <textarea id={`obs-${f.id}`} name="observacao" rows={2} maxLength={2000} style={{ minHeight: 0 }} />
          </div>
          <p className="st-hint">
            A observação fica registrada junto com quem habilitou e quando. {f.pesquisa.trechoTermos ? `Trecho dos termos pesquisado: “${f.pesquisa.trechoTermos}”` : ''}
          </p>
        </details>
        <div className="st-actions">
          {podeHabilitar && !f.habilitada ? (
            <button className="st-btn" type="submit" name="op" value="habilitar" disabled={ocupado} aria-label={`Habilitar ${f.nome}`}>
              {ocupado ? 'Habilitando…' : 'Habilitar'}
            </button>
          ) : null}
          {podeRevisar && f.habilitada ? (
            <button className="st-btn danger" type="submit" name="op" value="desabilitar" disabled={ocupado} aria-label={`Desabilitar ${f.nome}`}>
              {ocupado ? 'Desabilitando…' : 'Desabilitar'}
            </button>
          ) : null}
        </div>
      </form>

      {podeRevisar ? (
        <details style={{ marginTop: 10 }}>
          <summary>Registrar revisão dos termos (formal, opcional)</summary>
          <form action={agir} aria-label={`Revisar ${f.nome}`}>
            <input type="hidden" name="acao" value="revisar" />
            <input type="hidden" name="sourceId" value={f.id} />
            <p className="st-hint">Revisão formal por revisor independente do pesquisador. O administrador não precisa dela para habilitar.</p>
            <div className="st-field">
              <label htmlFor={`termos-${f.id}`}>Termos</label>
              <select id={`termos-${f.id}`} name="termos" defaultValue="approved">
                <option value="approved">Aprovados</option>
                <option value="denied">Negados</option>
              </select>
            </div>
            <div className="st-field">
              <label htmlFor={`nota-${f.id}`}>O que foi conferido nos termos oficiais (na revisão formal, mínimo 20 caracteres)</label>
              <input id={`nota-${f.id}`} name="nota" type="text" />
            </div>
            <div className="st-field">
              <label>
                <input type="checkbox" name="urlVerificada" /> URL verificada
              </label>
              <label>
                <input type="checkbox" name="robots" /> robots.txt conferido
              </label>
            </div>
            <div className="st-field">
              <label htmlFor={`paywall-${f.id}`}>Paywall / login</label>
              <select id={`paywall-${f.id}`} name="paywall" defaultValue="none">
                <option value="none">Nenhum</option>
                <option value="login">Exige login</option>
                <option value="metered">Limite de leituras</option>
              </select>
            </div>
            <button className="st-btn" type="submit" disabled={ocupado}>
              {ocupado ? 'Registrando…' : 'Registrar revisão'}
            </button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
