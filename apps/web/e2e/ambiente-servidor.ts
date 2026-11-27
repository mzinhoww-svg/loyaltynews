/**
 * Ambiente EFETIVO do servidor sob teste. Fonte única para o portal.config.ts (que sobe o servidor) e para as specs que escolhem
 * testes conforme o ambiente: calculado em dois lugares, a spec do mídia kit selecionava os testes do formulário ligado contra um
 * servidor com ele desligado (QA 8, qa8-95efe365).
 */
import { resolveFlags } from '@ln/contracts/flags';

type Env = Record<string, string | undefined>;

/**
 * APP_ENV com que o servidor sobe: mock nunca roda como produção (resolveSourceKind recusa); nos demais modos vale PORTAL_APP_ENV.
 * O APP_ENV herdado do terminal não entra: o portal.config.ts o sobrescreve.
 */
export function appEnvDoServidor(env: Env): string {
  return env.PORTAL_MODE === 'mock' ? 'staging' : (env.PORTAL_APP_ENV ?? 'production');
}

/**
 * portalFormularios no servidor, pelo mesmo resolvedor que ele usa (ADR-022). PORTAL_FORMS_E2E=1 só declara o estado de um servidor
 * externo (PORTAL_BASE_URL), cujo ambiente a suíte não controla.
 */
export function formulariosNoServidor(env: Env): boolean {
  if (env.PORTAL_BASE_URL && env.PORTAL_FORMS_E2E === '1') return true;
  return resolveFlags({ APP_ENV: appEnvDoServidor(env), LN_FLAGS_ON: env.LN_FLAGS_ON }).state.portalFormularios;
}
