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

/** Rótulo que o seed de staging põe no começo de todo texto de conteúdo (apps/workers/src/seed-staging.ts, SEED_LABEL). */
const ROTULO_DEMO = /^\s*\[\s*DEMO\b(?=\s*[\]·:-])/i;

/** A MATÉRIA é de demonstração? Decidido pelo próprio conteúdo (fixture MOCK ou rótulo do seed), nunca pelo ambiente: conteúdo real em staging não muda. */
export function ehConteudoDemo({ title, mock }: { title: string; mock?: boolean }): boolean {
  return mock === true || ROTULO_DEMO.test(title);
}

/**
 * Assinatura como a tela a mostra. Em demonstração ela é marcada (auditoria de estado honesto, 26/11, P2): a assinatura institucional é
 * verdadeira, o conteúdo não. A marca vem NA FRENTE: no cartão o nome corta com reticências e o que fica no fim some.
 */
export function assinaturaExibida(a: { title: string; mock?: boolean; authorLabel: string }): string {
  return ehConteudoDemo(a) ? `Demonstração: ${a.authorLabel}` : a.authorLabel;
}
