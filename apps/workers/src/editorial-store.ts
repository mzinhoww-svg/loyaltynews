// EditorialStore em PostgreSQL (porta de @ln/editorial; contrato: packages/editorial/docs/editorial-store-contract.md).
// Registro inteiro em json (a porta troca o registro por inteiro; json e não jsonb para preservar a ordem das chaves); colunas escalares só para índice.
// UPSERT atômico por chave (last-writer-wins); auditoria em tabela somente-acréscimo lida por ORDER BY id.
// Limite conhecido: o PostgreSQL não guarda em json/jsonb o caractere NUL (U+0000); texto com NUL é recusado (a promessa rejeita).
import { randomUUID } from 'node:crypto';
import { asc, desc, sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import {
  COLLECTOR_ROUND_ACTION, GOOD_ROUND_PREFIX,
  type ArticleRecord, type AuditItem, type CorrectionRecord, type EditorialStore, type OutboxItem, type PublicationCommit, type PublicationCommitStep, type ReadReservation, type SourceState,
} from '@ln/editorial';

/** JSON puro: descarta undefined e garante que nada compartilhe referência com o chamador. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Writer = Pick<Db, 'insert'>;

async function upsertArticle(db: Writer, r: ArticleRecord): Promise<void> {
  const row = { articleId: r.articleId, status: r.status, editoria: r.editoria, updatedAt: new Date(r.updatedAt), record: plain(r) };
  await db.insert(schema.editorialArticle).values(row).onConflictDoUpdate({
    target: schema.editorialArticle.articleId,
    set: { status: row.status, editoria: row.editoria, updatedAt: row.updatedAt, record: row.record },
  });
}

async function upsertCorrection(db: Writer, r: CorrectionRecord): Promise<void> {
  const c = r.case;
  const row = { id: c.id, articleId: c.articleId, state: c.state, kind: c.kind, receivedAt: new Date(c.receivedAt), record: plain(r) };
  await db.insert(schema.editorialCorrection).values(row).onConflictDoUpdate({
    target: schema.editorialCorrection.id,
    set: { articleId: row.articleId, state: row.state, kind: row.kind, receivedAt: row.receivedAt, record: row.record },
  });
}

export class PgEditorialStore implements EditorialStore {
  constructor(private readonly db: Db) {}

  /** Só para teste: faz a PRÓXIMA commitPublication lançar no passo indicado, DENTRO da transação (consome o gatilho). */
  private fault: PublicationCommitStep | null = null;
  armFault(step: PublicationCommitStep | null): void {
    this.fault = step;
  }
  private maybeFail(step: PublicationCommitStep): void {
    if (this.fault === step) {
      this.fault = null;
      throw new Error(`falha injetada em ${step}`);
    }
  }

  /**
   * UMA transação: outbox (decide a idempotência), matéria publicada e auditoria. Chave de outbox já existente ⇒
   * 'duplicate' sem efeito (o INSERT ... ON CONFLICT DO NOTHING espera um commit concorrente e vê a linha dele).
   * Qualquer falha ⇒ rollback de tudo, inclusive o outbox. Entrada inválida rejeita antes de abrir a transação.
   */
  async commitPublication(c: PublicationCommit): Promise<{ outbox: 'enqueued' | 'duplicate' }> {
    const a = c.article;
    const o = c.outbox;
    if (!a.articleId || (a.status !== 'publicado' && a.status !== 'corrigido') || !a.publication || !c.audit.action || !c.audit.target || !o.queue || !o.refId || !o.idempotencyKey) {
      throw new Error('commitPublication: entrada inválida');
    }
    if (c.correction && !c.correction.case.id) throw new Error('commitPublication: correção inválida');
    return this.db.transaction(async (tx) => {
      const ins = await tx
        .insert(schema.outbox)
        .values({ id: randomUUID(), queue: o.queue, refId: o.refId, idempotencyKey: o.idempotencyKey })
        .onConflictDoNothing({ target: schema.outbox.idempotencyKey })
        .returning({ id: schema.outbox.id });
      if (ins.length === 0) return { outbox: 'duplicate' as const };
      this.maybeFail('after_outbox');
      await upsertArticle(tx, a);
      if (c.correction) await upsertCorrection(tx, c.correction); // o caso avança na MESMA transação (ADR-019 §c.5)
      this.maybeFail('after_article');
      await tx.insert(schema.editorialAudit).values({ at: c.audit.at, record: plain(c.audit) });
      this.maybeFail('after_audit');
      return { outbox: 'enqueued' as const };
    });
  }

  async listOutbox(): Promise<OutboxItem[]> {
    const rows = await this.db
      .select({ queue: schema.outbox.queue, refId: schema.outbox.refId, idempotencyKey: schema.outbox.idempotencyKey })
      .from(schema.outbox)
      .orderBy(asc(schema.outbox.createdAt), asc(schema.outbox.id));
    return rows;
  }

  async getArticle(id: string) {
    const [r] = await this.db.select({ record: schema.editorialArticle.record }).from(schema.editorialArticle).where(sql`${schema.editorialArticle.articleId} = ${id}`);
    return r ? (r.record as ArticleRecord) : undefined;
  }
  async putArticle(r: ArticleRecord) {
    await upsertArticle(this.db, r);
  }
  async listArticles() {
    return (await this.db.select({ record: schema.editorialArticle.record }).from(schema.editorialArticle)).map((r) => r.record as ArticleRecord);
  }

  async getCorrection(id: string) {
    const [r] = await this.db.select({ record: schema.editorialCorrection.record }).from(schema.editorialCorrection).where(sql`${schema.editorialCorrection.id} = ${id}`);
    return r ? (r.record as CorrectionRecord) : undefined;
  }
  async putCorrection(r: CorrectionRecord) {
    await upsertCorrection(this.db, r);
  }
  async listCorrections() {
    return (await this.db.select({ record: schema.editorialCorrection.record }).from(schema.editorialCorrection)).map((r) => r.record as CorrectionRecord);
  }

  async getSourceState(sourceId: string) {
    const [r] = await this.db.select({ record: schema.editorialSourceState.record }).from(schema.editorialSourceState).where(sql`${schema.editorialSourceState.sourceId} = ${sourceId}`);
    return r ? (r.record as SourceState) : undefined;
  }
  async putSourceState(s: SourceState) {
    const row = { sourceId: s.sourceId, enabled: s.enabled, termsStatus: s.termsStatus, updatedAt: new Date(s.updatedAt), record: plain(s) };
    await this.db.insert(schema.editorialSourceState).values(row).onConflictDoUpdate({
      target: schema.editorialSourceState.sourceId,
      set: { enabled: row.enabled, termsStatus: row.termsStatus, updatedAt: row.updatedAt, record: row.record },
    });
  }
  async listSourceStates() {
    return (await this.db.select({ record: schema.editorialSourceState.record }).from(schema.editorialSourceState)).map((r) => r.record as SourceState);
  }

  /**
   * Horário da última rodada boa da coleta: uma linha, filtrada no banco (a rota pública não pode ler a trilha inteira).
   * O próprio banco cancela a consulta no prazo (`statement_timeout` só desta transação) e a conexão volta ao pool.
   */
  async lastGoodRoundAt(prazoMs = 2000): Promise<string | null> {
    const t = schema.editorialAudit;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('statement_timeout', ${`${Math.trunc(prazoMs)}ms`}, true)`);
      const [r] = await tx.select({ at: t.at }).from(t)
        .where(sql`${t.record}->>'action' = ${COLLECTOR_ROUND_ACTION} and ${t.record}->>'userId' is null and starts_with(${t.record}->>'detail', ${GOOD_ROUND_PREFIX})`)
        .orderBy(desc(t.id)).limit(1);
      return r?.at ?? null;
    });
  }

  async appendAudit(a: AuditItem) {
    await this.db.insert(schema.editorialAudit).values({ at: a.at, record: plain(a) });
  }
  /**
   * Contar e gravar na mesma transação, depois de uma trava consultiva por alvo: outra instância só conta quando esta terminar.
   * Os horários são ISO 8601 em UTC (toISOString), então a comparação de texto segue a ordem do tempo.
   */
  async reserveRead(r: ReadReservation) {
    const t = schema.editorialAudit;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${r.action}:${r.target}`}))`);
      if (r.unless) {
        const from = new Date(r.atMs - r.unless.windowMs).toISOString();
        const [stop] = await tx.select({ id: t.id }).from(t)
          .where(sql`${t.at} > ${from} and ${t.record}->>'action' = ${r.unless.action} and ${t.record}->>'target' = ${r.target}`)
          .limit(1);
        if (stop) return { allowed: false, used: 0 };
      }
      const since = new Date(r.atMs - r.windowMs).toISOString();
      const rows = await tx.select({ id: t.id }).from(t)
        .where(sql`${t.at} > ${since} and ${t.record}->>'action' = ${r.action} and ${t.record}->>'target' = ${r.target}`)
        .limit(r.max);
      if (rows.length >= r.max) return { allowed: false, used: rows.length };
      const item: AuditItem = { at: new Date(r.atMs).toISOString(), userId: null, action: r.action, target: r.target };
      await tx.insert(t).values({ at: item.at, record: plain(item) });
      return { allowed: true, used: rows.length + 1 };
    });
  }
  async listAudit() {
    return (await this.db.select({ record: schema.editorialAudit.record }).from(schema.editorialAudit).orderBy(asc(schema.editorialAudit.id))).map(
      (r) => r.record as AuditItem,
    );
  }
}
