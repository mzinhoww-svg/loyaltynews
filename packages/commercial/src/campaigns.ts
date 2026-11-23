// Campanhas: máquina de estados draft/reserved/approved/active/paused/completed/cancelled.
// Regra: lead não cria reserva até aprovação; ativação exige reserva e aprovação do cliente.
import type { Reservation } from './inventory';
import type { FormatStatus } from './types';
import { SNAPSHOT_VERSION, assertSnapshot, assertUnique, clone, maxSeq } from './snapshot';

export interface CampaignSnapshot { version: typeof SNAPSHOT_VERSION; seq: number; campaigns: Campaign[] }

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
  formatId: string;
  /** Posições da campanha (sem repetição). Para ativar é preciso ao menos uma, cada uma com reserva confirmada cobrindo o período. */
  positionIds: string[];
  /** Compatibilidade: sempre positionIds[0] ?? null. */
  positionId: string | null;
  startDate: string; endDate: string; status: CampaignStatus;
  reservationIds: string[];
  /** Conteúdo patrocinado precisa de rótulo ostensivo. */
  sponsoredLabel: boolean;
  history: { from: CampaignStatus | null; to: CampaignStatus; at: string; note?: string }[];
}

export class CampaignError extends Error {
  code: 'BAD_TRANSITION' | 'NO_RESERVATION' | 'INVALID_RESERVATION' | 'NOT_FOUND' | 'NO_APPROVED_CREATIVE' | 'SALE_NOT_ENABLED' | 'FORMAT_NOT_AVAILABLE' | 'NO_CONFIRMED_RESERVATION'
    | 'NO_POSITIONS' | 'POSITION_NOT_IN_CAMPAIGN' | 'BAD_STATE';
  constructor(code: CampaignError['code'], msg: string) { super(msg); this.code = code; }
}

export class CampaignBook {
  private items = new Map<string, Campaign>();
  private seq = 0;

  // ---------- hidratação e persistência ----------
  snapshot(): CampaignSnapshot { return { version: SNAPSHOT_VERSION, seq: this.seq, campaigns: clone([...this.items.values()]) }; }
  /**
   * Substitui as campanhas. Carregar NÃO reavalia regras de transição (o estado vem do banco); o contador de ids é recalculado.
   * Campanha ativa no snapshot sem reserva confirmada continua ativa aqui: quem decide é a próxima tentativa de ativação/retomada.
   */
  load(s: CampaignSnapshot): void {
    assertSnapshot(s, 'CampaignBook', ['campaigns']);
    assertUnique(s.campaigns.map((c) => c.id), 'CampaignBook');
    const c = clone(s);
    // Snapshot antigo (sem positionIds): deriva de positionId. Mantém positionId = positionIds[0] ?? null.
    for (const x of c.campaigns) {
      const raw = (x as { positionIds?: unknown }).positionIds;
      x.positionIds = uniq(Array.isArray(raw) ? (raw as string[]) : x.positionId ? [x.positionId] : []);
      x.positionId = x.positionIds[0] ?? null;
    }
    this.items = new Map(c.campaigns.map((x) => [x.id, x]));
    this.seq = Math.max(s.seq ?? 0, maxSeq(this.items.keys()));
  }

  /** `positionIds` (várias) ou `positionId` (apelido de [positionId]); sem nenhuma, a campanha nasce sem posições e não ativa. */
  create(input: { name: string; accountId: string; opportunityId?: string | null; formatId: string; positionId?: string | null; positionIds?: readonly string[]; startDate: string; endDate: string; sponsoredLabel?: boolean }, now: string): Campaign {
    const positionIds = uniq(input.positionIds ?? (input.positionId ? [input.positionId] : []));
    const c: Campaign = {
      id: `cmp-${++this.seq}`, name: input.name, accountId: input.accountId, opportunityId: input.opportunityId ?? null,
      formatId: input.formatId, positionIds, positionId: positionIds[0] ?? null, startDate: input.startDate, endDate: input.endDate,
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
  /** Troca as posições. Só em rascunho (depois há reservas e criativos amarrados a elas). Exige ao menos uma. */
  setPositions(id: string, positionIds: readonly string[], now: string): Campaign {
    const c = this.get(id);
    if (c.status !== 'draft') throw new CampaignError('BAD_STATE', `As posições só mudam em rascunho; a campanha está em '${c.status}'.`);
    const ids = uniq(positionIds);
    if (!ids.length) throw new CampaignError('NO_POSITIONS', 'A campanha precisa de ao menos uma posição.');
    c.positionIds = ids; c.positionId = ids[0] ?? null;
    c.history.push({ from: c.status, to: c.status, at: now, note: `posições: ${ids.join(', ')}` });
    return c;
  }
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
      const bad = rs.filter((r) => r.status === 'cancelled' || r.campaignId !== c.id || (c.positionIds.length > 0 && !c.positionIds.includes(r.positionId)));
      if (bad.length) throw new CampaignError('INVALID_RESERVATION', `Reserva(s) inválida(s) para ${c.id}: ${bad.map((r) => r.id).join(', ')} (canceladas, de outra campanha ou fora das posições da campanha).`);
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
  /** Posições dos criativos APROVADOS da campanha; todas precisam estar entre as posições da campanha. */
  creativePositions: readonly string[];
}
type Failure = { code: CampaignError['code']; message: string };

const DAY = 86_400_000;
const day = (d: string) => Date.parse(d + 'T00:00:00Z');
/** As reservas confirmadas DESTA posição (juntas) cobrem todos os dias de [start, end]? */
export function confirmedCoverage(c: Pick<Campaign, 'id' | 'startDate' | 'endDate'>, reservations: readonly Reservation[], positionId: string): boolean {
  const own = reservations
    .filter((r) => r.status === 'confirmed' && r.campaignId === c.id && r.positionId === positionId)
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
  if (c.positionIds.length === 0) f.push({ code: 'NO_POSITIONS', message: 'a campanha não tem posições.' });
  else {
    const missing = c.positionIds.filter((pid) => !confirmedCoverage(c, ev.reservations, pid));
    if (missing.length) f.push({ code: 'NO_CONFIRMED_RESERVATION', message: `sem reserva confirmada cobrindo ${c.startDate} a ${c.endDate} em: ${missing.join(', ')}.` });
  }
  const stray = [...new Set(ev.creativePositions.filter((pid) => !c.positionIds.includes(pid)))];
  if (stray.length) f.push({ code: 'POSITION_NOT_IN_CAMPAIGN', message: `criativo aprovado em posição fora da campanha: ${stray.join(', ')}.` });
  if (!(ev.approvedCreativeCount > 0)) f.push({ code: 'NO_APPROVED_CREATIVE', message: 'sem criativo aprovado.' });
  return f;
}
const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];
export const canTransition = (from: CampaignStatus, to: CampaignStatus) => TRANSITIONS[from].includes(to);
