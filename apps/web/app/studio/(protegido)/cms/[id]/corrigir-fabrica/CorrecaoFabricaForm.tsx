'use client';

import { useActionState } from 'react';
import { corrigirFabricaAction, type EstadoCorrecao } from '../../actions';

export interface CasoOpcao {
  id: string;
  kind: string;
  state: string;
}

/** Recibo e publicação com o MESMO `correcao`: o que foi digitado fica no formulário entre um passo e outro. */
export function CorrecaoFabricaForm({ id, casos, inicial, checagens }: { id: string; casos: CasoOpcao[]; inicial: EstadoCorrecao['valores']; checagens: readonly string[] }) {
  const [estado, acao, pendente] = useActionState(corrigirFabricaAction, { valores: inicial } satisfies EstadoCorrecao);
  const v = estado.valores;
  return (
    <form action={acao} aria-label="Correção de matéria da Fábrica" data-recibo={estado.reciboId ?? ''} data-publicado={estado.publicado ? 'sim' : 'nao'}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="recibo" value={estado.reciboId ?? ''} />
      {estado.mensagem ? (
        <div className={`st-alert ${estado.tipo === 'err' ? 'err' : 'ok'}`} role={estado.tipo === 'err' ? 'alert' : 'status'}>
          {estado.mensagem}
        </div>
      ) : null}
      <div className="st-field">
        <label htmlFor="casoId">Caso de correção aceito</label>
        <select id="casoId" name="casoId" defaultValue={v.casoId} key={`caso-${v.casoId}`}>
          {casos.length === 0 ? <option value="">(nenhum caso aceito)</option> : null}
          {casos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} ({c.kind}, {c.state})
            </option>
          ))}
        </select>
      </div>
      <div className="st-field">
        <label htmlFor="draft">Rascunho corrigido (JSON, SEM o bloco “Avisos:”: o sistema o compõe)</label>
        <textarea id="draft" name="draft" rows={18} spellCheck={false} defaultValue={v.draft} key={`draft-${v.draft.length}-${estado.reciboId ?? ''}`} style={{ fontFamily: 'monospace' }} />
      </div>
      <div className="st-field">
        <label htmlFor="factcheck">Checagem da nova versão (JSON; provedor DIFERENTE do redator, todas as afirmações aprovadas)</label>
        <textarea id="factcheck" name="factcheck" rows={8} spellCheck={false} defaultValue={v.factcheck} key={`fc-${v.factcheck.length}-${estado.reciboId ?? ''}`} style={{ fontFamily: 'monospace' }} />
      </div>
      <fieldset className="st-field">
        <legend>Checagens aprovadas (recibo da versão corrigida)</legend>
        {checagens.map((c) => (
          <label key={c}>
            <input type="checkbox" name="checagem" value={c} /> {c}
          </label>
        ))}
      </fieldset>
      <div className="st-field">
        <label htmlFor="url-fabrica">URL pública da matéria</label>
        <input id="url-fabrica" name="url" type="url" defaultValue={v.url} key={`url-${v.url}`} />
      </div>
      <div className="st-actions">
        <button className="st-btn" type="submit" name="op" value="recibo" disabled={pendente || estado.publicado === true}>
          Emitir recibo da correção
        </button>
        <button className="st-btn" type="submit" name="op" value="publicar" disabled={pendente || !estado.reciboId || estado.publicado === true}>
          Publicar correção
        </button>
      </div>
      <p className="st-hint">Recibo e publicação no mesmo dia: o hash depende do dia do aviso; se o dia mudar, o Backend recusa (RECEIPT_CONTENT_MISMATCH) e o recibo deve ser reemitido. Só a identidade de publicação do recibo publica.</p>
    </form>
  );
}
