// Fonte das métricas do canal LinkedIn (mLabs) para o resumo do Social Dashboard. SOMENTE LEITURA: o transporte é o MCP por HTTP de
// @ln/growth, que só deixa passar ferramentas da lista de leitura (create_post, prepare_media_upload e qualquer escrita lançam antes da rede).
// Credencial por ambiente (cofre): `MLABS_MCP_TOKEN` (segredo; nunca logado) e, opcionalmente, `MLABS_MCP_URL` (HTTPS; padrão o conector do
// mLabs) e `MLABS_PROFILE_ID` + `MLABS_CHANNEL_ID` (ids opacos; sem eles são descobertos por leitura). Sem o token, não há fonte: o resumo
// diz "não configurada", como antes. NÃO VERIFICADO: se o mLabs aceita token estático de servidor (a conexão do OpenBot usa login interativo).
import { createMlabsMetricsSource, createReadOnlyMlabsMcpTransport, type SocialMetricsSource } from '@ln/growth';

export const MLABS_MCP_DEFAULT_URL = 'https://mcp.mlabs.io/mcp';

type Env = Record<string, string | undefined>;

/** Cria a fonte a partir do ambiente, ou `undefined` (sem token ou configuração inválida: falha fechada, sem erro para o painel). */
export function metricsSourceFromEnv(env: Env = process.env): SocialMetricsSource | undefined {
  const token = env.MLABS_MCP_TOKEN;
  if (!token) return undefined;
  try {
    const transport = createReadOnlyMlabsMcpTransport({ url: env.MLABS_MCP_URL || MLABS_MCP_DEFAULT_URL, token });
    const ids = env.MLABS_PROFILE_ID && env.MLABS_CHANNEL_ID ? { profileId: env.MLABS_PROFILE_ID, channelId: env.MLABS_CHANNEL_ID } : {};
    return createMlabsMetricsSource({ transport, now: () => new Date(), ...ids });
  } catch {
    return undefined;
  }
}

// Uma fonte por processo (o cache de 5 min e a sessão MCP vivem nela). Recriada se o ambiente mudar.
let cached: { url: string | undefined; token: string; ids: string; src: SocialMetricsSource | undefined } | null = null;
let forced: SocialMetricsSource | null | undefined;

export function getMetricsSource(env: Env = process.env): SocialMetricsSource | undefined {
  if (forced !== undefined) return forced ?? undefined;
  const token = env.MLABS_MCP_TOKEN ?? '';
  const ids = `${env.MLABS_PROFILE_ID ?? ''}|${env.MLABS_CHANNEL_ID ?? ''}`;
  if (!cached || cached.token !== token || cached.url !== env.MLABS_MCP_URL || cached.ids !== ids) {
    cached = { url: env.MLABS_MCP_URL, token, ids, src: metricsSourceFromEnv(env) };
  }
  return cached.src;
}

/** Só testes: força a fonte (`null` = nenhuma; `undefined` = volta ao ambiente). */
export function setMetricsSourceForTest(src: SocialMetricsSource | null | undefined): void {
  forced = src;
  cached = null;
}
