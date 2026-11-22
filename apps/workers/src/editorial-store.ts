// EditorialStore em PostgreSQL (porta de @ln/editorial; contrato: packages/editorial/docs/editorial-store-contract.md).
// Registro inteiro em json (a porta troca o registro por inteiro; json e não jsonb para preservar a ordem das chaves); colunas escalares só para índice.
// UPSERT atômico por chave (last-writer-wins); auditoria em tabela somente-acréscimo lida por ORDER BY id.
// Limite conhecido: o PostgreSQL não guarda em json/jsonb o caractere NUL (U+0000); texto com NUL é recusado (a promessa rejeita).
import { asc, sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import type { ArticleRecord, AuditItem, CorrectionRecord, EditorialStore, SourceState } from '@ln/editorial';

/** JSON puro: descarta undefined e garante que nada compartilhe referência com o chamador. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class PgEditorialStore implements EditorialStore {
  constructor(private readonly db: Db) {}

  async getArticle(id: string) {
    const [r] = await this.db.select({ record: schema.editorialArticle.record }).from(schema.editorialArticle).where(sql`${schema.editorialArticle.articleId} = ${id}`);
    return r ? (r.record as ArticleRecord) : undefined;
  }
  async putArticle(r: ArticleRecord) {
    const row = { articleId: r.articleId, status: r.status, editoria: r.editoria, updatedAt: new Date(r.updatedAt), record: plain(r) };
    await this.db.insert(schema.editorialArticle).values(row).onConflictDoUpdate({
      target: schema.editorialArticle.articleId,
      set: { status: row.status, editoria: row.editoria, updatedAt: row.updatedAt, record: row.record },
    });
  }
  async listArticles() {
    return (await this.db.select({ record: schema.editorialArticle.record }).from(schema.editorialArticle)).map((r) => r.record as ArticleRecord);
  }

  async getCorrection(id: string) {
    const [r] = await this.db.select({ record: schema.editorialCorrection.record }).from(schema.editorialCorrection).where(sql`${schema.editorialCorrection.id} = ${id}`);
    return r ? (r.record as CorrectionRecord) : undefined;
  }
  async putCorrection(r: CorrectionRecord) {
    const c = r.case;
    const row = { id: c.id, articleId: c.articleId, state: c.state, kind: c.kind, receivedAt: new Date(c.receivedAt), record: plain(r) };
    await this.db.insert(schema.editorialCorrection).values(row).onConflictDoUpdate({
      target: schema.editorialCorrection.id,
      set: { articleId: row.articleId, state: row.state, kind: row.kind, receivedAt: row.receivedAt, record: row.record },
    });
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

  async appendAudit(a: AuditItem) {
    await this.db.insert(schema.editorialAudit).values({ at: a.at, record: plain(a) });
  }
  async listAudit() {
    return (await this.db.select({ record: schema.editorialAudit.record }).from(schema.editorialAudit).orderBy(asc(schema.editorialAudit.id))).map(
      (r) => r.record as AuditItem,
    );
  }
}
