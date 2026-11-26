import { isEnabled } from '@ln/contracts';

/**
 * Flags do portal. As que existem em `@ln/contracts` (todas desligadas por padrão) vêm de lá.
 * As duas últimas (marketData, podcast) ainda não existem no contrato: ficam desligadas aqui até o Chief Architect
 * incluí-las em `packages/contracts/src/flags.ts` (pedido enviado ao PM/Arquiteto).
 * Formulários (`portalFormularios`) NÃO ficam aqui: esta constante é avaliada no carregamento do módulo (embutida no build). Quem precisa
 * da flag lê `formulariosAtivos()` (apps/web/lib/portal-formularios.ts), que consulta o resolvedor de execução.
 */
export const flags = {
  /** The Loyal (newsletter): construída, entrega desligada até P-01. */
  theLoyal: isEnabled('theLoyal'),
  /** Instagram: construído, desligado (P-02). */
  instagram: isEnabled('instagram'),
  /** TODO(contracts): `portalMarketData` — Market Data é fase 2. */
  marketData: false,
  /** TODO(contracts): `portalPodcast` — Loyalty Talks sem episódios reais. */
  podcast: false,
} as const;
