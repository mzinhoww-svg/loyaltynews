// Campanhas: máquina de estados draft/reserved/approved/active/paused/completed/cancelled.
// Regra: lead não cria reserva até aprovação; ativação exige reserva e aprovação do cliente.
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
  code: 'BAD_TRANSITION' | 'NO_RESERVATION' | 'NOT_FOUND' | 'NO_APPROVED_CREATIVE';
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
  transition(id: string, to: CampaignStatus, now: string, opts: { reservationIds?: string[]; hasApprovedCreative?: boolean; note?: string } = {}): Campaign {
    const c = this.get(id);
    if (!TRANSITIONS[c.status].includes(to)) throw new CampaignError('BAD_TRANSITION', `${c.status} -> ${to} não permitido.`);
    if (to === 'reserved') {
      if (!opts.reservationIds?.length) throw new CampaignError('NO_RESERVATION', 'Reservar exige ao menos uma reserva de inventário.');
      c.reservationIds = [...opts.reservationIds];
    }
    if (to === 'active' && c.status === 'approved' && !opts.hasApprovedCreative) throw new CampaignError('NO_APPROVED_CREATIVE', 'Ativar exige criativo aprovado.');
    c.history.push({ from: c.status, to, at: now, note: opts.note });
    c.status = to;
    return c;
  }
}
export const canTransition = (from: CampaignStatus, to: CampaignStatus) => TRANSITIONS[from].includes(to);
