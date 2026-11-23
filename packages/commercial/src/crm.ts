import { SNAPSHOT_VERSION, SnapshotError, assertSnapshot, assertUnique, clone, maxSeq } from './snapshot';

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
  /** Momento do consentimento (contracts/Lead.consentimentoEm). */
  consentAt: string;
}
export interface Account { id: string; name: string; leadIds: string[]; createdAt: string }
export interface Opportunity {
  id: string; accountId: string; leadId: string | null; title: string; formatIds: string[];
  stage: OpportunityStage; lostReason: string | null; nextAction: string | null; nextActionDue: string | null;
  /** Valor estimado em BRL; null = ainda não propostado (nunca inventar). */
  amountBRL: number | null; proposalVersions: number;
  history: { from: OpportunityStage | null; to: OpportunityStage; at: string }[];
}
/** Base legal do tratamento do contato comercial (LGPD). Registrada junto com a data, no servidor. */
export const CONTACT_BASES = ['consentimento', 'legitimo_interesse', 'execucao_de_contrato'] as const;
export type ContactBasis = (typeof CONTACT_BASES)[number];
/** Pessoa de contato de uma conta (anunciante). Dado pessoal (classe 'personal'): nunca sai em rota pública nem em lista de conta. */
export interface Contact {
  id: string; accountId: string; name: string; email: string; whatsapp: string | null; role: string | null;
  /** Base legal e momento do registro: gravados pelo servidor, nunca vindos do cliente. */
  basis: ContactBasis; consentAt: string;
  /** Quem registrou (id do ator do Studio); null se desconhecido. */
  registeredBy: string | null;
  classeDeDado: 'personal';
  createdAt: string;
}
export interface CrmSnapshot { version: typeof SNAPSHOT_VERSION; seq: number; leads: Lead[]; accounts: Account[]; opportunities: Opportunity[]; /** Opcional: snapshot anterior não tinha contatos. */ contacts?: Contact[] }
export class CrmError extends Error {
  code: 'INVALID_LEAD' | 'NOT_FOUND' | 'BAD_STAGE' | 'LOST_REASON_REQUIRED' | 'INVALID_ACCOUNT' | 'DUPLICATE_ACCOUNT' | 'INVALID_CONTACT' | 'DUPLICATE_CONTACT';
  constructor(code: CrmError['code'], msg: string) { super(msg); this.code = code; }
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const normalizeName = (s: string): string => (s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const nameKey = (s: string): string => normalizeName(s).toLowerCase();
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
  contacts = new Map<string, Contact>();
  private seq = 0;

  // ---------- hidratação e persistência ----------
  snapshot(): CrmSnapshot {
    return { version: SNAPSHOT_VERSION, seq: this.seq, leads: clone([...this.leads.values()]), accounts: clone([...this.accounts.values()]), opportunities: clone([...this.opportunities.values()]), contacts: clone([...this.contacts.values()]) };
  }
  /** Substitui todo o estado. Recalcula o contador de ids a partir dos ids carregados (nunca reutiliza um id existente). */
  load(s: CrmSnapshot): void {
    assertSnapshot(s, 'Crm', ['leads', 'accounts', 'opportunities']);
    assertUnique(s.leads.map((x) => x.id), 'Crm.leads'); assertUnique(s.accounts.map((x) => x.id), 'Crm.accounts'); assertUnique(s.opportunities.map((x) => x.id), 'Crm.opportunities');
    if (s.contacts !== undefined && !Array.isArray(s.contacts)) throw new SnapshotError('Crm: campo "contacts" deve ser lista.');
    assertUnique((s.contacts ?? []).map((x) => x.id), 'Crm.contacts');
    const c = clone(s);
    this.leads = new Map(c.leads.map((x) => [x.id, x])); this.accounts = new Map(c.accounts.map((x) => [x.id, x])); this.opportunities = new Map(c.opportunities.map((x) => [x.id, x]));
    this.contacts = new Map((c.contacts ?? []).map((x) => [x.id, x]));
    this.seq = Math.max(s.seq ?? 0, maxSeq([...this.leads.keys(), ...this.accounts.keys(), ...this.opportunities.keys(), ...this.contacts.keys()]));
  }

  /** Captura do formulário do mídia kit. Não cria reserva de inventário. */
  captureLead(input: { name: string; company: string; email: string; whatsapp?: string; formatIds?: string[]; objective?: string; message?: string; newsletterOptIn?: boolean }, now: string): Lead {
    if (!input.name?.trim() || !input.company?.trim()) throw new CrmError('INVALID_LEAD', 'Nome e empresa são obrigatórios.');
    if (!EMAIL.test(input.email ?? '')) throw new CrmError('INVALID_LEAD', 'E-mail inválido.');
    const l: Lead = {
      id: `lead-${++this.seq}`, name: input.name.trim(), company: input.company.trim(), email: input.email.trim().toLowerCase(),
      whatsapp: input.whatsapp?.trim() || null, formatIds: input.formatIds ?? [], objective: input.objective ?? '', message: input.message ?? '',
      newsletterOptIn: input.newsletterOptIn === true, status: 'novo', createdAt: now, accountId: null, consentAt: now,
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
  /** Conta (anunciante) criada direto pelo comercial. Nome normalizado; repetido (sem diferenciar maiúsculas) => DUPLICATE_ACCOUNT. */
  createAccount(name: string, now: string): Account {
    const clean = normalizeName(name);
    if (!clean || clean.length > 120 || CONTROL.test(clean)) throw new CrmError('INVALID_ACCOUNT', 'Nome da conta obrigatório (1 a 120 caracteres, sem caracteres de controle).');
    if ([...this.accounts.values()].some((a) => nameKey(a.name) === nameKey(clean))) throw new CrmError('DUPLICATE_ACCOUNT', 'Já existe uma conta com este nome.');
    const a: Account = { id: `acc-${++this.seq}`, name: clean, leadIds: [], createdAt: now };
    this.accounts.set(a.id, a); return a;
  }

  /**
   * Contato direto de uma conta. A base legal vem de quem registra; a DATA e o autor são gravados aqui (nunca do cliente).
   * Regras: conta existe (NOT_FOUND); nome, e-mail e WhatsApp válidos (INVALID_CONTACT); e-mail único dentro da conta (DUPLICATE_CONTACT).
   */
  addContact(input: { accountId: string; name: string; email: string; whatsapp?: string | null; role?: string | null; basis: ContactBasis }, now: string, registeredBy: string | null = null): Contact {
    if (!this.accounts.has(input.accountId)) throw new CrmError('NOT_FOUND', `Conta ${input.accountId} não existe.`);
    const name = normalizeName(input.name);
    if (!name || name.length > 120 || CONTROL.test(name)) throw new CrmError('INVALID_CONTACT', 'Nome do contato obrigatório (1 a 120 caracteres, sem caracteres de controle).');
    const email = (input.email ?? '').trim().toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) throw new CrmError('INVALID_CONTACT', 'E-mail do contato inválido.');
    let whatsapp: string | null = null;
    if (input.whatsapp !== undefined && input.whatsapp !== null && input.whatsapp.trim() !== '') {
      const w = input.whatsapp.replace(/[\s().-]/g, '');
      if (!/^\+?\d{8,15}$/.test(w)) throw new CrmError('INVALID_CONTACT', 'WhatsApp inválido (8 a 15 dígitos, com + opcional).');
      whatsapp = w;
    }
    const role = input.role === undefined || input.role === null ? null : normalizeName(input.role);
    if (role !== null && (role.length > 80 || CONTROL.test(role))) throw new CrmError('INVALID_CONTACT', 'Cargo inválido (até 80 caracteres, sem caracteres de controle).');
    if (!(CONTACT_BASES as readonly string[]).includes(input.basis)) throw new CrmError('INVALID_CONTACT', 'Base legal inválida.');
    if ([...this.contacts.values()].some((c) => c.accountId === input.accountId && c.email === email)) throw new CrmError('DUPLICATE_CONTACT', 'Já existe contato com este e-mail nesta conta.');
    const c: Contact = { id: `ctt-${++this.seq}`, accountId: input.accountId, name, email, whatsapp, role: role === '' ? null : role, basis: input.basis, consentAt: now, registeredBy, classeDeDado: 'personal', createdAt: now };
    this.contacts.set(c.id, c); return c;
  }
  /** Contatos da conta, do mais antigo ao mais novo. Conta inexistente => NOT_FOUND. */
  listContacts(accountId: string): Contact[] {
    if (!this.accounts.has(accountId)) throw new CrmError('NOT_FOUND', `Conta ${accountId} não existe.`);
    return [...this.contacts.values()].filter((c) => c.accountId === accountId).sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id, 'en', { numeric: true }) : a.createdAt < b.createdAt ? -1 : 1));
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
