// Contexto de execução dos handlers e das consultas. Os handlers são puros em relação a I/O: recebem o estado do domínio e
// devolvem resultado. O Backend hidrata este contexto do banco (schema em db-schema.proposto.ts) e persiste o que mudou;
// enquanto não há repositório, `createCommercialState()` entrega o estado em memória (testes e desenvolvimento).
import type { FlagState } from '@ln/contracts';
import { CATALOG } from './catalog.js';
import { CampaignBook } from './campaigns.js';
import { Crm } from './crm.js';
import { InventoryBook } from './inventory.js';
import { MetricStore } from './metrics.js';
import { AdServer } from './rotation.js';
import type { CommercialFormat } from './types.js';

export interface Actor { id: string; /** Calculado pelo Backend (papel comercial/admin). Handlers de Studio exigem true. */ canManageCommercial: boolean }

export interface CommercialState {
  catalog: readonly CommercialFormat[];
  crm: Crm; inventory: InventoryBook; campaigns: CampaignBook; ads: AdServer; metrics: MetricStore;
}
export interface CommercialCtx extends CommercialState {
  /** ISO-8601 com offset. Injetado: handlers não leem relógio. */
  now: string;
  /** Data de calendário em America/Sao_Paulo (YYYY-MM-DD). */
  today: string;
  flags: Partial<FlagState>;
  actor?: Actor;
}

export function createCommercialState(): CommercialState {
  return { catalog: CATALOG, crm: new Crm(), inventory: new InventoryBook(), campaigns: new CampaignBook(), ads: new AdServer(), metrics: new MetricStore() };
}
export function makeCtx(state: CommercialState, extra: { now: string; today?: string; flags?: Partial<FlagState>; actor?: Actor }): CommercialCtx {
  return { ...state, now: extra.now, today: extra.today ?? extra.now.slice(0, 10), flags: extra.flags ?? {}, actor: extra.actor };
}
