export interface HealthPayload {
  status: 'ok';
  service: 'loyaltynews-web';
  flagsLigadas: string[];
}

/** Corpo da rota /api/health: nunca expõe segredo; só lista flags ligadas (todas desligadas por padrão). */
export function healthPayload(flags: Record<string, boolean>): HealthPayload {
  return {
    status: 'ok',
    service: 'loyaltynews-web',
    flagsLigadas: Object.entries(flags)
      .filter(([, v]) => v)
      .map(([k]) => k),
  };
}
