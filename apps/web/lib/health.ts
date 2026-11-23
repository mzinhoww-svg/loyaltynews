export interface HealthPayload {
  status: 'ok';
  service: 'loyaltynews-web';
  /** Commit da versão em execução (APP_COMMIT, definido no deploy). */
  version: string;
  /** Ambiente (APP_ENV: homologacao, producao, ci...). */
  env: string;
}

/** Corpo público de /api/health. Não expõe segredo nem estado de flags. */
export function healthPayload(env: Record<string, string | undefined>): HealthPayload {
  return {
    status: 'ok',
    service: 'loyaltynews-web',
    version: env.APP_COMMIT?.trim() || 'unknown',
    env: env.APP_ENV?.trim() || 'local',
  };
}
