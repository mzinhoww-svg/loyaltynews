/**
 * Protocolo público e estável do pedido do titular (DP-38): `LN-` + os 12 primeiros hex do id, em maiúsculas.
 *
 * É o MESMO texto nos dois lados: a rota pública devolve este protocolo no 202 e o Studio o deriva do id da fila.
 * Regra única aqui (P3 do QA 9): geração E validação. Não duplicar em `api/_lib/titular.ts`, `lib/studio/titular-view.ts`
 * nem em `app/(portal)/_titular/pedido.ts`. Não é credencial: sozinho não abre o pedido; quem valida é a rota/consulta pelo id.
 */
const PROTOCOLO_PREFIXO = 'LN-';
const PROTOCOLO_HEX = 12;

/** Forma do protocolo: prefixo, 12 hex maiúsculos e nada mais. Usado também pelo parser do portal. */
export const PROTOCOLO_RE = new RegExp(`^${PROTOCOLO_PREFIXO}[0-9A-F]{${PROTOCOLO_HEX}}$`);

/** Valida a forma do protocolo (não consulta o pedido; a rota/consulta é que decide existência). */
export function protocoloValido(valor: string): boolean {
  return PROTOCOLO_RE.test(valor);
}

export function protocoloDoPedido(id: string): string {
  return `${PROTOCOLO_PREFIXO}${id.replace(/-/g, '').slice(0, PROTOCOLO_HEX).toUpperCase()}`;
}

/** Nome usado pelo canal público; mesma função. */
export const protocoloDe = protocoloDoPedido;
