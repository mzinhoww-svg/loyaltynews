// ACOPLAMENTO ISOLADO: as classes do domínio comercial (@ln/commercial) guardam estado em campos privados e não têm
// API de carga. Para hidratar do banco precisamos escrevê-los. Todo acesso fica aqui, com checagem em tempo de
// execução (se a Frente 10 renomear um campo, falha na hora, não corrompe dado) e testes. Pedido à Frente 10:
// expor `load()`/`snapshot()` oficiais; quando existirem, este arquivo some.
import type {
  AdServer, CampaignBook, Creative, Crm, DeliveryCounters, InventoryBook, Reservation, Takeover, Campaign,
} from '@ln/commercial';

interface InvInternals { reservations: Reservation[]; takeovers: Takeover[]; seq: number }
interface CampInternals { items: Map<string, Campaign>; seq: number }
interface CrmInternals { seq: number }
interface AdsInternals {
  creatives: Creative[]; counters: Map<string, DeliveryCounters>;
  credit: Map<string, number>; views: Map<string, string>; impressionCreative: Map<string, string>;
  visibleSet: Set<string>; clickedSet: Set<string>; seq: number;
}

function need<T extends object>(o: unknown, keys: (keyof T)[], what: string): T {
  const x = o as Record<string, unknown>;
  for (const k of keys) {
    if (!(String(k) in x)) throw new Error(`@ln/commercial mudou: ${what} sem o campo interno "${String(k)}"`);
  }
  return o as T;
}

export const inv = (b: InventoryBook) => need<InvInternals>(b, ['reservations', 'takeovers', 'seq'], 'InventoryBook');
export const camp = (b: CampaignBook) => need<CampInternals>(b, ['items', 'seq'], 'CampaignBook');
export const crmSeq = (c: Crm) => need<CrmInternals>(c, ['seq'], 'Crm');
export const ads = (a: AdServer) =>
  need<AdsInternals>(a, ['creatives', 'counters', 'credit', 'views', 'impressionCreative', 'visibleSet', 'clickedSet', 'seq'], 'AdServer');

/** Maior sufixo numérico entre ids no formato `prefixo-N` (ids de outro formato são ignorados). */
export function maxSeq(ids: Iterable<string>): number {
  let max = 0;
  for (const id of ids) {
    const m = /-(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}
