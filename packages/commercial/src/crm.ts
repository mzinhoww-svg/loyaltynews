// CRM comercial: leads (do mídia kit), contas, oportunidades.
// Fluxo: lead -> qualificação -> oportunidade (novo, qualificado, proposta, negociação, ganho/perdido, motivo, próxima ação).
export type OpportunityStage = 'novo' | 'qualificado' | 'proposta' | 'negociacao' | 'ganho' | 'perdido';
export type LeadStatus = 'novo' | 'qualificado' | 'descartado' | 'convertido';

export interface Lead {
  id: string; name: string; company: string; email: string; whatsapp: string | null;
  formatIds: string[]; objective: string; message: string;
  /** Opt-in da newsletter é separado do contato comercial; nunca pré-marcado. */
  newsletterOptIn: boolean;
  status: LeadStatus; createdAt: string; accountId: string | null;
}
export interface Account { id: string; name: string; leadIds: string[]; createdAt: string }
export interface Opportunity {
  id: string; accountId: string; leadId: string | null; title: string; formatIds: string[];
  stage: OpportunityStage; lostReason: string | null; nextAction: string | null; nextActionDue: string | null;
  /** Valor estimado em BRL; null = ainda não propostado (nunca inventar). */
  amountBRL: number | null; proposalVersions: number;
  history: { from: OpportunityStage | null; to: OpportunityStage; at: string }[];
}
export class CrmError extends Error {
  code: 'INVALID_LEAD' | 'NOT_FOUND' | 'BAD_STAGE' | 'LOST_REASON_REQUIRED';
  constructor(code: CrmError['code'], msg: string) { super(msg); this.code = code; }
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FLOW: Record<OpportunityStage, OpportunityStage[]> = {
  novo: ['qualificado', 'perdido'],
  qualificado: ['proposta', 'perdido'],
  proposta: ['negociacao', 'ganho', 'perdido'],
  negociacao: ['proposta', 'ganho', 'perdido'],
  ganho: [], perdido: [],
};

export class Crm {
  leads = new Map<string, Lead>();
  accounts = new Map<string, Account>();
  opportunities = new Map<string, Opportunity>();
  private seq = 0;

  /** Captura do formulário do mídia kit. Não cria reserva de inventário. */
  captureLead(input: { name: string; company: string; email: string; whatsapp?: string; formatIds?: string[]; objective?: string; message?: string; newsletterOptIn?: boolean }, now: string): Lead {
    if (!input.name?.trim() || !input.company?.trim()) throw new CrmError('INVALID_LEAD', 'Nome e empresa são obrigatórios.');
    if (!EMAIL.test(input.email ?? '')) throw new CrmError('INVALID_LEAD', 'E-mail inválido.');
    const l: Lead = {
      id: `lead-${++this.seq}`, name: input.name.trim(), company: input.company.trim(), email: input.email.trim().toLowerCase(),
      whatsapp: input.whatsapp?.trim() || null, formatIds: input.formatIds ?? [], objective: input.objective ?? '', message: input.message ?? '',
      newsletterOptIn: input.newsletterOptIn === true, status: 'novo', createdAt: now, accountId: null,
    };
    this.leads.set(l.id, l);
    return l;
  }
  private lead(id: string): Lead { const l = this.leads.get(id); if (!l) throw new CrmError('NOT_FOUND', `Lead ${id} não existe.`); return l; }
  qualifyLead(id: string): Lead { const l = this.lead(id); l.status = 'qualificado'; return l; }
  discardLead(id: string): Lead { const l = this.lead(id); l.status = 'descartado'; return l; }

  /** Conversão: cria/reaproveita conta (por nome da empresa, case-insensitive) e abre oportunidade em 'novo'. */
  convertLead(id: string, now: string, title?: string): { account: Account; opportunity: Opportunity } {
    const l = this.lead(id);
    let account = [...this.accounts.values()].find((a) => a.name.toLowerCase() === l.company.toLowerCase());
    if (!account) { account = { id: `acc-${++this.seq}`, name: l.company, leadIds: [], createdAt: now }; this.accounts.set(account.id, account); }
    if (!account.leadIds.includes(l.id)) account.leadIds.push(l.id);
    l.accountId = account.id; l.status = 'convertido';
    const opportunity: Opportunity = {
      id: `opp-${++this.seq}`, accountId: account.id, leadId: l.id, title: title ?? `${l.company} — mídia kit`, formatIds: [...l.formatIds],
      stage: 'novo', lostReason: null, nextAction: null, nextActionDue: null, amountBRL: null, proposalVersions: 0,
      history: [{ from: null, to: 'novo', at: now }],
    };
    this.opportunities.set(opportunity.id, opportunity);
    return { account, opportunity };
  }
  createAccount(name: string, now: string): Account {
    const a: Account = { id: `acc-${++this.seq}`, name, leadIds: [], createdAt: now };
    this.accounts.set(a.id, a); return a;
  }
  moveStage(id: string, to: OpportunityStage, now: string, opts: { lostReason?: string; nextAction?: string; nextActionDue?: string; amountBRL?: number } = {}): Opportunity {
    const o = this.opportunities.get(id);
    if (!o) throw new CrmError('NOT_FOUND', `Oportunidade ${id} não existe.`);
    if (!FLOW[o.stage].includes(to)) throw new CrmError('BAD_STAGE', `${o.stage} -> ${to} não permitido.`);
    if (to === 'perdido' && !opts.lostReason?.trim()) throw new CrmError('LOST_REASON_REQUIRED', 'Motivo da perda é obrigatório.');
    if (to === 'proposta') o.proposalVersions++; // proposta versionada
    if (to === 'perdido') o.lostReason = opts.lostReason!.trim();
    if (opts.nextAction !== undefined) o.nextAction = opts.nextAction;
    if (opts.nextActionDue !== undefined) o.nextActionDue = opts.nextActionDue;
    if (opts.amountBRL !== undefined) o.amountBRL = opts.amountBRL;
    o.history.push({ from: o.stage, to, at: now }); o.stage = to;
    return o;
  }
  /** Funil real: contagem por estágio e soma só de valores informados (sem estimar). */
  pipeline() {
    const stages: OpportunityStage[] = ['novo', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido'];
    return stages.map((s) => {
      const os = [...this.opportunities.values()].filter((o) => o.stage === s);
      const known = os.filter((o) => o.amountBRL !== null);
      return { stage: s, count: os.length, amountKnownBRL: known.reduce((t, o) => t + (o.amountBRL ?? 0), 0), withoutAmount: os.length - known.length };
    });
  }
}
