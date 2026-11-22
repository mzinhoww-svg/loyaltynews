// Inventário publicitário: posições de banner, reservas, disponibilidade e conflito (Blueprint v2.0 §4 "Inventário, regras e cálculo de receita").
export interface BannerPosition {
  id: string; name: string; formatId: string;
  /** null = a especificar por breakpoint */
  desktop: string | null;
  mobile: string[];
  /** Cotas simultâneas; null = parametrizável, ainda não configurado => não reservável. */
  slotLimit: number | null;
  maxWeightKB: number | null; minContractDays: number | null;
  allowedTypes: string[];
}
const TYPES = ['JPG', 'PNG', 'GIF', 'HTML5-sandbox'];
const MOB = ['320x100', '300x250'];
export const POSITIONS: readonly BannerPosition[] = [
  { id: 'TOP', name: 'Banner topo', formatId: 'banners--banner-topo', desktop: '1280x150', mobile: MOB, slotLimit: 4, maxWeightKB: 200, minContractDays: 90, allowedTypes: TYPES },
  { id: 'SIDEBAR_1', name: 'Sidebar 1', formatId: 'banners--retangulo-sidebar', desktop: '336x280', mobile: MOB, slotLimit: 10, maxWeightKB: 150, minContractDays: 30, allowedTypes: TYPES },
  { id: 'SIDEBAR_2', name: 'Sidebar 2', formatId: 'banners--retangulo-sidebar', desktop: '336x280', mobile: MOB, slotLimit: 10, maxWeightKB: 150, minContractDays: 30, allowedTypes: TYPES },
  { id: 'SIDEBAR_3', name: 'Sidebar 3', formatId: 'banners--retangulo-sidebar', desktop: '336x280', mobile: MOB, slotLimit: 10, maxWeightKB: 150, minContractDays: 30, allowedTypes: TYPES },
  { id: 'FOOTER', name: 'Banner rodapé', formatId: 'banners--banner-rodape', desktop: '1280x200', mobile: MOB, slotLimit: 6, maxWeightKB: 200, minContractDays: 30, allowedTypes: TYPES },
  { id: 'ARTICLE_INLINE', name: 'Banner dentro do artigo', formatId: 'banners--banner-dentro-do-artigo', desktop: null, mobile: [], slotLimit: null, maxWeightKB: null, minContractDays: null, allowedTypes: TYPES },
  { id: 'HOME_BETWEEN', name: 'Banner entre seções da home', formatId: 'banners--banner-entre-secoes-da-home', desktop: null, mobile: [], slotLimit: null, maxWeightKB: null, minContractDays: null, allowedTypes: TYPES },
  { id: 'AGENDA', name: 'Banner na agenda', formatId: 'banners--banner-na-agenda', desktop: null, mobile: [], slotLimit: null, maxWeightKB: null, minContractDays: null, allowedTypes: TYPES },
  { id: 'DATA', name: 'Patrocínio Loyalty Market Data', formatId: 'banners--patrocinio-loyalty-market-data', desktop: null, mobile: [], slotLimit: null, maxWeightKB: null, minContractDays: null, allowedTypes: TYPES },
];

export type ReservationStatus = 'held' | 'confirmed' | 'cancelled';
export interface Reservation {
  id: string; positionId: string; advertiserId: string; campaignId: string | null;
  /** Datas de calendário inclusivas, YYYY-MM-DD. */
  startDate: string; endDate: string; status: ReservationStatus;
}
export interface Takeover { id: string; date: string; advertiserId: string; agreedCampaignIds: string[]; }

export type InventoryErrorCode = 'POSITION_UNKNOWN' | 'POSITION_NOT_CONFIGURED' | 'INVALID_PERIOD' | 'MIN_CONTRACT' | 'NO_SLOT' | 'TAKEOVER_BLOCK' | 'TAKEOVER_CONFLICT';
export class InventoryError extends Error {
  code: InventoryErrorCode;
  constructor(code: InventoryErrorCode, msg: string) { super(msg); this.code = code; }
}

const DAY = 86_400_000;
const parse = (d: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new InventoryError('INVALID_PERIOD', `Data inválida: ${d}`);
  const t = Date.parse(d + 'T00:00:00Z');
  if (Number.isNaN(t)) throw new InventoryError('INVALID_PERIOD', `Data inválida: ${d}`);
  return t;
};
export const daysInclusive = (s: string, e: string): number => {
  const n = (parse(e) - parse(s)) / DAY + 1;
  if (n < 1) throw new InventoryError('INVALID_PERIOD', 'Fim anterior ao início');
  return n;
};
const overlaps = (aS: string, aE: string, bS: string, bE: string) => parse(aS) <= parse(bE) && parse(bS) <= parse(aE);

export class InventoryBook {
  private reservations: Reservation[] = [];
  private takeovers: Takeover[] = [];
  private seq = 0;
  private positions: readonly BannerPosition[];
  constructor(positions: readonly BannerPosition[] = POSITIONS) { this.positions = positions; }

  position(id: string): BannerPosition {
    const p = this.positions.find((x) => x.id === id);
    if (!p) throw new InventoryError('POSITION_UNKNOWN', `Posição desconhecida: ${id}`);
    return p;
  }
  list(): readonly Reservation[] { return this.reservations; }
  listTakeovers(): readonly Takeover[] { return this.takeovers; }
  private active(positionId: string) { return this.reservations.filter((r) => r.positionId === positionId && r.status !== 'cancelled'); }

  /** Cotas ocupadas no pior dia do período (pico) e livres. slotLimit null => não configurado (free = null). */
  availability(positionId: string, startDate: string, endDate: string) {
    const p = this.position(positionId);
    const days = daysInclusive(startDate, endDate);
    let peak = 0;
    const rs = this.active(positionId).filter((r) => overlaps(r.startDate, r.endDate, startDate, endDate));
    for (let i = 0; i < days; i++) {
      const day = new Date(parse(startDate) + i * DAY).toISOString().slice(0, 10);
      const used = rs.filter((r) => overlaps(r.startDate, r.endDate, day, day)).length;
      if (used > peak) peak = used;
    }
    const blockedByTakeover = this.takeovers.some((t) => overlaps(t.date, t.date, startDate, endDate));
    return {
      positionId, startDate, endDate, slotLimit: p.slotLimit, peakUsed: peak,
      free: p.slotLimit === null ? null : Math.max(0, p.slotLimit - peak),
      configured: p.slotLimit !== null, blockedByTakeover,
      note: p.slotLimit === null ? 'Posição parametrizável ainda sem limite/dimensões configurados: não reservável.' : undefined,
    };
  }

  /** Uso por dia (cotas ocupadas) em [startDate, endDate], até 366 dias; marca dias com takeover. */
  dailyUsage(positionId: string, startDate: string, endDate: string) {
    const p = this.position(positionId);
    const days = daysInclusive(startDate, endDate);
    if (days > 366) throw new InventoryError('INVALID_PERIOD', 'Janela máxima de 366 dias.');
    const rs = this.active(positionId);
    return Array.from({ length: days }, (_, i) => {
      const date = new Date(parse(startDate) + i * DAY).toISOString().slice(0, 10);
      const used = rs.filter((r) => overlaps(r.startDate, r.endDate, date, date)).length;
      return { date, used, free: p.slotLimit === null ? null : Math.max(0, p.slotLimit - used), takeover: this.takeovers.some((t) => t.date === date) };
    });
  }

  /** Transação síncrona: valida período, contrato mínimo, cotas e takeover antes de gravar. */
  reserve(input: { positionId: string; advertiserId: string; campaignId?: string | null; startDate: string; endDate: string; status?: ReservationStatus }): Reservation {
    const p = this.position(input.positionId);
    if (p.slotLimit === null || p.minContractDays === null) throw new InventoryError('POSITION_NOT_CONFIGURED', `${p.id} sem parâmetros configurados.`);
    const days = daysInclusive(input.startDate, input.endDate);
    if (days < p.minContractDays) throw new InventoryError('MIN_CONTRACT', `${p.id} exige mínimo de ${p.minContractDays} dias; pedido: ${days}.`);
    const t = this.takeovers.find((x) => overlaps(x.date, x.date, input.startDate, input.endDate) && x.advertiserId !== input.advertiserId);
    if (t) throw new InventoryError('TAKEOVER_BLOCK', `Takeover em ${t.date} bloqueia reservas concorrentes.`);
    if (this.availability(p.id, input.startDate, input.endDate).free === 0) throw new InventoryError('NO_SLOT', `${p.id} sem cota livre no período.`);
    const r: Reservation = { id: `res-${++this.seq}`, positionId: p.id, advertiserId: input.advertiserId, campaignId: input.campaignId ?? null, startDate: input.startDate, endDate: input.endDate, status: input.status ?? 'held' };
    this.reservations.push(r);
    return r;
  }
  cancel(id: string): void { const r = this.reservations.find((x) => x.id === id); if (r) r.status = 'cancelled'; }

  /** Takeover (exclusividade por dia): reservas de outros anunciantes no dia exigem acordo explícito (agreedCampaignIds). */
  reserveTakeover(input: { date: string; advertiserId: string; agreedCampaignIds?: string[] }): Takeover {
    parse(input.date);
    if (this.takeovers.some((t) => t.date === input.date)) throw new InventoryError('TAKEOVER_BLOCK', `Já existe takeover em ${input.date}.`);
    const agreed = new Set(input.agreedCampaignIds ?? []);
    const conflicts = this.reservations.filter((r) => r.status !== 'cancelled' && r.advertiserId !== input.advertiserId && overlaps(r.startDate, r.endDate, input.date, input.date) && !(r.campaignId && agreed.has(r.campaignId)));
    if (conflicts.length) throw new InventoryError('TAKEOVER_CONFLICT', `Takeover em ${input.date} conflita com ${conflicts.length} reserva(s) sem acordo.`);
    const t: Takeover = { id: `tko-${++this.seq}`, date: input.date, advertiserId: input.advertiserId, agreedCampaignIds: [...agreed] };
    this.takeovers.push(t);
    return t;
  }
}

/** Capacidade teórica bruta dos slots principais (TOP, SIDEBAR_1-3, FOOTER) a 100% vendido avulso. NÃO é previsão. */
export function theoreticalGrossCapacity(price: { top: number; sidebar: number; footer: number } = { top: 3000, sidebar: 1750, footer: 1250 }, occupancy = 1) {
  const gross = 4 * price.top + 3 * 10 * price.sidebar + 6 * price.footer;
  return { grossBRLMonth: gross * occupancy, occupancy, label: 'Cenário matemático, não é previsão de faturamento; pacotes não somam sobre as mesmas cotas.' };
}
