/**
 * Protocolo público e estável do pedido do titular (DP-38): `LN-` + os 12 primeiros hex do id, em maiúsculas.
 *
 * É o MESMO texto nos dois lados: a rota pública devolve este protocolo no 202 e o Studio o deriva do id da fila.
 * Regra única aqui (P3 do QA 9): não duplicar em `api/_lib/titular.ts` nem em `lib/studio/titular-view.ts`.
 * Não é credencial: sozinho não abre o pedido; quem valida é a rota/consulta pelo id.
 */
export function protocoloDoPedido(id: string): string {
  return `LN-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

/** Nome usado pelo canal público; mesma função. */
export const protocoloDe = protocoloDoPedido;
