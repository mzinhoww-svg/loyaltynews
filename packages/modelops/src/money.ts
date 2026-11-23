// Aritmética monetária inteira em micro-USD (1 USD = 1.000.000 micro). Sem ponto flutuante no orçamento.

export const MICRO_PER_USD = 1_000_000;

export function usdToMicro(usd: number): number {
  return Math.round(usd * MICRO_PER_USD);
}

export function microToUsd(micro: number): number {
  return micro / MICRO_PER_USD;
}

// Preço USD por milhão de tokens -> micro-USD por milhão de tokens (inteiro).
export function priceToMicroPerMtok(usdPerMtok: number): number {
  return Math.round(usdPerMtok * MICRO_PER_USD);
}

// Custo em micro-USD de `tokens` a `microPerMtok`. Arredonda para cima: reserva nunca subestima.
export function tokensToMicro(tokens: number, microPerMtok: number): number {
  return Math.ceil((tokens * microPerMtok) / MICRO_PER_USD);
}
