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
async function feedFull(id: string, date: string, opts: { humanGate?: boolean; skip?: string[] } = {}) {
  const m = meeting(id);
  for (const p of m.participants) {
    if (opts.skip?.includes(p)) continue;
    await store.putInput(id, date, input(p, p === m.chair ? {
      evidence_refs: ['ev-1'],
      decisions: [{ text: `Decisão de ${id}`, proposed_by: p, needs_human_approval: opts.humanGate ?? false, evidence_refs: ['ev-1'], actions: [{ title: 'Executar pauta', owner: m.participants[1] ?? p, due_in_business_days: 2 }] }],
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
    const runs = await store.listRuns({ localDate: '2026-11-23' });
    expect(runs.length).toBe(occurrencesOn(reg.meetings, '2026-11-23', cal).length);
    expect(runs.every((r) => r.status === 'status_only' && r.reason === 'host_off_previous_day')).toBe(true);
  });

  it('segunda feriado: semanal roda na terça (idempotente em reinícios)', async () => {
    const sched2 = new RitualScheduler({ registries: reg, calendar: cal, store, flags: ON, collector: new StoreInputCollector(store), lookbackDays: 0 });
    await feedFull('W-cross', '2027-11-16');
    await sched2.tick(at('2027-11-15', '09:00')); // feriado: nada
    expect(await store.listRuns()).toEqual([]);
    await sched2.tick(at('2027-11-16', '09:00'));
    const r = await store.getRun('W-cross', '2027-11-16');
    expect(r?.status).toBe('completed');
    expect(await store.getRun('W-cross', '2027-11-15')).toBeNull();
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
        { text: 'dono fantasma', proposed_by: 'editor_mercado', needs_human_approval: false, evidence_refs: [], actions: [{ title: 'x', owner: 'fantasma', due_in_business_days: 1 }] },
        { text: 'em nome de outro', proposed_by: 'publisher', needs_human_approval: false, evidence_refs: [], actions: [{ title: 'y', owner: 'writer_mercado', due_in_business_days: 1 }] },
        { text: 'válida', proposed_by: 'editor_mercado', needs_human_approval: false, evidence_refs: [], actions: [{ title: 'z', owner: 'writer_mercado', due_in_business_days: 1 }] },
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

  it('M-board: decisões nascem pending_human e as ações propostas não são criadas', async () => {
    await feedFull('M-board', '2026-12-01', { humanGate: false });
    await sched.tick(at('2026-12-01', '10:00'));
    const run = (await store.getRun('M-board', '2026-12-01'))!;
    expect(run.status).toBe('completed');
    const [d] = await store.listDecisions(run.id);
    expect(d).toMatchObject({ status: 'pending_human', needs_human_approval: true });
    expect(await store.listActions({ runId: run.id })).toEqual([]);
    expect((await store.getMinutes(run.id))!.notes.join(' ')).toMatch(/aprovação humana/);
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
