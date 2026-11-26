/**
 * Decisão da demonstração no portal, por ambiente de execução.
 * Staging SEMPRE mostra a faixa (inclusive com fonte api + seed); produção NUNCA.
 * Dev/vitrine com fonte mock continua mostrando, como antes.
 */
export interface AmbienteDemo {
  appEnv?: string;
  nodeEnv?: string;
  /** Constante de build da vitrine (PORTAL_VITRINE=1 + APP_ENV=staging). */
  portalDemo?: string;
  mock: boolean;
}

export function emDemonstracao({ appEnv, nodeEnv, portalDemo, mock }: AmbienteDemo): boolean {
  if (appEnv === 'staging') return true;
  return (nodeEnv !== 'production' || portalDemo === '1') && mock;
}
