export interface HealthPayload {
  status: 'ok';
  service: 'loyaltynews-web';
  /** Commit da versão em execução (APP_COMMIT, definido no deploy). */
  version: string;
  /** Ambiente (APP_ENV: homologacao, producao, ci...). */
  env: string;
  /** Flags de produto ligadas (ADR-022, N8): só nomes, sem decisão nem origem. */
  flags: string[];
}

/** Corpo público de /api/health. Não expõe segredo; das flags, só os nomes ligados (N8). */
export function healthPayload(env: Record<string, string | undefined>, flags: readonly string[] = []): HealthPayload {
  return {
    status: 'ok',
    service: 'loyaltynews-web',
    version: env.APP_COMMIT?.trim() || 'unknown',
    env: env.APP_ENV?.trim() || 'local',
    flags: [...flags],
  };
}
