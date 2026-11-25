// Fila `entidades` de ponta a ponta: enfileira no outbox, o reconciliador vira job, o handler grava no Intelligence
// na MESMA transação do effect_ledger. O efeito é observado no banco (evidência e organização), não só "não deu erro".
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import { createHandlers, ingestPublishedArticle } from './handlers';
import { enqueueOutbox, PgEffectStore, PgOutboxStore } from './pg-stores';
import { processJob, reconcileOutbox, type QueueSink } from './reconciler';
import type { JobPayload, QueueName } from './queues';

const SITE = 'https://loyaltynews.invalid';
const H = createHandlers({ APP_URL: SITE });
const FRASE = 'Ana Exemplo foi nomeada diretora de Marketing da Empresa Alfa Exemplo. A companhia cresceu.';

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  await db.insert(schema.editorias).values({ slug: 'fidelidade', nome: 'Fidelidade' });
});
afterAll(async () => {
  await t.close();
});

type Query = { query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> };
const raw = (sql: string) => (t.client as unknown as Query).query(sql);
const count = async (tabela: string) => Number((await raw(`SELECT count(*)::text c FROM intelligence.${tabela}`)).rows[0]!.c);

async function artigo(id: string, over: Partial<{ status: 'publicado' | 'corrigido' | 'rascunho'; classe: string; corpo: string; slug: string }> = {}) {
  await db.insert(schema.articles).values({
    id, slug: over.slug ?? id, titulo: `Título ${id}`, resumo: 'Resumo da matéria de teste.',
    editoria: 'fidelidade', status: over.status ?? 'publicado', corpo: over.corpo ?? FRASE,
    classeDeDado: over.classe ?? 'public', publicadoEm: new Date('2026-11-20T12:00:00Z'),
  });
}

async function jobDaFila(id: string, chave: string): Promise<{ payload: JobPayload; outboxId: string }> {
  await enqueueOutbox(db, { queue: 'entidades', refId: id, idempotencyKey: chave });
  const [row] = await db.select().from(schema.outbox).where(eq(schema.outbox.idempotencyKey, chave));
  return { payload: { refId: id, idempotencyKey: row!.id }, outboxId: row!.id };
}

class Sink implements QueueSink {
  jobs: Array<{ queue: QueueName; payload: JobPayload }> = [];
  async add(queue: QueueName, _jobId: string, payload: JobPayload) { this.jobs.push({ queue, payload }); }
}

describe('fila entidades: publicação -> Intelligence', () => {
  it('enfileira, reconcilia e o handler grava organização e evidência; repetir não duplica', async () => {
    await artigo('art-pub');
    const { payload } = await jobDaFila('art-pub', 'article.published:art-pub:abc');

    // o caminho real do outbox: reconciliador pega a linha e coloca o job na fila (aqui, sink em memória)
    const sink = new Sink();
    expect(await reconcileOutbox(new PgOutboxStore(db), sink, { now: new Date('2026-11-20T12:10:00Z') })).toMatchObject({ enqueued: 1, failed: 0 });
    expect(sink.jobs[0]!.queue).toBe('entidades');

    const effects = new PgEffectStore(db);
    expect(await processJob(effects, 'entidades', sink.jobs[0]!.payload, H.entidades!)).toBe('executed');
    expect(await count('evidence')).toBe(1);
    expect(await count('organization')).toBe(1);
    expect(await count('person')).toBe(0);
    expect(await count('role_assignment')).toBe(0);
    expect(await count('move')).toBe(0);
    const ev = await raw('SELECT source_url, content_hash FROM intelligence.evidence');
    expect(ev.rows[0]!.source_url).toBe(`${SITE}/noticia/art-pub`);
    expect(String(ev.rows[0]!.content_hash)).toMatch(/^[0-9a-f]{64}$/);

    // reenvio do MESMO job (Redis perdeu e reentregou): ledger impede o segundo efeito
    expect(await processJob(effects, 'entidades', payload, H.entidades!)).toBe('duplicate');
    expect(await count('evidence')).toBe(1);
    expect(await count('organization')).toBe(1);
  });

  it('correção publicada reingere com hash novo: nova evidência, mesma organização', async () => {
    await artigo('art-corr', { status: 'corrigido', corpo: `${FRASE} Bruno Exemplar assume como presidente da Empresa Beta Exemplo.` });
    const { payload } = await jobDaFila('art-corr', 'article.corrected:art-corr:def');
    expect(await processJob(new PgEffectStore(db), 'entidades', payload, H.entidades!)).toBe('executed');
    expect(await count('evidence')).toBe(2);
    expect(await count('organization')).toBe(2);
  });

  it('rascunho e conteúdo não público não geram efeito (o job conclui sem inventar dado)', async () => {
    await artigo('art-draft', { status: 'rascunho' });
    await artigo('art-restrito', { classe: 'personal' });
    expect(await processJob(new PgEffectStore(db), 'entidades', (await jobDaFila('art-draft', 'draft-1')).payload, H.entidades!)).toBe('executed');
    expect(await processJob(new PgEffectStore(db), 'entidades', (await jobDaFila('art-restrito', 'restrito-1')).payload, H.entidades!)).toBe('executed');
    expect(await count('evidence')).toBe(2); // não mudou
  });

  it('matéria inexistente falha e desfaz o ledger (o job fica pendente, não "done" em silêncio)', async () => {
    const { payload, outboxId } = await jobDaFila('nao-existe', 'missing-1');
    await expect(processJob(new PgEffectStore(db), 'entidades', payload, H.entidades!)).rejects.toThrow(/não encontrada/);
    const [depois] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, outboxId));
    expect(depois?.status).not.toBe('done');
  });

  it('sem URL pública não inventa fonte: falha fechada', async () => {
    await artigo('art-sem-url');
    await expect(db.transaction(async (tx) => ingestPublishedArticle(tx as unknown as Db, 'art-sem-url', ''))).rejects.toThrow(/APP_URL/);
  });
});
