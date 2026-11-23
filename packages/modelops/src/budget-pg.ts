// Ledger do orçamento em PostgreSQL (tabelas budget_reservations, budget_ledger, budget_refill_fees e
// budget_kill_switch de @ln/db). Cada operação do gate roda numa transação com trava de consultoria
// (pg_advisory_xact_lock): processos diferentes não estouram o teto. O estado é reconstruído do banco a cada
// leitura, na ordem real da coluna seq; sobrevive a restart. Gatilhos do banco recusam transições ilegais.
// Só SQL direto: funciona com PGlite (testes) e com node-postgres (produção), sem depender do cliente.
import { sql, type SQL } from 'drizzle-orm';
import type { KillState, LedgerEvent, LedgerIO, LedgerStore } from './ledger';

export interface SqlRunner {
  execute(query: SQL): Promise<unknown>;
}

export interface SqlDatabase extends SqlRunner {
  transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T>;
}

type Row = Record<string, unknown>;

async function rowsOf(runner: SqlRunner, query: SQL): Promise<Row[]> {
  const res = (await runner.execute(query)) as { rows?: Row[] };
  return res.rows ?? [];
}

// Classe da tarefa é obrigatória: não há padrão silencioso (gap L4b do G4).
function requireTaskClass(e: LedgerEvent): string {
  if (!e.taskClass) throw new Error(`classe da tarefa ausente na reserva ${e.reservationId}: campo obrigatório`);
  return e.taskClass;
}

// Mês, valor reservado e estado de uma reserva, lidos do banco (fonte da verdade).
async function reservationOf(tx: SqlRunner, id: string): Promise<{ month: string; max: number }> {
  const r = await rowsOf(tx, sql`SELECT month_key, max_estimated_microusd FROM budget_reservations WHERE id = ${id}`);
  const row = r[0];
  if (!row) throw new Error(`reserva ${id} inexistente no banco`);
  return { month: String(row.month_key), max: Number(row.max_estimated_microusd) };
}

// O mês do evento tem de ser o mês da reserva: evento de outro mês é conflito, nunca gravado.
function assertSameMonth(eventMonth: string, reservationMonth: string, id: string): void {
  if (eventMonth !== reservationMonth) {
    throw new Error(`evento de ${eventMonth} para reserva ${id} de ${reservationMonth}: conflito de mês`);
  }
}

async function appendEvent(tx: SqlRunner, e: LedgerEvent): Promise<void> {
  const at = new Date(e.at);
  const id = e.reservationId;
  switch (e.type) {
    case 'reserve': {
      requireTaskClass(e);
      // sem padrões silenciosos: classe, bolsa, faixa, provedor, modelo e tarefa vêm do gate; faltando algum, a reserva não nasce
      for (const [k, v] of [['taskId', e.taskId], ['taskClass', e.taskClass], ['pool', e.pool], ['lane', e.lane], ['provider', e.provider], ['model', e.model]] as const) {
        if (v === undefined || v === '') throw new Error(`reserva sem ${k}: campo obrigatório`);
      }
      if (e.escalation === undefined) throw new Error('reserva sem escalation: campo obrigatório');
      if (!Number.isSafeInteger(e.amountMicro) || (e.amountMicro as number) < 0) throw new Error('reserva com valor inválido');
      const max = e.amountMicro as number;
      await tx.execute(sql`
        INSERT INTO budget_reservations
          (id, task_id, idempotency_key, month_key, route, provider, model, max_estimated_microusd, state, pool, task_class, lane, escalation, reserved_at)
        VALUES
          (${id}, ${e.taskId}, ${id}, ${e.monthKey}, ${e.route ?? ''}, ${e.provider}, ${e.model}, ${max},
           'reservada', ${e.pool}, ${requireTaskClass(e)}, ${e.lane}, ${e.escalation}, ${at})`);
      // Linha do ledger logo após a reserva; o guarda do banco confere que a reserva nasceu 'reservada'.
      await tx.execute(sql`
        INSERT INTO budget_ledger (id, month_key, reservation_id, kind, delta_microusd, idempotency_key, at)
        VALUES (${`${id}:reserva`}, ${e.monthKey}, ${id}, 'reserva', ${max}, ${`${id}:reserva`}, ${at})`);
      return;
    }
    case 'pending': {
      assertSameMonth(e.monthKey, (await reservationOf(tx, id)).month, id);
      await tx.execute(sql`UPDATE budget_reservations SET state = 'pendente' WHERE id = ${id}`);
      return;
    }
    case 'commit': {
      const res = await reservationOf(tx, id);
      assertSameMonth(e.monthKey, res.month, id);
      const actual = e.actualMicro ?? res.max;
      // Custo real negativo não existe: recusado aqui e pela checagem da migração 0020.
      if (actual < 0) throw new Error(`custo real negativo recusado para reserva ${id}`);
      // Ledger primeiro (o guarda confere que a reserva ainda está aberta ou pendente), depois o estado.
      await tx.execute(sql`
        INSERT INTO budget_ledger (id, month_key, reservation_id, kind, delta_microusd, idempotency_key, at)
        VALUES (${`${id}:conciliacao`}, ${res.month}, ${id}, 'conciliacao', ${actual - res.max}, ${`${id}:conciliacao`}, ${at})`);
      await tx.execute(sql`
        UPDATE budget_reservations
        SET state = 'conciliada', actual_microusd = ${actual}, generation_id = ${e.generationId ?? 'sem-id'}
        WHERE id = ${id}`);
      return;
    }
    case 'release': {
      const res = await reservationOf(tx, id);
      assertSameMonth(e.monthKey, res.month, id);
      // Ledger primeiro: com evidência obrigatória se a reserva estiver pendente (o guarda confere).
      await tx.execute(sql`
        INSERT INTO budget_ledger (id, month_key, reservation_id, kind, delta_microusd, idempotency_key, at, evidence)
        VALUES (${`${id}:liberacao`}, ${res.month}, ${id}, 'liberacao', ${-res.max}, ${`${id}:liberacao`}, ${at}, ${e.evidence ?? null})`);
      await tx.execute(sql`UPDATE budget_reservations SET state = 'liberada' WHERE id = ${id}`);
      return;
    }
    case 'refill_fee':
      // Taxa de compra de crédito: fora do teto, em tabela própria (DP-11/P3).
      await tx.execute(sql`
        INSERT INTO budget_refill_fees (id, month_key, amount_microusd, idempotency_key, at)
        VALUES (${id}, ${e.monthKey}, ${e.amountMicro ?? 0}, ${id}, ${at})`);
      return;
  }
}

// Reconstrói o log de eventos a partir das reservas gravadas, na ordem real (coluna seq).
async function readEvents(tx: SqlRunner): Promise<LedgerEvent[]> {
  const reservations = await rowsOf(
    tx,
    sql`SELECT id, task_id, month_key, route, provider, model, max_estimated_microusd, state, actual_microusd,
               pool, task_class, lane, escalation, reserved_at, generation_id
        FROM budget_reservations ORDER BY seq`,
  );
  const releases = await rowsOf(tx, sql`SELECT reservation_id, evidence FROM budget_ledger WHERE kind = 'liberacao'`);
  const evidenceBy = new Map(releases.map((r) => [String(r.reservation_id), (r.evidence as string | null) ?? undefined]));
  const refills = await rowsOf(tx, sql`SELECT id, month_key, amount_microusd, at FROM budget_refill_fees ORDER BY at, id`);

  const events: LedgerEvent[] = [];
  let seq = 0;
  for (const r of reservations) {
    const id = String(r.id);
    const max = Number(r.max_estimated_microusd);
    const at = new Date(r.reserved_at as string | Date).toISOString();
    const monthKey = String(r.month_key);
    seq += 1;
    events.push({
      seq,
      at,
      monthKey,
      type: 'reserve',
      reservationId: id,
      taskId: String(r.task_id),
      taskClass: r.task_class as LedgerEvent['taskClass'],
      pool: r.pool as LedgerEvent['pool'],
      lane: r.lane as LedgerEvent['lane'],
      route: String(r.route),
      provider: String(r.provider),
      model: String(r.model),
      escalation: Boolean(r.escalation),
      amountMicro: max,
    });
    if (r.state === 'pendente') {
      seq += 1;
      events.push({ seq, at, monthKey, type: 'pending', reservationId: id, reason: 'resultado incerto' });
    } else if (r.state === 'conciliada') {
      seq += 1;
      const actual = Number(r.actual_microusd);
      events.push({
        seq,
        at,
        monthKey,
        type: 'commit',
        reservationId: id,
        actualMicro: actual,
        overrun: actual > max,
        generationId: String(r.generation_id),
      });
    } else if (r.state === 'liberada') {
      seq += 1;
      events.push({ seq, at, monthKey, type: 'release', reservationId: id, evidence: evidenceBy.get(id) });
    }
  }
  for (const f of refills) {
    seq += 1;
    events.push({
      seq,
      at: new Date(f.at as string | Date).toISOString(),
      monthKey: String(f.month_key),
      type: 'refill_fee',
      reservationId: String(f.id),
      amountMicro: Number(f.amount_microusd),
    });
  }
  return events;
}

async function killOf(runner: SqlRunner): Promise<KillState> {
  const rows = await rowsOf(runner, sql`SELECT scope FROM budget_kill_switch WHERE active = true`);
  const scopes = rows.map((r) => String(r.scope));
  return {
    global: scopes.includes('global'),
    routes: scopes.filter((s) => s.startsWith('route:')).map((s) => s.slice('route:'.length)),
  };
}

function ioFor(tx: SqlRunner): LedgerIO {
  return {
    append: (e) => appendEvent(tx, e),
    readAll: async () => readEvents(tx),
    readKill: () => killOf(tx),
    // Id gerado pelo próprio banco: independe da contagem de eventos e não colide entre processos.
    nextReservationId: async () => {
      const r = await rowsOf(tx, sql`SELECT gen_random_uuid()::text AS id`);
      const id = r[0]?.id;
      if (typeof id !== 'string') throw new Error('gen_random_uuid() não devolveu id');
      return id;
    },
  };
}

export class PostgresLedgerStore implements LedgerStore {
  private readonly db: SqlDatabase;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  // Uma transação com a trava de consultoria do orçamento, serializada também dentro do processo.
  private withTx<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    const go = () =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ln_modelops_budget'))`);
        return fn(tx);
      });
    const run = this.chain.then(go, go);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // Trava de consultoria: uma transação por operação, serializada entre processos.
  withLock<T>(fn: (io: LedgerIO) => Promise<T>): Promise<T> {
    return this.withTx((tx) => fn(ioFor(tx)));
  }

  append(event: LedgerEvent): Promise<void> {
    return this.withLock((io) => io.append(event));
  }

  readAll(): Promise<readonly LedgerEvent[]> {
    return this.withLock((io) => io.readAll());
  }

  readKill(): Promise<KillState> {
    return killOf(this.db);
  }

  /** Liga ou desliga a parada SOB A MESMA TRAVA das reservas (uma reserva em curso termina antes; a próxima já vê a parada). */
  async setKill(scope: 'global' | `route:${string}`, active: boolean, reason: string, at: Date): Promise<void> {
    await this.withTx((tx) => writeKill(tx, scope, active, reason, at));
  }

  /**
   * Parada + efeito colateral (ex.: auditoria) na MESMA transação e sob a mesma trava: se `after` lançar, a parada é DESFEITA.
   * Quem aciona a parada nunca fica com a mudança aplicada sem o registro de auditoria.
   */
  async setKillWith(scope: 'global' | `route:${string}`, active: boolean, reason: string, at: Date, after: (tx: SqlRunner) => Promise<void>): Promise<void> {
    await this.withTx(async (tx) => {
      await writeKill(tx, scope, active, reason, at);
      await after(tx);
    });
  }
}

async function writeKill(tx: SqlRunner, scope: string, active: boolean, reason: string, at: Date): Promise<void> {
  await tx.execute(sql`
    INSERT INTO budget_kill_switch (scope, active, reason, at)
    VALUES (${scope}, ${active}, ${reason}, ${at})
    ON CONFLICT (scope) DO UPDATE SET active = EXCLUDED.active, reason = EXCLUDED.reason, at = EXCLUDED.at`);
}
