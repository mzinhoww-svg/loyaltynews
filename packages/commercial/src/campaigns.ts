// Campanhas: máquina de estados draft/reserved/approved/active/paused/completed/cancelled.
// Regra: lead não cria reserva até aprovação; ativação exige reserva e aprovação do cliente.
import type { Reservation } from './inventory';
import type { FormatStatus } from './types';

export type CampaignStatus = 'draft' | 'reserved' | 'approved' | 'active' | 'paused' | 'completed' | 'cancelled';

const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['reserved', 'cancelled'],
  reserved: ['approved', 'cancelled'],
  approved: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export interface Campaign {
  id: string; name: string; accountId: string; opportunityId: string | null;
  formatId: string; positionId: string | null;
  startDate: string; endDate: string; status: CampaignStatus;
  reservationIds: string[];
  /** Conteúdo patrocinado precisa de rótulo ostensivo. */
  sponsoredLabel: boolean;
  history: { from: CampaignStatus | null; to: CampaignStatus; at: string; note?: string }[];
}

export class CampaignError extends Error {
  code: 'BAD_TRANSITION' | 'NO_RESERVATION' | 'INVALID_RESERVATION' | 'NOT_FOUND' | 'NO_APPROVED_CREATIVE' | 'SALE_NOT_ENABLED' | 'FORMAT_NOT_AVAILABLE' | 'NO_CONFIRMED_RESERVATION';
  constructor(code: CampaignError['code'], msg: string) { super(msg); this.code = code; }
}

export class CampaignBook {
  private items = new Map<string, Campaign>();
  private seq = 0;
  create(input: { name: string; accountId: string; opportunityId?: string | null; formatId: string; positionId?: string | null; startDate: string; endDate: string; sponsoredLabel?: boolean }, now: string): Campaign {
    const c: Campaign = {
      id: `cmp-${++this.seq}`, name: input.name, accountId: input.accountId, opportunityId: input.opportunityId ?? null,
      formatId: input.formatId, positionId: input.positionId ?? null, startDate: input.startDate, endDate: input.endDate,
      status: 'draft', reservationIds: [], sponsoredLabel: input.sponsoredLabel ?? false,
      history: [{ from: null, to: 'draft', at: now }],
    };
    this.items.set(c.id, c);
    return c;
  }
  get(id: string): Campaign {
    const c = this.items.get(id);
    if (!c) throw new CampaignError('NOT_FOUND', `Campanha ${id} não existe.`);
    return c;
  }
  list(): Campaign[] { return [...this.items.values()]; }
  /**
   * Transição de estado. Regras no domínio (não só no handler):
   *  - 'reserved' exige reservas EXISTENTES, não canceladas e vinculadas a esta campanha (`opts.reservations`, resolvidas pelo chamador).
   *  - 'active' (também ao retomar de 'paused') exige `opts.activation` satisfazendo TODAS as condições de `evaluateActivation`.
   */
  transition(id: string, to: CampaignStatus, now: string, opts: { reservations?: readonly Reservation[]; activation?: ActivationEvidence; note?: string } = {}): Campaign {
    const c = this.get(id);
    if (!TRANSITIONS[c.status].includes(to)) throw new CampaignError('BAD_TRANSITION', `${c.status} -> ${to} não permitido.`);
    if (to === 'reserved') {
      const rs = opts.reservations ?? [];
      if (!rs.length) throw new CampaignError('NO_RESERVATION', 'Reservar exige ao menos uma reserva de inventário.');
      const bad = rs.filter((r) => r.status === 'cancelled' || r.campaignId !== c.id || (c.positionId !== null && r.positionId !== c.positionId));
      if (bad.length) throw new CampaignError('INVALID_RESERVATION', `Reserva(s) inválida(s) para ${c.id}: ${bad.map((r) => r.id).join(', ')} (canceladas, de outra campanha ou de outra posição).`);
      c.reservationIds = rs.map((r) => r.id);
    }
    if (to === 'active') {
      const failures = evaluateActivation(c, opts.activation);
      if (failures.length) throw new CampaignError(failures[0]!.code, `Ativação recusada: ${failures.map((f) => f.message).join(' ')}`);
    }
    c.history.push({ from: c.status, to, at: now, note: opts.note });
    c.status = to;
    return c;
  }
}

/** Evidência que o chamador reúne do estado real para pedir a ativação. Sem ela, a ativação é recusada. */
export interface ActivationEvidence {
  /** Flag adServerVendas ligada. */
  saleEnabled: boolean;
  /** Estado do formato no catálogo; só 'disponivel' ativa (CP-12). */
  formatStatus: FormatStatus;
  /** Reservas da campanha no inventário (qualquer estado; o filtro é feito aqui). */
  reservations: readonly Reservation[];
  approvedCreativeCount: number;
}
type Failure = { code: CampaignError['code']; message: string };

const DAY = 86_400_000;
const day = (d: string) => Date.parse(d + 'T00:00:00Z');
/** As reservas confirmadas (juntas) cobrem todos os dias de [start, end]? */
export function confirmedCoverage(c: Pick<Campaign, 'id' | 'positionId' | 'startDate' | 'endDate'>, reservations: readonly Reservation[]): boolean {
  const own = reservations
    .filter((r) => r.status === 'confirmed' && r.campaignId === c.id && (c.positionId === null || r.positionId === c.positionId))
    .map((r) => [day(r.startDate), day(r.endDate)] as const)
    .sort((a, b) => a[0] - b[0]);
  let cursor = day(c.startDate);
  const end = day(c.endDate);
  for (const [s, e] of own) {
    if (s > cursor) break; // buraco
    if (e + DAY > cursor) cursor = e + DAY;
    if (cursor > end) return true;
  }
  return cursor > end;
}

/** Lista TODAS as condições de ativação que faltam (vazia = pode ativar). */
export function evaluateActivation(c: Campaign, ev: ActivationEvidence | undefined): Failure[] {
  if (!ev) return [{ code: 'SALE_NOT_ENABLED', message: 'sem evidência de ativação.' }];
  const f: Failure[] = [];
  if (!ev.saleEnabled) f.push({ code: 'SALE_NOT_ENABLED', message: 'flag adServerVendas desligada.' });
  if (ev.formatStatus !== 'disponivel') f.push({ code: 'FORMAT_NOT_AVAILABLE', message: `formato ${c.formatId} está '${ev.formatStatus}', não 'disponivel'.` });
  if (!confirmedCoverage(c, ev.reservations)) f.push({ code: 'NO_CONFIRMED_RESERVATION', message: `sem reserva confirmada cobrindo ${c.startDate} a ${c.endDate}.` });
  if (!(ev.approvedCreativeCount > 0)) f.push({ code: 'NO_APPROVED_CREATIVE', message: 'sem criativo aprovado.' });
  return f;
}
export const canTransition = (from: CampaignStatus, to: CampaignStatus) => TRANSITIONS[from].includes(to);
