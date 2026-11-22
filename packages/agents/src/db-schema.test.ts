import { PGlite } from '@electric-sql/pglite';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { describe, expect, it } from 'vitest';
import { createBrCalendar } from './calendar';
import { loadRegistries } from './config';
import * as dbSchema from './db-schema';
import { buildOrganization } from './organization';
import { SectorMemoryService } from './memory';
import { pgDbFromPGlite } from './pg-adapter';
import { PgStore } from './pg-store';
import { RitualScheduler, StoreInputCollector } from './scheduler';

describe('db-schema.ts (Drizzle) gera DDL válido e funciona com o PgStore', () => {
  it('DDL gerado pelo drizzle-kit aplica no PGlite e o fluxo ritual+memória roda sobre ele', async () => {
    const empty = generateDrizzleJson({});
    const cur = generateDrizzleJson(dbSchema as unknown as Record<string, unknown>, empty.id);
    const statements = await generateMigration(empty, cur);
    expect(statements.join('\n')).toMatch(/CREATE TABLE "meeting_runs"/);

    const client = new PGlite();
    for (const st of statements) await client.exec(st);
    const store = new PgStore(pgDbFromPGlite(client as never));

    // memória setorial
    const reg = loadRegistries();
    const mem = new SectorMemoryService(store, buildOrganization(reg));
    await mem.write({ editoria: 'tech', kind: 'sources', key: 'ri', content: ['a'], author_agent_id: 'writer_tech' });
    expect((await mem.read('tech', 'ri'))!.version).toBe(1);

    // ritual completo
    const date = '2026-11-19';
    await store.putInput('D-tech', date, { agent_id: 'editor_tech', summary: 's', blockers: [], evidence_refs: ['e'], decisions: [{ text: 'd', proposed_by: 'editor_tech', needs_human_approval: false, evidence_refs: [], actions: [{ title: 't', owner: 'writer_tech', due_in_business_days: 1 }] }] });
    await store.putInput('D-tech', date, { agent_id: 'writer_tech', summary: 's', blockers: [], evidence_refs: [], decisions: [] });
    const s = new RitualScheduler({ registries: reg, calendar: createBrCalendar(), store, collector: new StoreInputCollector(store), flags: { rituais: true }, lookbackDays: 0 });
    await s.tick(new Date('2026-11-19T06:00:00-03:00'));
    const run = (await store.getRun('D-tech', date))!;
    expect(run.status).toBe('completed');
    expect(await store.listActions({ runId: run.id })).toHaveLength(1);

    // restrições do Drizzle também valem: tarefa concluída sem evidência é recusada
    const [a] = await store.listActions({ runId: run.id });
    await expect(store.updateAction(a!.id, { status: 'done' })).rejects.toThrow();
    await client.close();
  });
});
