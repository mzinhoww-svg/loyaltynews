import { NOTA_MAX, NOTA_MIN } from '../../../../../lib/studio/cms/despublicar';
import { FocarAoAbrir } from '../../../_components/FocarAoAbrir';

const PAINEL = 'confirmar-despublicacao';

/** Passo de confirmação da despublicação. Nada muda por abrir o painel; "Cancelar" só volta à matéria. */
export function Despublicar({
  id,
  versao,
  confirmando,
  erroNaTela,
  acao,
}: {
  id: string;
  versao: number;
  confirmando: boolean;
  erroNaTela: boolean;
  /** Server action que recebe o formulário (a página a entrega). */
  acao: (fd: FormData) => Promise<void>;
}) {
  const pagina = `/studio/cms/${encodeURIComponent(id)}`;
  if (!confirmando) {
    return (
      <p className="st-actions">
        <a className="st-btn danger" href={`${pagina}?despublicar=1#${PAINEL}`}>
          Despublicar matéria
        </a>
      </p>
    );
  }
  return (
    <div id={PAINEL} tabIndex={-1} role="group" aria-labelledby="h-despublicar">
      {/* com erro na tela o foco é do aviso (Flash); o painel não o disputa */}
      {erroNaTela ? null : <FocarAoAbrir id={PAINEL} />}
      <h3 id="h-despublicar">Confirmar a despublicação?</h3>
      <p>
        A matéria sai do portal e das listagens públicas; cópias em cache podem levar alguns minutos. A nota fica no histórico. Publicações já feitas em redes sociais não são apagadas
        por aqui. Esta tela não devolve a matéria ao ar.
      </p>
      <form action={acao} aria-label="Despublicar a matéria">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="versao" value={versao} />
        <input type="hidden" name="confirmar" value="sim" />
        <div className="st-field">
          <label htmlFor="nota-despublicar">Nota da despublicação</label>
          <textarea id="nota-despublicar" name="nota" rows={3} maxLength={NOTA_MAX} aria-describedby="dica-despublicar" style={{ minHeight: 80 }} />
          <span id="dica-despublicar" className="st-hint">
            Obrigatória, de {NOTA_MIN} a {NOTA_MAX} caracteres. Não escreva dado pessoal nem segredo.
          </span>
        </div>
        <div className="st-actions">
          <a className="st-btn sec" href={pagina}>
            Cancelar
          </a>
          <button className="st-btn danger" type="submit">
            Confirmar despublicação
          </button>
        </div>
      </form>
    </div>
  );
}
