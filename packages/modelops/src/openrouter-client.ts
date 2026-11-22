// Seleção do cliente. Padrão: simulado. Real só com a flag modelosHabilitados ligada (@ln/contracts) E chave.
// A implementação real não foi exercitada contra a API: os testes usam fetch injetado.
import { isEnabled, type FlagState } from '@ln/contracts';
import { isNoChargeStatus, ProviderRejectedError, type OpenRouterBody, type OpenRouterClient, type OpenRouterResponse } from './openrouter';
import { SimulatedOpenRouterClient } from './openrouter.mock';
import { realCallsAllowed } from './policy';

export interface ClientConfig {
  policy: { rules: { production_enabled: boolean } }; // production_enabled da política
  apiKey?: string;
  flags?: Partial<FlagState>;
}

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';

// Prazo de resposta: estourar o prazo depois do envio é resultado incerto, não falha limpa.
const CHAT_TIMEOUT_MS = 120_000;

export function createRealOpenRouterClient(key: string, fetchImpl: typeof fetch): OpenRouterClient {
  return {
    async chat(body: OpenRouterBody): Promise<OpenRouterResponse> {
      let res: Response;
      try {
        res = await fetchImpl(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
        });
      } catch {
        // Erro de rede ou prazo: pode ter sido cobrado. A mensagem não traz a chave nem o corpo.
        throw new Error('OpenRouter: falha de rede ou prazo depois do envio (incerto)');
      }
      if (!res.ok) {
        if (isNoChargeStatus(res.status)) throw new ProviderRejectedError(res.status);
        throw new Error(`OpenRouter respondeu HTTP ${res.status} (incerto)`);
      }
      try {
        return (await res.json()) as OpenRouterResponse;
      } catch {
        // HTTP aceito e resposta ilegível: houve cobrança possível. Incerto, nunca "sem custo".
        throw new Error('OpenRouter: resposta ilegível após HTTP aceito (incerto)');
      }
    },
  };
}

// Leitor do saldo (consulta gratuita). Formato da resposta: data.total_credits e data.total_usage.
// Formato ainda não conferido contra a documentação oficial; qualquer desvio falha fechado.
export function createOpenRouterCreditsReader(key: string, fetchImpl: typeof fetch): () => Promise<number> {
  return async () => {
    const res = await fetchImpl(OPENROUTER_CREDITS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`leitura de saldo: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { total_credits?: unknown; total_usage?: unknown } };
    const total = json.data?.total_credits;
    const used = json.data?.total_usage;
    if (typeof total !== 'number' || typeof used !== 'number') throw new Error('leitura de saldo: formato inesperado');
    return total - used;
  };
}

// Padrão: simulado. Flag desligada nunca usa a rede. Flag ligada sem chave é erro explícito.
export function selectClient(config: ClientConfig, fetchImpl: typeof fetch = fetch): OpenRouterClient {
  if (!realCallsAllowed(config.policy, isEnabled('modelosHabilitados', config.flags))) return new SimulatedOpenRouterClient();
  if (!config.apiKey) throw new Error('chamadas de modelo habilitadas, mas a chave do OpenRouter está ausente');
  return createRealOpenRouterClient(config.apiKey, fetchImpl);
}
