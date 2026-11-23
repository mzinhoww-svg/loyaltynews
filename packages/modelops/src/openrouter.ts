// Contrato do cliente OpenRouter (DP-05): único acesso a modelos. Só o corpo e a checagem de evidência ficam aqui.
// Nenhuma chamada sai deste arquivo.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterBody {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  provider: {
    data_collection: 'deny'; // obrigatório em toda chamada
    require_parameters: true;
    zdr?: true; // exigido em trabalho editorial não publicado
  };
  // Proibidos pela política: lista de modelos (fallback silencioso) e plugins de busca web.
  models?: never;
  plugins?: never;
}

export interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: {
    cost?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  generation?: {
    model?: string;
    provider_name?: string;
    total_cost?: number;
    upstream_id?: string;
  };
}

export interface OpenRouterClient {
  chat(body: OpenRouterBody): Promise<OpenRouterResponse>;
}

export function buildRequestBody(p: {
  openrouterId: string;
  messages: ChatMessage[];
  maxTokens: number;
  zdrRequired: boolean;
}): OpenRouterBody {
  const body: OpenRouterBody = {
    model: p.openrouterId,
    messages: p.messages,
    max_tokens: p.maxTokens,
    provider: { data_collection: 'deny', require_parameters: true },
  };
  if (p.zdrRequired) body.provider.zdr = true;
  return body;
}

// Evidências exigidas pela política (review_evidence). Qualquer campo faltando invalida a saída.
export function checkEvidence(r: OpenRouterResponse): string[] {
  const missing: string[] = [];
  if (!r.id) missing.push('id');
  if (!r.model) missing.push('model');
  if (typeof r.usage?.cost !== 'number') missing.push('usage.cost');
  if (typeof r.usage?.prompt_tokens !== 'number') missing.push('usage.prompt_tokens');
  if (typeof r.usage?.completion_tokens !== 'number') missing.push('usage.completion_tokens');
  if (!r.generation) {
    missing.push('generation');
  } else {
    if (!r.generation.model || r.generation.model !== r.model) missing.push('generation.model');
    if (!r.generation.provider_name) missing.push('generation.provider_name');
    if (typeof r.generation.total_cost !== 'number') missing.push('generation.total_cost');
  }
  return missing;
}

// Status que garantem que a chamada NÃO foi cobrada. Qualquer outro erro depois do envio é incerto.
const NO_CHARGE_STATUSES: readonly number[] = [400, 401, 402, 403, 404, 422, 429];

export function isNoChargeStatus(status: number): boolean {
  return NO_CHARGE_STATUSES.includes(status);
}

// Rejeição com status sem cobrança: a reserva pode ser liberada e o fallback é seguro.
export class ProviderRejectedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`provedor rejeitou com HTTP ${status} (sem cobrança)`);
    this.name = 'ProviderRejectedError';
    this.status = status;
  }
}
