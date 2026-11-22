// Seleção do cliente. Padrão: simulado. Real só com LN_MODELOPS_REAL_CALLS=1 E OPENROUTER_API_KEY.
// A implementação real não foi exercitada contra a API: testes usam fetch injetado.
import type { OpenRouterBody, OpenRouterClient, OpenRouterResponse } from './openrouter.ts';
import { SimulatedOpenRouterClient } from './openrouter.mock.ts';

export interface ClientEnv {
  LN_MODELOPS_REAL_CALLS?: string;
  OPENROUTER_API_KEY?: string;
}

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export function createRealOpenRouterClient(key: string, fetchImpl: typeof fetch): OpenRouterClient {
  return {
    async chat(body: OpenRouterBody): Promise<OpenRouterResponse> {
      const res = await fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      // A mensagem de erro não inclui a chave nem o corpo da requisição.
      if (!res.ok) throw new Error(`OpenRouter respondeu HTTP ${res.status}`);
      return (await res.json()) as OpenRouterResponse;
    },
  };
}

// Padrão: simulado. Flag ligada sem chave é erro explícito, nunca cai em simulado em silêncio.
export function selectClient(env: ClientEnv, fetchImpl: typeof fetch = fetch): OpenRouterClient {
  if (env.LN_MODELOPS_REAL_CALLS !== '1') return new SimulatedOpenRouterClient();
  if (!env.OPENROUTER_API_KEY) throw new Error('chamadas reais ligadas, mas OPENROUTER_API_KEY ausente');
  return createRealOpenRouterClient(env.OPENROUTER_API_KEY, fetchImpl);
}
