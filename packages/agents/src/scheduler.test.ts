import { beforeEach, describe, expect, it } from 'vitest';
import { createBrCalendar } from './calendar';
import { loadRegistries } from './config';
import { completeAction, escalateOverdue, RitualScheduler, StoreInputCollector, classify, occurrencesOn } from './scheduler';
import { InMemoryStore } from './store';
import type { ParticipantInput } from './schemas';

const reg = loadRegistries();
const ON = { rituais: true } as const;
const cal = createBrCalendar();
const meeting = (id: string) => reg.meetings.find((m) => m.id === id)!;
const at = (date: string, hhmm: string, plusMin = 0) => new Date(new Date(`${date}T${hhmm}:00-03:00`).getTime() + plusMin * 60000);

let store: InMemoryStore;
let sched: RitualScheduler;
let n = 0;
beforeEach(() => {
  store = new InMemoryStore();
  n = 0;
  sched = new RitualScheduler({ registries: reg, calendar: cal, store, collector: new StoreInputCollector(store), flags: ON, newId: () => `id-${++n}` });
});

const input = (agent: string, extra: Partial<ParticipantInput> = {}): ParticipantInput => ({
  agent_id: agent, summary: `resumo ${agent}`, blockers: [], evidence_refs: [], decisions: [], ...extra,
});
/** envia insumos de todos os participantes do ritual; o presidente traz uma decisão com tarefa */
async function feedFull(id: string, date: string, opts: { cls?: 'automatic' | 'protected' | 'owner_reserved'; skip?: string[] } = {}) {
  const m = meeting(id);
  for (const p of m.participants) {
    if (opts.skip?.includes(p)) continue;
    await store.putInput(id, date, input(p, p === m.chair ? {
      evidence_refs: ['ev-1'],
      decisions: [{ text: `Decisão de ${id}`, proposed_by: p, authority_class: opts.cls ?? 'automatic', evidence_refs: ['ev-1'], actions: [{ title: 'Executar pauta', owner: m.participants[1] ?? p, due_in_business_days: 2 }] }],
    } : {}));
  }
}

describe('janela de recuperação P5 (fronteiras)', () => {
  const occ = (id: string, date: string) => occurrencesOn(reg.meetings, date, cal).find((o) => o.meeting.id === id)!;
  const pol = reg.recoveryPolicy;

  it('antes do horário: não vence', () => {
    expect(classify(occ('D-mercado', '2026-11-23'), at('2026-11-23', '05:59'), pol).kind).toBe('not_due');
  });
  it('+0 e +120 min: roda; +121 min: status_only (sem modelo)', () => {
    const o = occ('D-mercado', '2026-11-23');
    expect(classify(o, at('2026-11-23', '06:00'), pol)).toMatchObject({ kind: 'run', delayMinutes: 0 });
    expect(classify(o, at('2026-11-23', '06:00', 120), pol)).toMatchObject({ kind: 'run', delayMinutes: 120 });
    expect(classify(o, at('2026-11-23', '06:00', 121), pol)).toMatchObject({ kind: 'status_only', reason: 'recovery_window_expired' });
    // 120 min e 59 s ainda conta como "120" (piso) e portanto passa do limite inclusive? não: > 120 min exatos falha
    expect(classify(o, new Date(at('2026-11-23', '06:00', 120).getTime() + 1000), pol).kind).toBe('status_only');
  });
  it('dia seguinte: status_only por host desligado', () => {
    expect(classify(occ('D-mercado', '2026-11-23'), at('2026-11-24', '06:00'), pol)).toMatchObject({ kind: 'status_only', reason: 'host_off_previous_day' });
  });

  it('PC desligado às 06:00 e religado às 07:30 (+90): o daily roda uma vez; às 08:30 (+150) vira status', async () => {
    await feedFull('D-mercado', '2026-11-23');
    await sched.tick(at('2026-11-23', '07:30'));
    await sched.tick(at('2026-11-23', '07:31')); // dois reinícios dentro da janela -> uma execução
    const runs = await store.listRuns({ meetingId: 'D-mercado' });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'completed', recovered: true, delay_minutes: 90, model_calls: 0 });

    // outro dia: religado às 08:30 -> status_only, nenhuma chamada de modelo
    await feedFull('D-mercado', '2026-11-24');
    await sched.tick(at('2026-11-24', '08:30'));
    const late = await store.getRun('D-mercado', '2026-11-24');
    expect(late).toMatchObject({ status: 'status_only', reason: 'recovery_window_expired', model_calls: 0 });
    expect((await store.listDecisions(late!.id))).toEqual([]);
    expect((await store.getMinutes(late!.id))!.summary).toMatch(/pauta adiada/);
  });

  it('host desligado a noite toda: rituais do dia anterior viram status_only', async () => {
    await sched.tick(at('2026-11-24', '05:00')); // lookback 1: pega 23/11 inteiro
    // inclui as ocorrências movidas de 20/11 (feriado) para 23/11: a chave é a data original, a efetiva é rescheduled_date
    const runs = (await store.listRuns()).filter((r) => (r.rescheduled_date ?? r.local_date) === '2026-11-23');
    expect(runs.length).toBe(occurrencesOn(reg.meetings, '2026-11-23', cal).length);
    expect(runs.every((r) => r.status === 'status_only' && r.reason === 'host_off_previous_day')).toBe(true);
  });

  it('segunda feriado: semanal roda na terça com a chave da data ORIGINAL; reinício não duplica (P5 v2)', async () => {
    const sched2 = new RitualScheduler({ registries: reg, calendar: cal, store, flags: ON, collector: new StoreInputCollector(store), lookbackDays: 0 });
    await feedFull('W-cross', '2027-11-15'); // insumos pela identidade da ocorrência = data original
    await sched2.tick(at('2027-11-15', '09:00')); // feriado: nada
    expect(await store.listRuns()).toEqual([]);
    const t1 = await sched2.tick(at('2027-11-16', '09:00'));
    const t2 = await sched2.tick(at('2027-11-16', '09:40')); // segundo reinício na terça
    const runs = await store.listRuns({ meetingId: 'W-cross' });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'completed', local_date: '2027-11-15', rescheduled_date: '2027-11-16', reschedule_reason: 'holiday_move',
      idempotency_keys: ['W-cross+2027-11-15'],
    });
    // registro explícito: log do tick, ata e consulta pela chave
    expect(t1.processed.find((p) => p.meeting_id === 'W-cross')).toMatchObject({ local_date: '2027-11-15', rescheduled_date: '2027-11-16', keys: ['W-cross+2027-11-15'], collided_keys: [] });
    expect(t2.processed.find((p) => p.meeting_id === 'W-cross')).toBeUndefined();
    const minutes = (await store.getMinutes(runs[0]!.id))!;
    expect(minutes.notes.join(' ')).toMatch(/reagendado por feriado.*original 2027-11-15.*movida para 2027-11-16.*W-cross\+2027-11-15.*rescheduled_date=2027-11-16/);
    expect(minutes.summary).toMatch(/reagendado de 2027-11-15/);
    expect(await store.getRun('W-cross', '2027-11-15')).not.toBeNull();
    expect(await store.getRun('W-cross', '2027-11-16')).toBeNull(); // a data efetiva NÃO é chave
  });

  it('ocorrência movida que perde a janela vira status_only com a mesma chave e o reagendamento registrado', async () => {
    const sched2 = new RitualScheduler({ registries: reg, calendar: cal, store, flags: ON, collector: new StoreInputCollector(store), lookbackDays: 0 });
    await sched2.tick(at('2027-11-16', '09:00', 125)); // W-cross 09:00 + 125 min
    const r = (await store.getRun('W-cross', '2027-11-15'))!;
    expect(r).toMatchObject({ status: 'status_only', reason: 'recovery_window_expired', rescheduled_date: '2027-11-16' });
    expect((await store.getMinutes(r.id))!.notes.join(' ')).toMatch(/reagendado por feriado/);
    // novo reinício dentro do mesmo dia não cria outra execução
    await sched2.tick(at('2027-11-16', '12:00'));
    expect(await store.listRuns({ meetingId: 'W-cross' })).toHaveLength(1);
  });

  it('chave original também após virar o dia: a data efetiva passada não gera chave nova', async () => {
    const sched2 = new RitualScheduler({ registries: reg, calendar: cal, store, flags: ON, collector: new StoreInputCollector(store), lookbackDays: 2 });
    await sched2.tick(at('2027-11-16', '09:00', 125));
    await sched2.tick(at('2027-11-17', '06:00')); // dia seguinte, lookback cobre 16/11
    expect(await store.listRuns({ meetingId: 'W-cross' })).toHaveLength(1);
  });

  it('colisão: duas ocorrências originais na mesma data efetiva rodam uma vez, com as duas chaves registradas', async () => {
    // sexta 27/11 e sexta 04/12 de 2026 feriadas, e toda a semana entre elas também: ambas movem para segunda 07/12
    const calx = createBrCalendar(['2026-11-27', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']);
    const occ = occurrencesOn(reg.meetings, '2026-12-07', calx).find((o) => o.meeting.id === 'W-performance')!;
    expect(occ).toMatchObject({ originalDate: '2026-11-27', collidedOriginalDates: ['2026-12-04'], localDate: '2026-12-07' });
    expect(occurrencesOn(reg.meetings, '2026-12-04', calx).some((o) => o.meeting.id === 'W-performance')).toBe(false);

    await feedFull('W-performance', '2026-11-27');
    const sched2 = new RitualScheduler({ registries: reg, calendar: calx, store, flags: ON, collector: new StoreInputCollector(store), lookbackDays: 0 });
    const t1 = await sched2.tick(at('2026-12-07', '15:00'));
    await sched2.tick(at('2026-12-07', '15:20'));
    const runs = await store.listRuns({ meetingId: 'W-performance' });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'completed', local_date: '2026-11-27', rescheduled_date: '2026-12-07',
      idempotency_keys: ['W-performance+2026-11-27', 'W-performance+2026-12-04'],
    });
    expect(t1.processed.find((p) => p.meeting_id === 'W-performance')).toMatchObject({ collided_keys: ['W-performance+2026-12-04'] });
    const notes = (await store.getMinutes(runs[0]!.id))!.notes.join(' ');
    expect(notes).toMatch(/colisão: ocorrências originais 2026-11-27, 2026-12-04 coincidem em 2026-12-07; execução única; chaves registradas: W-performance\+2026-11-27, W-performance\+2026-12-04/);
    expect(notes).toMatch(/reagendado por feriado/);
    // as duas chaves encontram a mesma execução
    expect((await store.getRun('W-performance', '2026-12-04'))!.id).toBe(runs[0]!.id);
  });

  it('dia sem deslocamento: sem rescheduled_date, chave = data do dia e nenhuma nota de reagendamento', async () => {
    await feedFull('D-mercado', '2026-11-23');
    await sched.tick(at('2026-11-23', '06:00'));
    const r = (await store.getRun('D-mercado', '2026-11-23'))!;
    expect(r).toMatchObject({ local_date: '2026-11-23', rescheduled_date: null, reschedule_reason: null, idempotency_keys: ['D-mercado+2026-11-23'] });
    expect((await store.getMinutes(r.id))!.notes.join(' ')).not.toMatch(/reagendado|colisão/);
  });
});

describe('execução, ata, decisões e tarefas', () => {
  it('daily completo: ata, decisão aprovada, tarefa com responsável e prazo em dias úteis', async () => {
    await feedFull('D-mercado', '2026-11-19'); // quinta
    await sched.tick(at('2026-11-19', '06:00'));
    const run = (await store.getRun('D-mercado', '2026-11-19'))!;
    expect(run).toMatchObject({ status: 'completed', reason: null, chair: 'editor_mercado', recovered: false });
    expect(run.participants_present.sort()).toEqual(['editor_mercado', 'writer_mercado']);
    const minutes = (await store.getMinutes(run.id))!;
    expect(minutes.summary).toMatch(/2\/2 presentes/);
    expect(minutes.outputs).toEqual(['pauta priorizada', 'tarefas', 'bloqueios']);
    const [d] = await store.listDecisions(run.id);
    expect(d).toMatchObject({ status: 'approved', proposed_by: 'editor_mercado', needs_human_approval: false });
    const [a] = await store.listActions({ runId: run.id });
    expect(a).toMatchObject({ owner_agent_id: 'writer_mercado', status: 'open', title: 'Executar pauta', decision_id: d!.id });
    // quinta 19/11 + 2 dias úteis: pula 20/11 (feriado) e fim de semana -> terça 24/11
    expect(a!.due_date).toBe('2026-11-24');
  });

  it('regra do silêncio: sem insumos/decisões/evidências -> status_only', async () => {
    await sched.tick(at('2026-11-23', '06:00'));
    expect(await store.getRun('D-mercado', '2026-11-23')).toMatchObject({ status: 'status_only', reason: 'no_inputs_or_decisions' });
    // insumos vazios também: só resumo, nada novo
    await store.putInput('D-programas', '2026-11-23', input('editor_programas'));
    await store.putInput('D-programas', '2026-11-23', input('writer_programas'));
    await sched.tick(at('2026-11-23', '06:01'));
    expect(await store.getRun('D-programas', '2026-11-23')).toMatchObject({ status: 'status_only', reason: 'no_inputs_or_decisions' });
  });

  it('quórum: presidente obrigatório e mínimo de participantes', async () => {
    await feedFull('D-editorial', '2026-11-23', { skip: ['director_editorial'] }); // sem presidente
    await sched.tick(at('2026-11-23', '06:20'));
    expect(await store.getRun('D-editorial', '2026-11-23')).toMatchObject({ status: 'status_only', reason: 'quorum_not_met' });

    // 8 de 12 presentes com presidente -> completa
    const m = meeting('D-editorial');
    await feedFull('D-editorial', '2026-11-24', { skip: m.participants.filter((p) => p !== m.chair).slice(0, 4) });
    await sched.tick(at('2026-11-24', '06:20'));
    expect(await store.getRun('D-editorial', '2026-11-24')).toMatchObject({ status: 'completed' });
    // 7 de 12 -> quórum insuficiente
    await feedFull('D-editorial', '2026-11-25', { skip: m.participants.filter((p) => p !== m.chair).slice(0, 5) });
    await sched.tick(at('2026-11-25', '06:20'));
    expect(await store.getRun('D-editorial', '2026-11-25')).toMatchObject({ status: 'status_only', reason: 'quorum_not_met' });
  });

  it('autoridade inválida: responsável inexistente ou proposta de outro agente é rejeitada, sem tarefa', async () => {
    await store.putInput('D-mercado', '2026-11-23', input('editor_mercado', {
      evidence_refs: ['e'],
      decisions: [
        { text: 'dono fantasma', proposed_by: 'editor_mercado', authority_class: 'automatic', evidence_refs: [], actions: [{ title: 'x', owner: 'fantasma', due_in_business_days: 1 }] },
        { text: 'em nome de outro', proposed_by: 'publisher', authority_class: 'automatic', evidence_refs: [], actions: [{ title: 'y', owner: 'writer_mercado', due_in_business_days: 1 }] },
        { text: 'válida', proposed_by: 'editor_mercado', authority_class: 'automatic', evidence_refs: [], actions: [{ title: 'z', owner: 'writer_mercado', due_in_business_days: 1 }] },
      ],
    }));
    await store.putInput('D-mercado', '2026-11-23', input('writer_mercado'));
    await sched.tick(at('2026-11-23', '06:00'));
    const run = (await store.getRun('D-mercado', '2026-11-23'))!;
    const ds = await store.listDecisions(run.id);
    expect(ds.map((d) => d.status).sort()).toEqual(['approved', 'rejected_invalid_authority', 'rejected_invalid_authority']);
    expect((await store.listActions({ runId: run.id })).map((a) => a.title)).toEqual(['z']);
    expect((await store.getMinutes(run.id))!.notes.join(' ')).toMatch(/invalid_authority/);
  });

  it('alçada (D01): automática aprova; protegida vai ao verificador; só ato reservado ao responsável espera humano', async () => {
    const m = meeting('M-board');
    const mk = (cls: 'automatic' | 'protected' | 'owner_reserved') => ({ text: `d-${cls}`, proposed_by: m.chair, authority_class: cls, evidence_refs: [], actions: [{ title: `t-${cls}`, owner: 'director_technology', due_in_business_days: 1 }] });
    for (const p of m.participants) await store.putInput('M-board', '2026-12-01', input(p, p === m.chair ? { evidence_refs: ['e'], decisions: [mk('automatic'), mk('protected'), mk('owner_reserved')] } : {}));
    await sched.tick(at('2026-12-01', '10:00'));
    const run = (await store.getRun('M-board', '2026-12-01'))!;
    expect(run.status).toBe('completed');
    const ds = Object.fromEntries((await store.listDecisions(run.id)).map((d) => [d.text, d]));
    expect(ds['d-automatic']).toMatchObject({ status: 'approved', needs_human_approval: false });
    expect(ds['d-protected']).toMatchObject({ status: 'pending_verifier', needs_human_approval: false });
    expect(ds['d-owner_reserved']).toMatchObject({ status: 'pending_human', needs_human_approval: true });
    // só a aprovada gera tarefa; as outras ficam registradas na ata
    expect((await store.listActions({ runId: run.id })).map((a) => a.title)).toEqual(['t-automatic']);
    const notes = (await store.getMinutes(run.id))!.notes.join(' ');
    expect(notes).toMatch(/verificador independente/);
    expect(notes).toMatch(/responsável \(ato reservado\)/);
  });

  it('M-board sem alçada declarada não pede aprovação humana de rotina', async () => {
    await feedFull('M-board', '2026-12-01');
    await sched.tick(at('2026-12-01', '10:00'));
    const run = (await store.getRun('M-board', '2026-12-01'))!;
    expect((await store.listDecisions(run.id))[0]).toMatchObject({ status: 'approved', needs_human_approval: false });
  });

  it('insumo de quem não participa ou fora do schema é descartado e registrado', async () => {
    await store.putInput('D-mercado', '2026-11-23', input('publisher', { evidence_refs: ['x'] }));
    await store.putInput('D-mercado', '2026-11-23', { agent_id: 'editor_mercado', summary: 1 } as never);
    await store.putInput('D-mercado', '2026-11-23', input('writer_mercado', { evidence_refs: ['e'] }));
    await sched.tick(at('2026-11-23', '06:00'));
    const run = (await store.getRun('D-mercado', '2026-11-23'))!;
    expect(run.status).toBe('status_only'); // só 1 presente (redator), presidente ausente
    expect(run.reason).toBe('quorum_not_met');
    const notes = (await store.getMinutes(run.id))!.notes.join(' ');
    expect(notes).toMatch(/não é participante/);
    expect(notes).toMatch(/formato inválido/);
  });
});

describe('D-sync espera os dailies que consolida', () => {
  it('aguarda dailies sem registro; roda depois que todos rodaram ou viraram status_only', async () => {
    const date = '2026-11-23';
    // ninguém enviou insumos; às 07:26 os dailies de diretoria já tiveram registro (status_only) -> D-sync roda/vira status
    await feedFull('D-sync', date);
    // tick às 07:26 processa em ordem de horário: dependências primeiro
    const res = await sched.tick(at(date, '07:26'));
    const order = res.processed.map((p) => p.meeting_id);
    expect(order.indexOf('D-trust')).toBeLessThan(order.indexOf('D-sync'));
    expect(order.indexOf('D-growth')).toBeLessThan(order.indexOf('D-sync'));
    expect(await store.getRun('D-sync', date)).toMatchObject({ status: 'completed' });
  });

  it('dependência que falhou: D-sync fica em waiting e roda no tick seguinte; passada a janela vira status_only', async () => {
    const date = '2026-11-23';
    await feedFull('D-sync', date);
    await feedFull('D-trust', date);
    let broken = true;
    const inner = new StoreInputCollector(store);
    const flaky = {
      collect: async (ctx: Parameters<StoreInputCollector['collect']>[0]) => {
        if (broken && ctx.meeting.id === 'D-trust') throw new Error('coletor indisponível');
        return inner.collect(ctx);
      },
    };
    const s = new RitualScheduler({ registries: reg, calendar: cal, store, collector: flaky, flags: ON, lookbackDays: 0 });
    const t1 = await s.tick(at(date, '07:26'));
    expect(t1.errors.map((e) => e.meeting_id)).toEqual(['D-trust']);
    expect(t1.waiting).toEqual([{ meeting_id: 'D-sync', local_date: date, waiting_for: ['D-trust'] }]);
    expect(await store.getRun('D-trust', date)).toBeNull();
    expect(await store.getRun('D-sync', date)).toBeNull();

    broken = false;
    await s.tick(at(date, '07:40'));
    expect(await store.getRun('D-trust', date)).toMatchObject({ status: 'completed', recovered: true }); // 07:15 + 25 min
    expect(await store.getRun('D-sync', date)).toMatchObject({ status: 'completed' });

    // outro dia: dependência continua quebrada até D-sync estourar a janela (07:25 + 121 min)
    broken = true;
    const d2 = '2026-11-24';
    await feedFull('D-sync', d2);
    await feedFull('D-trust', d2);
    const w = await s.tick(at(d2, '07:26'));
    expect(w.waiting).toHaveLength(1);
    await s.tick(at(d2, '07:25', 121));
    expect(await store.getRun('D-sync', d2)).toMatchObject({ status: 'status_only', reason: 'recovery_window_expired' });
  });
});

describe('flag rituais (desligada por padrão)', () => {
  it('sem a flag, tick não executa nada e raiseEvent recusa', async () => {
    const off = new RitualScheduler({ registries: reg, calendar: cal, store, collector: new StoreInputCollector(store) });
    await feedFull('D-mercado', '2026-11-23');
    const r = await off.tick(at('2026-11-23', '06:00'));
    expect(r).toMatchObject({ skipped: 'flag_rituais_off', processed: [] });
    expect(await store.listRuns()).toEqual([]);
    await expect(off.raiseEvent('X-incident', 'i1', at('2026-11-23', '06:00'))).rejects.toThrow(/flag rituais desligada/);
  });
});

describe('X-incident (evento) e acompanhamento de tarefas', () => {
  it('evento: idempotente por instance e várias ocorrências no mesmo dia', async () => {
    const now = at('2026-11-23', '14:00');
    const m = meeting('X-incident');
    for (const inst of ['inc-1', 'inc-2']) {
      for (const p of m.participants) await store.putInput('X-incident', '2026-11-23', input(p, p === m.chair ? { blockers: ['indisponibilidade'] } : {}), inst);
    }
    const r1 = await sched.raiseEvent('X-incident', 'inc-1', now);
    const r1b = await sched.raiseEvent('X-incident', 'inc-1', new Date(now.getTime() + 60000));
    const r2 = await sched.raiseEvent('X-incident', 'inc-2', now);
    expect(r1b.id).toBe(r1.id);
    expect(r2.id).not.toBe(r1.id);
    expect(r1).toMatchObject({ status: 'completed', instance: 'inc-1' });
    expect(await store.listRuns({ meetingId: 'X-incident' })).toHaveLength(2);
    await expect(sched.raiseEvent('D-mercado', 'x', now)).rejects.toThrow(/inexistente/);
  });

  it('tarefa vencida é escalada; conclusão exige evidência', async () => {
    await feedFull('D-mercado', '2026-11-23');
    await sched.tick(at('2026-11-23', '06:00'));
    const [a] = await store.listActions({ status: 'open' });
    expect(a!.due_date).toBe('2026-11-25');
    expect(await escalateOverdue(store, at('2026-11-25', '23:00'))).toEqual([]); // vence hoje: ainda no prazo
    const esc = await escalateOverdue(store, at('2026-11-26', '00:30'));
    expect(esc).toHaveLength(1);
    expect(esc[0]!.status).toBe('escalated');
    await expect(completeAction(store, a!.id, '  ', at('2026-11-26', '09:00'))).rejects.toThrow(/unverified_completion/);
    const done = await completeAction(store, a!.id, 'pr#12', at('2026-11-26', '09:00'));
    expect(done).toMatchObject({ status: 'done', evidence_ref: 'pr#12' });
  });
});
