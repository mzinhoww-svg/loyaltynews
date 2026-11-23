// Estimativa do teto de uma chamada (reserva) em micro-USD. Arredonda para cima e escolhe a faixa de preço
// pelo tamanho do contexto (long_context_overrides). Incerteza = reserva na faixa mais cara.
import { priceToMicroPerMtok, tokensToMicro } from './money';
import type { ModelEntry, PriceTier } from './types';

export interface TokenEstimate {
  promptTokens: number; // entrada sem cache
  cacheWriteTokens: number; // tokens gravados no cache nesta chamada
  cacheReadTokens: number; // tokens lidos do cache
  maxOutputTokens: number; // limite de saída (max_tokens)
  uncertain: boolean; // estimativa incerta: reserva na faixa mais cara
}

// Custo máximo em micro-USD, ou null se algum preço necessário faltar (custo desconhecido).
export function estimateMicro(model: ModelEntry, est: TokenEstimate): number | null {
  const binding = model.binding;
  if (!binding) return null;
  const base = binding.price_usd_per_mtok;
  const overrides = binding.long_context_overrides ?? [];
  const total = est.promptTokens + est.cacheWriteTokens + est.cacheReadTokens;

  let tiers: PriceTier[];
  if (est.uncertain) {
    tiers = [base, ...overrides];
  } else {
    // Faixa aplicável: a de maior limite inferior já atingido; senão a base.
    let chosen: PriceTier = base;
    let chosenMin = -1;
    for (const o of overrides) {
      const min = o.min_prompt_tokens ?? Number.POSITIVE_INFINITY;
      if (min <= total && min > chosenMin) {
        chosen = o;
        chosenMin = min;
      }
    }
    tiers = [chosen];
  }

  let worst = 0;
  for (const tier of tiers) {
    const c = tierCostMicro(tier, base, est);
    if (c === null) return null;
    worst = Math.max(worst, c);
  }
  return worst;
}

function tierCostMicro(tier: PriceTier, base: PriceTier, est: TokenEstimate): number | null {
  const input = tier.input ?? base.input;
  const output = tier.output ?? base.output;
  const cacheWrite = tier.cache_write ?? base.cache_write;
  const cacheRead = tier.cache_read ?? base.cache_read;
  if (input === undefined || output === undefined) return null;
  if (est.cacheWriteTokens > 0 && cacheWrite === undefined) return null;
  if (est.cacheReadTokens > 0 && cacheRead === undefined) return null;

  let sum = tokensToMicro(est.promptTokens, priceToMicroPerMtok(input));
  sum += tokensToMicro(est.maxOutputTokens, priceToMicroPerMtok(output));
  if (est.cacheWriteTokens > 0 && cacheWrite !== undefined) {
    sum += tokensToMicro(est.cacheWriteTokens, priceToMicroPerMtok(cacheWrite));
  }
  if (est.cacheReadTokens > 0 && cacheRead !== undefined) {
    sum += tokensToMicro(est.cacheReadTokens, priceToMicroPerMtok(cacheRead));
  }
  return sum;
}
