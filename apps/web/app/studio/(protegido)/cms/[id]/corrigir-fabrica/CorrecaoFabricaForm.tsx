'use client';

import { useActionState, useState } from 'react';
import { corrigirFabricaAction, type EstadoCorrecao } from '../../actions';

export interface CasoOpcao {
  id: string;
  kind: string;
  state: string;
}
export interface AfirmacaoVista {
  id: string;
  kind: string;
  textoOriginal: string;
}

const ROTULO_VEREDITO: Record<string, string> = { pass: 'aprovada', fail: 'reprovada', inconclusive: 'inconclusiva' };

/**
 * Recibo e publicação com o MESMO `correcao`. Os campos são controlados: o que foi digitado nunca se perde entre um passo e outro
 * (o React reinicia formulários não controlados ao fim de cada ação, e um reinício tardio apagava edições).
 */
export function CorrecaoFabricaForm({
  id,
  casos,
  inicial,
  afirmacoes,
  fixos,
  checagens,
  podePublicar,
}: {
  id: string;
  casos: CasoOpcao[];
  inicial: EstadoCorrecao['valores'];
  afirmacoes: AfirmacaoVista[];
  fixos: { rotulo: string; valor: string }[];
  checagens: readonly string[];
  podePublicar: boolean;
}) {
  const [estado, acao, pendente] = useActionState(corrigirFabricaAction, { valores: inicial } satisfies EstadoCorrecao);
  const [f, setF] = useState(inicial);
  // recibo: o emitido neste formulário, ou o id de um recibo emitido por OUTRA pessoa (revisor emite, chefia publica)
  const [reciboDigitado, setReciboDigitado] = useState<string | null>(null);
  const recibo = reciboDigitado ?? estado.reciboId ?? '';
  const campo = (k: 'casoId' | 'headline' | 'subtitulo' | 'resumo' | 'body' | 'provider' | 'model' | 'url') => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value })),
  });
  const troca = (k: 'claimTexts' | 'verdicts', i: number, valor: string) => setF((x) => ({ ...x, [k]: x[k].map((v, n) => (n === i ? valor : v)) }));
  return (
    <form action={acao} aria-label="Correção de matéria da Fábrica" data-recibo={estado.reciboId ?? ''} data-publicado={estado.publicado ? 'sim' : 'nao'}>
      <input type="hidden" name="id" value={id} />
      {estado.mensagem ? (
        <div className={`st-alert ${estado.tipo === 'err' ? 'err' : 'ok'}`} role={estado.tipo === 'err' ? 'alert' : 'status'}>
          {estado.mensagem}
        </div>
      ) : null}
      <div className="st-field">
        <label htmlFor="casoId">Caso de correção aceito</label>
        <select id="casoId" name="casoId" {...campo('casoId')}>
          {casos.length === 0 ? <option value="">(nenhum caso aceito)</option> : null}
          {casos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} ({c.kind}, {c.state})
            </option>
          ))}
        </select>
      </div>

      <h2>Texto corrigido</h2>
      <div className="st-field">
        <label htmlFor="headline">Título</label>
        <input id="headline" name="headline" type="text" {...campo('headline')} />
      </div>
      <div className="st-field">
        <label htmlFor="subtitulo">Subtítulo</label>
        <input id="subtitulo" name="subtitulo" type="text" {...campo('subtitulo')} />
      </div>
      <div className="st-field">
        <label htmlFor="resumo">Resumo</label>
        <textarea id="resumo" name="resumo" rows={2} {...campo('resumo')} />
      </div>
      <div className="st-field">
        <label htmlFor="body">Corpo (sem o bloco “Avisos:”: o sistema o compõe a partir do caso; o bloco “Fontes:” fica)</label>
        <textarea id="body" name="body" rows={10} {...campo('body')} />
      </div>

      <h2>Afirmações e checagem</h2>
      <p className="st-hint">A checagem da nova versão é de um provedor DIFERENTE do que redigiu (o Backend recusa o mesmo provedor) e todas as afirmações precisam estar aprovadas. Se você mudou o texto de uma afirmação, o veredito anterior não vale para o texto novo.</p>
      <div className="st-row">
        <div className="st-field">
          <label htmlFor="provider">Provedor da checagem</label>
          <input id="provider" name="provider" type="text" {...campo('provider')} />
        </div>
        <div className="st-field">
          <label htmlFor="model">Modelo da checagem</label>
          <input id="model" name="model" type="text" {...campo('model')} />
        </div>
      </div>
      {afirmacoes.map((a, i) => {
        const alterada = (f.claimTexts[i] ?? '').trim() !== a.textoOriginal.trim();
        return (
          <fieldset key={a.id} className="st-field" data-afirmacao={a.id} data-alterada={alterada ? 'sim' : 'nao'}>
            <legend>
              Afirmação {i + 1} ({a.kind}){alterada ? ' — texto alterado: confirme o veredito' : ''}
            </legend>
            <label htmlFor={`claim-${a.id}`}>Texto da afirmação {i + 1}</label>
            <textarea id={`claim-${a.id}`} name="claimText" rows={2} value={f.claimTexts[i] ?? ''} onChange={(e) => troca('claimTexts', i, e.target.value)} />
            <label htmlFor={`verdict-${a.id}`}>Veredito da afirmação {i + 1}</label>
            <select id={`verdict-${a.id}`} name="verdict" value={f.verdicts[i] ?? ''} onChange={(e) => troca('verdicts', i, e.target.value)}>
              <option value="">(escolha)</option>
              {Object.entries(ROTULO_VEREDITO).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </fieldset>
        );
      })}

      <details>
        <summary>Campos do rascunho que seguem como estão (somente leitura)</summary>
        <dl>
          {fixos.map((x) => (
            <div key={x.rotulo}>
              <dt>{x.rotulo}</dt>
              <dd>
                <code>{x.valor}</code>
              </dd>
            </div>
          ))}
        </dl>
      </details>

      <fieldset className="st-field">
        <legend>Checagens aprovadas (recibo da versão corrigida)</legend>
        {checagens.map((c) => (
          <label key={c}>
            <input type="checkbox" name="checagem" value={c} /> {c}
          </label>
        ))}
      </fieldset>
      <div className="st-field">
        <label htmlFor="recibo">Recibo da correção (id; vale o emitido por outra pessoa para este mesmo texto)</label>
        <input id="recibo" name="recibo" type="text" value={recibo} onChange={(e) => setReciboDigitado(e.target.value)} />
      </div>
      <div className="st-field">
        <label htmlFor="url-fabrica">URL pública da matéria</label>
        <input id="url-fabrica" name="url" type="url" {...campo('url')} />
      </div>
      <div className="st-actions">
        <button className="st-btn" type="submit" name="op" value="recibo" disabled={pendente || estado.publicado === true}>
          Emitir recibo da correção
        </button>
        <button className="st-btn" type="submit" name="op" value="publicar" disabled={pendente || !podePublicar || !recibo.trim() || estado.publicado === true}>
          Publicar correção
        </button>
      </div>
      {!podePublicar ? <p className="st-hint">Seu papel emite o recibo; publicar é do editor-chefe ou do admin.</p> : null}
      <p className="st-hint">Recibo e publicação no mesmo dia: o hash depende do dia do aviso; se o dia mudar, o Backend recusa (RECEIPT_CONTENT_MISMATCH) e o recibo deve ser reemitido. Quem tem permissão de publicar publica qualquer recibo válido da versão.</p>
    </form>
  );
}
