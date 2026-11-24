// Contexto de execução dos handlers e das consultas. Os handlers são puros em relação a I/O: recebem o estado do domínio e
// devolvem resultado. O Backend hidrata este contexto do banco (schema em @ln/db: packages/db/src/schema/commercial.ts) e persiste o que mudou;
// enquanto não há repositório, `createCommercialState()` entrega o estado em memória (testes e desenvolvimento).
import type { FlagState } from '@ln/contracts';
import { CATALOG } from './catalog';
import { CampaignBook } from './campaigns';
import { Crm } from './crm';
import { InventoryBook } from './inventory';
import { MetricStore } from './metrics';
import { AdServer } from './rotation';
import type { CommercialFormat } from './types';
import type { DeliveryRow } from './report';

export interface Actor {
  id: string;
  /** Calculado pelo Backend (papel comercial/admin). Handlers de Studio exigem true. */
  canManageCommercial: boolean;
  /**
   * DP-43: aprovar cada imagem (criativo) e cada campanha é só do proprietário (papel admin). Calculado pelo Backend.
   * Ausente ou false = não aprova (falha fechada). O comercial prepara e envia; não aprova.
   */
  canApprove?: boolean;
}

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
  /**
   * Linhas diárias de entrega (ad_delivery_daily) para o relatório do anunciante. Opcional: quem hidrata o contexto (Backend) preenche;
   * sem isso o relatório diz "sem entrega registrada" (nunca inventa número).
   */
  delivery?: readonly DeliveryRow[];
}

export function createCommercialState(): CommercialState {
  return { catalog: CATALOG, crm: new Crm(), inventory: new InventoryBook(), campaigns: new CampaignBook(), ads: new AdServer(), metrics: new MetricStore() };
}
export function makeCtx(state: CommercialState, extra: { now: string; today?: string; flags?: Partial<FlagState>; actor?: Actor; delivery?: readonly DeliveryRow[] }): CommercialCtx {
  return { ...state, now: extra.now, today: extra.today ?? extra.now.slice(0, 10), flags: extra.flags ?? {}, actor: extra.actor, delivery: extra.delivery };
}

// ---------- snapshot do estado inteiro ----------
import type { CrmSnapshot } from './crm';
import type { InventorySnapshot } from './inventory';
import type { CampaignSnapshot } from './campaigns';
import type { AdServerSnapshot } from './rotation';
import type { MetricSnapshot } from './metrics';
export interface CommercialSnapshot { crm: CrmSnapshot; inventory: InventorySnapshot; campaigns: CampaignSnapshot; ads: AdServerSnapshot; metrics: MetricSnapshot }
export const snapshotState = (s: CommercialState): CommercialSnapshot => ({ crm: s.crm.snapshot(), inventory: s.inventory.snapshot(), campaigns: s.campaigns.snapshot(), ads: s.ads.snapshot(), metrics: s.metrics.snapshot() });
/** Carrega num estado existente (as instâncias são preservadas). Se um dos snapshots for inválido, nada do restante é alterado antes da validação. */
export function loadState(s: CommercialState, snap: CommercialSnapshot): void {
  // valida tudo numa cópia descartável antes de tocar o estado real (atomicidade)
  const probe = createCommercialState();
  probe.crm.load(snap.crm); probe.inventory.load(snap.inventory); probe.campaigns.load(snap.campaigns); probe.ads.load(snap.ads); probe.metrics.load(snap.metrics);
  s.crm.load(snap.crm); s.inventory.load(snap.inventory); s.campaigns.load(snap.campaigns); s.ads.load(snap.ads); s.metrics.load(snap.metrics);
}
