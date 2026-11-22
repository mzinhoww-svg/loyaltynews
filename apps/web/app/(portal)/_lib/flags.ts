import { isEnabled } from '@ln/contracts';

/**
 * Flags do portal. As que existem em `@ln/contracts` (todas desligadas por padrão) vêm de lá.
 * As três últimas ainda não existem no contrato: ficam desligadas aqui até o Chief Architect
 * incluí-las em `packages/contracts/src/flags.ts` (pedido enviado ao PM/Arquiteto).
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
  /** TODO(contracts): `portalFormularios` — formulários dependem de API (contato, proposta). */
  forms: false,
} as const;
