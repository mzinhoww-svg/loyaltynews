import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EDITORIAL_STORE_CONTRACT, runEditorialStoreContract } from '../api/store-contract';
import type { StoreFactory } from '../api/store-contract';
import { InMemoryEditorialStore } from '../api/store';
import type { ArticleRecord, AuditItem, CorrectionRecord, EditorialStore, OutboxItem, PublicationCommit, PublicationCommitStep, SourceState } from '../api/store';

// 1) A implementação de referência passa em TODA a suíte (é o que o Backend deve reproduzir sobre PostgreSQL).
runEditorialStoreContract('InMemoryEditorialStore', () => { const s = new InMemoryEditorialStore(); return { store: s, armFault: (step) => s.armFault(step) }; });

// 2) Meta-teste: a suíte precisa REPROVAR implementações erradas (senão não protege nada).
class Base implements EditorialStore {
  protected articles = new Map<string, ArticleRecord>();
  protected corrections = new Map<string, CorrectionRecord>();
  protected sources = new Map<string, SourceState>();
  protected audit: AuditItem[] = [];
  protected outbox: OutboxItem[] = [];
  async getArticle(id: string) { return this.articles.get(id); }
  async putArticle(r: ArticleRecord) { this.articles.set(r.articleId, r); }
  async listArticles() { return [...this.articles.values()]; }
  async getCorrection(id: string) { return this.corrections.get(id); }
  async putCorrection(r: CorrectionRecord) { this.corrections.set(r.case.id, r); }
  async listCorrections() { return [...this.corrections.values()]; }
  async getSourceState(id: string) { return this.sources.get(id); }
  async putSourceState(s: SourceState) { this.sources.set(s.sourceId, s); }
  async listSourceStates() { return [...this.sources.values()]; }
  async appendAudit(a: AuditItem) { this.audit.push(a); }
  async listAudit() { return [...this.audit]; }
  async listOutbox() { return [...this.outbox]; }
  async commitPublication(c: PublicationCommit) {
    this.articles.set(c.article.articleId, c.article); this.audit.push(c.audit); this.outbox.push(c.outbox);
    return { outbox: 'enqueued' as const };
  }
}

/** Sem cópia: devolve e guarda as mesmas referências (aliasing). */
class AliasingStore extends Base {}
/** "Upsert" que mescla com o registro antigo (campos removidos sobrevivem) e copia só na entrada. */
class MergingStore extends InMemoryEditorialStore {
  private readonly prev = new Map<string, ArticleRecord>();
  override async putArticle(r: ArticleRecord) {
    const merged = { ...(this.prev.get(r.articleId) ?? {}), ...structuredClone(r) } as ArticleRecord;
    this.prev.set(r.articleId, merged);
    await super.putArticle(merged);
  }
}
/** Auditoria devolvida em ordem invertida e sem registrar userId null. */
class ReorderingAudit extends InMemoryEditorialStore {
  override async listAudit() { return (await super.listAudit()).reverse(); }
}
/** Perde appends concorrentes (leitura-modifica-escrita sem atomicidade). */
class LossyAudit extends InMemoryEditorialStore {
  private snapshot: AuditItem[] = [];
  override async appendAudit(a: AuditItem) {
    const base = this.snapshot;
    await new Promise((r) => setTimeout(r, 1));
    this.snapshot = [...base, a];
  }
  override async listAudit() { return this.snapshot; }
}

/** Publicação NÃO atômica: grava a matéria primeiro e só depois o resto (o defeito que o QA 2 apontou). */
class NonAtomicPublication extends InMemoryEditorialStore {
  armed: PublicationCommitStep | null = null;
  override async commitPublication(c: PublicationCommit) {
    await this.putArticle(c.article);
    if (this.armed === 'after_article') { this.armed = null; throw new Error('falha injetada em after_article'); }
    await this.appendAudit(c.audit);
    if (this.armed === 'after_audit') { this.armed = null; throw new Error('falha injetada em after_audit'); }
    return super.commitPublication(c).catch(() => ({ outbox: 'enqueued' as const }));
  }
}
/** Sem idempotência pela chave da outbox: duplica auditoria/outbox a cada chamada. */
class NonIdempotentPublication extends Base {}

const failing = async (factory: StoreFactory): Promise<string[]> => {
  const out: string[] = [];
  for (const c of EDITORIAL_STORE_CONTRACT) {
    try { await c.run(factory); } catch { out.push(c.name); }
  }
  return out;
};

test('suíte de contrato reprova implementação com aliasing', async () => {
  const f = await failing(() => new AliasingStore());
  assert.ok(f.some((n) => n.includes('aliasing na entrada')), f.join(' | '));
  assert.ok(f.some((n) => n.includes('aliasing na saída')), f.join(' | '));
});

test('suíte de contrato reprova upsert que mescla campos antigos', async () => {
  const f = await failing(() => new MergingStore());
  assert.ok(f.some((n) => n.includes('UPSERT')), f.join(' | '));
});

test('suíte de contrato reprova auditoria fora de ordem e appends concorrentes perdidos', async () => {
  const a = await failing(() => new ReorderingAudit());
  assert.ok(a.some((n) => n.startsWith('auditoria')), a.join(' | '));
  const b = await failing(() => new LossyAudit());
  assert.ok(b.some((n) => n.startsWith('concorrência')), b.join(' | '));
});

test('fábrica com teardown é respeitada (um store novo e uma limpeza por teste)', async () => {
  let created = 0; let torn = 0;
  const f: StoreFactory = () => { created++; return { store: new InMemoryEditorialStore(), teardown: async () => { torn++; } }; };
  const failed = await failing(f);
  assert.deepEqual(failed, []);
  assert.equal(created, EDITORIAL_STORE_CONTRACT.length);
  assert.equal(torn, created);
});

test('suíte de contrato reprova publicação NÃO atômica (matéria gravada antes da auditoria/outbox)', async () => {
  const f = await failing(() => { const st = new NonAtomicPublication(); return { store: st, armFault: (step: PublicationCommitStep | null) => { st.armed = step; } }; });
  assert.ok(f.some((n) => n.includes('falha injetada')), f.join(' | '));
});

test('suíte de contrato reprova publicação sem idempotência, sem validação e com concorrência quebrada', async () => {
  const f = await failing(() => new NonIdempotentPublication());
  assert.ok(f.some((n) => n.includes('idempotente pela chave')), f.join(' | '));
  assert.ok(f.some((n) => n.includes('entrada inválida')), f.join(' | '));
  assert.ok(f.some((n) => n.includes('commits idênticos em paralelo')), f.join(' | '));
});
