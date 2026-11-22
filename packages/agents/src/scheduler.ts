/**
 * Agendador dos rituais (diário/semanal/mensal/evento) com janela de recuperação P5.
 *
 * É um componente DETERMINÍSTICO: não chama modelo (model_calls = 0). Decide quais rituais
 * vencem, aplica a janela de recuperação (+120 min inclusive, mesmo dia útil), dependências do
 * D-sync, quórum e regra do silêncio, e persiste ata, decisões, tarefas, responsáveis e prazos.
 * Os insumos estruturados dos participantes vêm de um `InputCollector` (adaptador OpenBot, R4);
 * o `StoreInputCollector` lê insumos já gravados no banco. Nenhuma rotina real é criada aqui.
 */
import { isEnabled, type FlagState } from '@ln/contracts';
import { addBusinessDays, addDays, firstBusinessDayOfMonth, isBusinessDay, localPartsOf, localToUtc, nextBusinessDay, weekdayOf, WEEKDAY_CODES, type HolidayCalendar } from './calendar';
import type { LoadedRegistries } from './config';
import { ParticipantInputSchema, type Meeting, type ParticipantInput, type RecoveryPolicy, type StatusReason } from './schemas';
import { idempotencyKey, type ActionItem, type Decision, type DecisionStatus, type MeetingOutcomeRecord, type MeetingRun, type Minutes, type Store } from './store';

export interface Occurrence {
  meeting: Meeting;
  /** Data em que a ocorrência VENCE (efetiva, já deslocada por feriado). A janela e o horário usam esta data. */
  localDate: string;
  /**
   * Data ORIGINAL da ocorrência, antes de qualquer deslocamento por feriado. A chave de idempotência
   * (P5 v2) é `meeting_id + originalDate` (+ `#instance` em eventos) e nunca muda se a ocorrência é movida.
   */
  originalDate: string;
  /** Outras datas originais que caíram na mesma data efetiva (colisão): rodam uma única vez, com as duas chaves. */
  collidedOriginalDates: string[];
  instance: string;
  scheduledFor: Date;
}

/** Todas as chaves de idempotência cobertas por uma ocorrência (primária primeiro). */
export function occurrenceKeys(occ: Occurrence): string[] {
  return [occ.originalDate, ...occ.collidedOriginalDates].map((d) => idempotencyKey(occ.meeting.id, d, occ.instance));
}
export const isRescheduled = (occ: Occurrence): boolean => occ.originalDate !== occ.localDate;

export type Classification =
  | { kind: 'not_due' }
  | { kind: 'run'; delayMinutes: number }
  | { kind: 'status_only'; reason: StatusReason; delayMinutes: number };

const tzOf = (m: Meeting) => m.timezone;
const hhmmOf = (m: Meeting) => m.schedule_local.slice(-5);

/** Data nominal de um semanal na semana de `date`, deslocada p/ o próximo dia útil se feriado. */
function weeklyEffectiveDate(nominal: string, cal: HolidayCalendar): string {
  return isBusinessDay(nominal, cal) ? nominal : nextBusinessDay(nominal, cal);
}

/** Rituais cujo horário cai em `date` (data local). Eventos nunca são agendados. */
export function occurrencesOn(meetings: readonly Meeting[], date: string, cal: HolidayCalendar): Occurrence[] {
  const out: Occurrence[] = [];
  for (const m of meetings) {
    let originals: string[] = [];
    if (m.cycle === 'weekday') {
      if (isBusinessDay(date, cal)) originals = [date];
    } else if (m.cycle === 'weekly') {
      const target = WEEKDAY_CODES.indexOf(m.schedule_local.slice(0, 3) as (typeof WEEKDAY_CODES)[number]);
      // datas nominais (dia da semana do ritual) cuja data efetiva é `date`: se o nominal é feriado, o
      // semanal move p/ o próximo dia útil (P5 v2) mantendo a data original como chave. Varre 14 dias
      // para cobrir feriados encadeados (a colisão de duas ocorrências na mesma data efetiva).
      for (let back = 14; back >= 0; back--) {
        const nominal = addDays(date, -back);
        if (weekdayOf(nominal) === target && weeklyEffectiveDate(nominal, cal) === date) originals.push(nominal);
      }
    } else if (m.cycle === 'monthly') {
      // o ritual mensal já é definido como "primeiro dia útil": a data original é a própria data (sem deslocamento)
      const [y, mo] = date.split('-').map(Number) as [number, number];
      if (firstBusinessDayOfMonth(y, mo, cal) === date) originals = [date];
    }
    if (originals.length) {
      const [primary, ...collided] = originals as [string, ...string[]];
      out.push({ meeting: m, localDate: date, originalDate: primary, collidedOriginalDates: collided, instance: '', scheduledFor: localToUtc(date, hhmmOf(m), tzOf(m)) });
    }
  }
  return out.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime() || a.meeting.id.localeCompare(b.meeting.id));
}

/**
 * Janela de recuperação (P5): roda se `0 <= atraso <= window_minutes` (inclusive) e ainda no
 * mesmo dia local; depois disso vira registro de status, sem chamada de modelo.
 */
export function classify(occ: Occurrence, now: Date, policy: RecoveryPolicy): Classification {
  const delayMs = now.getTime() - occ.scheduledFor.getTime();
  if (delayMs < 0) return { kind: 'not_due' };
  const delayMinutes = Math.floor(delayMs / 60000);
  const nowLocalDate = localPartsOf(now, occ.meeting.timezone).date;
  const sameDay = nowLocalDate === occ.localDate;
  const withinWindow = delayMs <= policy.window_minutes * 60000;
  if (withinWindow && (sameDay || !policy.same_business_day)) return { kind: 'run', delayMinutes };
  return { kind: 'status_only', reason: sameDay ? 'recovery_window_expired' : 'host_off_previous_day', delayMinutes };
}

export interface CollectResult {
  inputs: unknown[];
  /** chamadas de modelo feitas pelo coletor (o agendador em si faz 0) */
  model_calls?: number;
}
export interface InputCollector {
  /** `localDate` = data ORIGINAL da ocorrência (identidade dela); `runDate` = data efetiva, se movida por feriado. */
  collect(ctx: { meeting: Meeting; localDate: string; runDate: string; instance: string }): Promise<CollectResult>;
}

/** Lê insumos já gravados no banco pelos participantes (sem modelo). */
export class StoreInputCollector implements InputCollector {
  constructor(private readonly store: Store) {}
  async collect(ctx: { meeting: Meeting; localDate: string; runDate: string; instance: string }): Promise<CollectResult> {
    return { inputs: await this.store.getInputs(ctx.meeting.id, ctx.localDate, ctx.instance), model_calls: 0 };
  }
}

export interface SchedulerOptions {
  registries: LoadedRegistries;
  calendar: HolidayCalendar;
  store: Store;
  collector: InputCollector;
  /** quantos dias locais para trás procurar ocorrências sem registro (padrão 1) */
  lookbackDays?: number;
  /** atraso até o qual a execução é considerada "no horário" (padrão 5 min) */
  onTimeToleranceMinutes?: number;
  newId?: () => string;
  /**
   * Flags do produto (@ln/contracts). Sem `rituais: true` o agendador não executa nada (padrão:
   * desligado até o gate R4). Nenhuma rotina real é criada por este pacote.
   */
  flags?: Partial<FlagState>;
}

export interface TickResult {
  /** preenchido quando a flag `rituais` está desligada */
  skipped?: 'flag_rituais_off';
  /** `local_date` = data original (chave); `rescheduled_date` preenchida se movida por feriado; `collided_keys` se houve colisão. */
  processed: { meeting_id: string; local_date: string; rescheduled_date: string | null; keys: string[]; collided_keys: string[]; status: string; reason: StatusReason | null }[];
  waiting: { meeting_id: string; local_date: string; waiting_for: string[] }[];
  errors: { meeting_id: string; local_date: string; error: string }[];
}

export class RitualScheduler {
  private readonly o: Required<Omit<SchedulerOptions, 'registries' | 'calendar' | 'store' | 'collector'>> & Pick<SchedulerOptions, 'registries' | 'calendar' | 'store' | 'collector'>;
  private readonly agentIds: Set<string>;

  constructor(opts: SchedulerOptions) {
    this.o = { lookbackDays: 1, onTimeToleranceMinutes: 5, newId: () => crypto.randomUUID(), flags: {}, ...opts };
    this.agentIds = new Set(opts.registries.agents.map((a) => a.id));
  }

  private get meetings() {
    return this.o.registries.meetings;
  }

  /** Processa todos os rituais vencidos sem registro em [hoje - lookbackDays, hoje]. Idempotente. */
  async tick(now: Date): Promise<TickResult> {
    const today = localPartsOf(now, 'America/Sao_Paulo').date;
    const result: TickResult = { processed: [], waiting: [], errors: [] };
    if (!isEnabled('rituais', this.o.flags)) return { ...result, skipped: 'flag_rituais_off' };
    const occs: Occurrence[] = [];
    for (let back = this.o.lookbackDays; back >= 0; back--) occs.push(...occurrencesOn(this.meetings, addDays(today, -back), this.o.calendar));
    occs.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());

    for (const occ of occs) {
      const cls = classify(occ, now, this.o.registries.recoveryPolicy);
      if (cls.kind === 'not_due') continue;
      if (await this.findExisting(occ)) continue; // idempotência: chave = meeting_id + data ORIGINAL (P5 v2)
      if (cls.kind === 'status_only') {
        const rec = await this.persistStatusOnly(occ, now, cls.reason, cls.delayMinutes);
        result.processed.push(this.logEntry(occ, rec.run));
        continue;
      }
      // D-sync (e qualquer ritual com depends_on) espera os dailies que consolida
      const pending = await this.pendingDependencies(occ);
      if (pending.length) {
        result.waiting.push({ meeting_id: occ.meeting.id, local_date: occ.originalDate, waiting_for: pending });
        continue;
      }
      try {
        const rec = await this.execute(occ, now, cls.delayMinutes);
        result.processed.push(this.logEntry(occ, rec.run));
      } catch (e) {
        // falha do coletor/banco: nada é persistido; tenta de novo no próximo tick enquanto durar a janela
        result.errors.push({ meeting_id: occ.meeting.id, local_date: occ.originalDate, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return result;
  }

  /** Aciona o ritual por evento (X-incident). `instance` identifica o evento (idempotência). */
  async raiseEvent(meetingId: string, instance: string, now: Date): Promise<MeetingOutcomeRecord['run']> {
    const meeting = this.meetings.find((m) => m.id === meetingId && m.cycle === 'event');
    if (!meeting) throw new Error(`ritual por evento inexistente: ${meetingId}`);
    if (!instance) throw new Error('instance (id do evento) é obrigatório');
    if (!isEnabled('rituais', this.o.flags)) throw new Error('flag rituais desligada: ritual por evento não executado');
    const localDate = localPartsOf(now, meeting.timezone).date;
    const existing = await this.o.store.getRun(meetingId, localDate, instance);
    if (existing) return existing;
    const occ: Occurrence = { meeting, localDate, originalDate: localDate, collidedOriginalDates: [], instance, scheduledFor: now };
    return (await this.execute(occ, now, 0)).run;
  }

  private async pendingDependencies(occ: Occurrence): Promise<string[]> {
    const deps = occ.meeting.depends_on ?? [];
    if (!deps.length) return [];
    const scheduledToday = new Set(occurrencesOn(this.meetings, occ.localDate, this.o.calendar).map((x) => x.meeting.id));
    const pending: string[] = [];
    for (const d of deps) {
      if (!scheduledToday.has(d)) continue; // dependência não vence neste dia
      if (!(await this.o.store.getRun(d, occ.localDate))) pending.push(d);
    }
    return pending;
  }

  /** Execução já registrada para qualquer das chaves (data ORIGINAL) da ocorrência. */
  private async findExisting(occ: Occurrence): Promise<MeetingRun | null> {
    for (const d of [occ.originalDate, ...occ.collidedOriginalDates]) {
      const r = await this.o.store.getRun(occ.meeting.id, d, occ.instance);
      if (r) return r;
    }
    return null;
  }

  private logEntry(occ: Occurrence, run: MeetingRun): TickResult['processed'][number] {
    return {
      meeting_id: occ.meeting.id,
      local_date: occ.originalDate,
      rescheduled_date: run.rescheduled_date,
      keys: run.idempotency_keys,
      collided_keys: run.idempotency_keys.slice(1),
      status: run.status,
      reason: run.reason,
    };
  }

  /** Registro explícito, para a ata, do reagendamento por feriado e da colisão de ocorrências. */
  private scheduleNotes(occ: Occurrence): string[] {
    const notes: string[] = [];
    const keys = occurrenceKeys(occ);
    if (isRescheduled(occ)) {
      notes.push(`reagendado por feriado/dia não útil: ocorrência original ${occ.originalDate} movida para ${occ.localDate} (mesmo horário local); chave de idempotência mantida: ${keys[0]}; rescheduled_date=${occ.localDate}`);
    }
    if (occ.collidedOriginalDates.length) {
      notes.push(`colisão: ocorrências originais ${[occ.originalDate, ...occ.collidedOriginalDates].join(', ')} coincidem em ${occ.localDate}; execução única; chaves registradas: ${keys.join(', ')}`);
    }
    return notes;
  }

  private base(occ: Occurrence, now: Date, delayMinutes: number): Omit<MeetingRun, 'status' | 'reason' | 'participants_present' | 'participants_absent' | 'model_calls'> {
    const m = occ.meeting;
    const moved = isRescheduled(occ);
    return {
      id: this.o.newId(),
      meeting_id: m.id,
      local_date: occ.originalDate, // chave: data ORIGINAL (P5 v2)
      instance: occ.instance,
      rescheduled_date: moved ? occ.localDate : null,
      reschedule_reason: moved ? 'holiday_move' : null,
      idempotency_keys: occurrenceKeys(occ),
      scheduled_for: occ.scheduledFor.toISOString(),
      executed_at: now.toISOString(),
      route: m.route,
      delay_minutes: delayMinutes,
      recovered: delayMinutes > this.o.onTimeToleranceMinutes,
      chair: m.chair,
      quorum_minimum: m.quorum.minimum,
    };
  }

  private async persistStatusOnly(occ: Occurrence, now: Date, reason: StatusReason, delayMinutes: number, extra?: { present?: string[]; modelCalls?: number; notes?: string[] }): Promise<MeetingOutcomeRecord> {
    const m = occ.meeting;
    const present = extra?.present ?? [];
    const run: MeetingRun = {
      ...this.base(occ, now, delayMinutes),
      status: 'status_only',
      reason,
      model_calls: extra?.modelCalls ?? 0,
      recovered: false,
      participants_present: present,
      participants_absent: m.participants.filter((p) => !present.includes(p)),
    };
    const minutes: Minutes = {
      run_id: run.id,
      summary: `Registro de status (${reason}): ritual ${m.id} de ${occ.localDate}${isRescheduled(occ) ? ` (original ${occ.originalDate})` : ''} não foi executado; pauta adiada para a próxima ocorrência. Nenhuma chamada de modelo.`,
      blockers: [],
      evidence_refs: [],
      outputs: [],
      notes: [...this.scheduleNotes(occ), ...(extra?.notes ?? [])],
    };
    const rec: MeetingOutcomeRecord = { run, minutes, decisions: [], actions: [] };
    const saved = await this.o.store.saveOutcome(rec);
    return saved.created ? rec : { ...rec, run: saved.run };
  }

  private async execute(occ: Occurrence, now: Date, delayMinutes: number): Promise<MeetingOutcomeRecord> {
    const m = occ.meeting;
    const notes: string[] = [];
    const collected = await this.o.collector.collect({ meeting: m, localDate: occ.originalDate, runDate: occ.localDate, instance: occ.instance });
    const modelCalls = collected.model_calls ?? 0;

    // insumos estruturados: só de participantes, 1 por agente (o último vence), schema estrito
    const byAgent = new Map<string, ParticipantInput>();
    for (const raw of collected.inputs) {
      const parsed = ParticipantInputSchema.safeParse(raw);
      if (!parsed.success) {
        notes.push(`insumo descartado: formato inválido (${parsed.error.issues[0]?.message ?? 'erro'})`);
        continue;
      }
      if (!m.participants.includes(parsed.data.agent_id)) {
        notes.push(`insumo descartado: ${parsed.data.agent_id} não é participante de ${m.id}`);
        continue;
      }
      byAgent.set(parsed.data.agent_id, parsed.data);
    }
    const inputs = [...byAgent.values()];
    const present = m.participants.filter((p) => byAgent.has(p));

    const statusOnly = (reason: StatusReason) => this.persistStatusOnly(occ, now, reason, delayMinutes, { present, modelCalls, notes });
    if (inputs.length === 0) return statusOnly('no_inputs_or_decisions');
    if (present.length < m.quorum.minimum || (m.quorum.chair_required && !present.includes(m.chair))) return statusOnly('quorum_not_met');
    const hasSubstance = inputs.some((i) => i.decisions.length > 0 || i.evidence_refs.length > 0 || i.blockers.length > 0);
    if (!hasSubstance) return statusOnly('no_inputs_or_decisions'); // regra do silêncio

    // decisões e tarefas
    const runId = this.o.newId();
    const decisions: Decision[] = [];
    const actions: ActionItem[] = [];
    for (const input of inputs) {
      for (const d of input.decisions) {
        const invalidOwner = d.actions.find((a) => !this.agentIds.has(a.owner));
        const wrongProposer = d.proposed_by !== input.agent_id;
        // D01: só ato reservado ao responsável (legal/contratual) espera o humano; decisão protegida de
        // governança vai ao verificador, sem aprovação humana de rotina; o resto é aprovado pela política.
        const status: DecisionStatus = d.authority_class === 'owner_reserved' ? 'pending_human' : d.authority_class === 'protected' ? 'pending_verifier' : 'approved';
        const needsHuman = d.authority_class === 'owner_reserved';
        const decisionId = this.o.newId();
        if (invalidOwner || wrongProposer) {
          notes.push(`decisão rejeitada (invalid_authority): ${wrongProposer ? `proposta por ${d.proposed_by} no insumo de ${input.agent_id}` : `responsável ${invalidOwner?.owner} inexistente`}`);
          decisions.push({ id: decisionId, run_id: runId, text: d.text, proposed_by: d.proposed_by, authority: m.authority, status: 'rejected_invalid_authority', needs_human_approval: needsHuman, evidence_refs: d.evidence_refs });
          continue;
        }
        decisions.push({ id: decisionId, run_id: runId, text: d.text, proposed_by: d.proposed_by, authority: m.authority, status, needs_human_approval: needsHuman, evidence_refs: d.evidence_refs });
        if (status !== 'approved') {
          if (d.actions.length) notes.push(`decisão "${d.text}" aguarda ${status === 'pending_human' ? 'o responsável (ato reservado)' : 'o verificador independente (decisão protegida)'}; ações propostas não criadas: ${d.actions.map((a) => `${a.title} (${a.owner})`).join('; ')}`);
          continue;
        }
        for (const a of d.actions) {
          actions.push({
            id: this.o.newId(),
            decision_id: decisionId,
            run_id: runId,
            title: a.title,
            owner_agent_id: a.owner,
            due_date: addBusinessDays(occ.localDate, a.due_in_business_days, this.o.calendar),
            status: 'open',
            created_at: now.toISOString(),
            closed_at: null,
            evidence_ref: null,
          });
        }
      }
    }

    const run: MeetingRun = {
      ...this.base(occ, now, delayMinutes),
      id: runId,
      status: 'completed',
      reason: null,
      model_calls: modelCalls,
      participants_present: present,
      participants_absent: m.participants.filter((p) => !present.includes(p)),
    };
    const minutes: Minutes = {
      run_id: runId,
      summary: [
        `${m.title} — ${occ.localDate}${isRescheduled(occ) ? ` (reagendado de ${occ.originalDate})` : ''}${run.recovered ? ` (recuperado, +${delayMinutes} min)` : ''}: ${present.length}/${m.participants.length} presentes (quórum ${m.quorum.minimum}); ${decisions.length} decisões; ${actions.length} tarefas.`,
        ...inputs.filter((i) => i.summary).map((i) => `${i.agent_id}: ${i.summary}`),
      ].join('\n'),
      blockers: [...new Set(inputs.flatMap((i) => i.blockers))],
      evidence_refs: [...new Set(inputs.flatMap((i) => i.evidence_refs))],
      outputs: [...m.outputs],
      notes: [...this.scheduleNotes(occ), ...notes],
    };
    const rec: MeetingOutcomeRecord = { run, minutes, decisions, actions };
    const saved = await this.o.store.saveOutcome(rec);
    return saved.created ? rec : { ...rec, run: saved.run };
  }
}

// --- acompanhamento de decisões (WF16) ---------------------------------------------------------

/** Tarefas abertas com prazo vencido (data local < hoje) são escaladas ao presidente do ritual. */
export async function escalateOverdue(store: Store, now: Date, tz = 'America/Sao_Paulo'): Promise<ActionItem[]> {
  const today = localPartsOf(now, tz).date;
  const escalated: ActionItem[] = [];
  for (const a of await store.listActions({ status: 'open' })) {
    if (a.due_date < today) escalated.push(await store.updateAction(a.id, { status: 'escalated' }));
  }
  return escalated;
}

/** Conclusão exige evidência (bloqueio `unverified_completion` do WF16). */
export async function completeAction(store: Store, id: string, evidenceRef: string, now: Date): Promise<ActionItem> {
  if (!evidenceRef.trim()) throw new Error('unverified_completion: conclusão de tarefa exige evidence_ref');
  return store.updateAction(id, { status: 'done', closed_at: now.toISOString(), evidence_ref: evidenceRef });
}
