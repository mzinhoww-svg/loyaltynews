/* eslint-disable @typescript-eslint/no-explicit-any -- registro mínimo de matéria para o teste */
// F (aprovado 26/11): reprocessar UMA matéria e UMA etapa por operador; recusa falha editorial real e não duplica.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '@ln/db/testing';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import type { ModelGateway } from '@ln/editorial';
import { PgEditorialStore } from './editorial-store';
import { ReprocessRefused, reprocessRefusal, runEditorialReprocess } from './editorial-factory';

let template: Blob | File | undefined;
async function freshDb(): Promise<{ db: Db; client: PGlite }> {
  if (!template) {
    const base = await createTestDb();
    template = await base.client.dumpDataDir('none');
    await base.close();
  }
  const client = new PGlite({ loadDataDir: template });
  await client.waitReady;
  return { db: drizzle(client, { schema }) as unknown as Db, client };
}

const NOW = new Date('2026-11-26T12:00:00-03:00');
const ev = (id: string) => ({ id, url: `https://fonte.example/${id}`, canonicalUrl: `https://fonte.example/${id}`, title: 't', text: 'x', sourceId: 's1', tier: 'primary', capturedAt: NOW.toISOString() }) as any;
const article = (over: Record<string, unknown> = {}): any => ({
  articleId: 'art-rp', editoria: 'mercado', status: 'bloqueado', evidences: [ev('e1')], blockers: [], findings: [], reviews: [], recheckCount: 0, updatedAt: NOW.toISOString(), ...over,
});

describe('reprocessar por articleId + etapa', () => {
  it('recusa falha editorial real (por finding, incluindo duplicate/unanchored) e status publicado/aprovado', () => {
    expect(reprocessRefusal({ status: 'bloqueado', findings: [{ code: 'unsupported_claim' }] }).join(' ')).toMatch(/falha editorial real/);
    expect(reprocessRefusal({ status: 'bloqueado', findings: [{ code: 'duplicate' }] }).join(' ')).toMatch(/falha editorial real/);
    expect(reprocessRefusal({ status: 'bloqueado', findings: [{ code: 'unanchored' }] }).join(' ')).toMatch(/falha editorial real/);
    expect(reprocessRefusal({ status: 'publicado', findings: [] }).join(' ')).toMatch(/publicado/);
    expect(reprocessRefusal({ status: 'bloqueado', findings: [{ code: 'invalid_model_output' }] })).toEqual([]);
  });

  it('--operator é obrigatório: sem operador identificado a chamada é recusada antes de qualquer efeito', async () => {
    const calls: number[] = [];
    const gateway: ModelGateway = { invoke: async () => { calls.push(1); return { ok: false, refusal: 'model_disabled', detail: 'x' } as any; } };
    await expect(runEditorialReprocess({ db: {} as never, articleId: 'art-rp', stage: 'triage', motivo: 'motivo suficientemente longo', operatorId: '   ', modelGateway: gateway, now: () => NOW }))
      .rejects.toMatchObject({ code: 'NO_OPERATOR' });
    expect(calls).toHaveLength(0);
  });

  it('gateway não roda quando a matéria tem bloqueio editorial', async () => {
    const { db, client } = await freshDb();
    try {
      let calls = 0;
      const gateway: ModelGateway = { invoke: async () => { calls += 1; return { ok: false, refusal: 'model_disabled', detail: 'x' } as any; } };
      await new PgEditorialStore(db).putArticle(article({ findings: [{ code: 'unsupported_claim', message: 'c5 falhou', stage: 'factcheck' }] }));
      await expect(runEditorialReprocess({ db, articleId: 'art-rp', stage: 'factcheck', motivo: 'falso positivo de infra', operatorId: 'op-1', modelGateway: gateway, now: () => NOW }))
        .rejects.toBeInstanceOf(ReprocessRefused);
      expect(calls).toBe(0);
    } finally { await client.close(); }
  });

  it('roda a etapa uma vez, grava operador e motivo, e a segunda chamada é recusada (sem duplicar)', async () => {
    const { db, client } = await freshDb();
    try {
      let calls = 0;
      const gateway: ModelGateway = { invoke: async () => { calls += 1; return { ok: true, provider: 'claude', model: 'claude-haiku-5-5', text: 'nao e json', usage: { inputTokens: 1, outputTokens: 1, costMicrosUsd: 0 } } as any; } };
      const store = new PgEditorialStore(db);
      await store.putArticle(article());
      const out = await runEditorialReprocess({ db, articleId: 'art-rp', stage: 'triage', flags: { editorialCollector: true, editorialPipeline: true } as never, motivo: 'bloqueio de infraestrutura (5xx no despacho)', operatorId: 'op-1', modelGateway: gateway, now: () => NOW });
      expect(calls).toBeLessThanOrEqual(1);
      expect(out.status).toBe('bloqueado');
      const trilha = (await store.listAudit()).filter((a) => a.action === 'editorial.reprocess');
      expect(trilha).toHaveLength(1);
      expect(trilha[0]).toMatchObject({ target: 'art-rp:triage', userId: 'op-1' });
      await expect(runEditorialReprocess({ db, articleId: 'art-rp', stage: 'triage', motivo: 'repetindo o mesmo pedido', operatorId: 'op-1', modelGateway: gateway, now: () => NOW }))
        .rejects.toMatchObject({ code: 'ALREADY_REQUESTED' });
      expect(calls).toBeLessThanOrEqual(1);
    } finally { await client.close(); }
  });
});


