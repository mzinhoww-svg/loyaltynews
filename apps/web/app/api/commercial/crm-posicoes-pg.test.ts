import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import { call, makeApp } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';

// Persistência no PostgreSQL do CRM direto (contas e contatos) e das campanhas com várias posições (ft/commercial 4ea7404 + migração crm_contatos_posicoes).
let app: Awaited<ReturnType<typeof makeApp>>;
let comercial: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
const P = (p: string) => `/api/commercial${p}`;
const post = (path: string, body: unknown, as = comercial) => call(d, 'POST', { path: P(path), body, as });

beforeAll(async () => {
  app = await makeApp();
  comercial = await app.actor('comercial');
  editor = await app.actor('editor');
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('CRM direto no banco', () => {
  let accountId = '';
  it('conta: 201 grava em crm_accounts; nome repetido (caixa/espaços) 409 DUPLICATE_ACCOUNT, também depois de reidratar', async () => {
    const r = await post('/studio/accounts', { name: '  Banco   Ômega ' });
    expect(r.status).toBe(201);
    accountId = r.body.id;
    const [row] = await app.db.select().from(schema.crmAccounts).where(eq(schema.crmAccounts.id, accountId));
    expect(row!.nome).toBe('Banco Ômega');
    const dup = await post('/studio/accounts', { name: 'banco ômega' });
    expect([dup.status, dup.body.error.code]).toEqual([409, 'DUPLICATE_ACCOUNT']);
    expect((await post('/studio/accounts', { name: 'X' }, editor)).status).toBe(403);
  });

  it('contato: grava com base legal, data do servidor, autor e classe personal; lista lê do banco; e-mail repetido na conta 409; em outra conta pode', async () => {
    const r = await post('/studio/accounts/contacts', { accountId, name: 'Carla Dias', email: 'Carla@Omega.example', whatsapp: '+5511999990000', role: 'Diretora de marketing', basis: 'legitimo_interesse' });
    expect(r.status).toBe(201);
    const [row] = await app.db.select().from(schema.crmContacts).where(eq(schema.crmContacts.contaId, accountId));
    expect(row).toMatchObject({ nome: 'Carla Dias', baseLegal: 'legitimo_interesse', registradoPor: comercial.id, classeDeDado: 'personal', cargo: 'Diretora de marketing' });
    expect(row!.consentimentoEm.toISOString()).toBe('2026-11-22T12:00:00.000Z'); // relógio do servidor, não do cliente
    const list = await call(d, 'GET', { path: P('/studio/accounts/contacts'), query: { accountId }, as: comercial });
    expect([list.status, list.body.total, list.body.data[0].email.toLowerCase()]).toEqual([200, 1, 'carla@omega.example']);
    const dup = await post('/studio/accounts/contacts', { accountId, name: 'Outra', email: 'carla@OMEGA.example', basis: 'consentimento' });
    expect([dup.status, dup.body.error.code]).toEqual([409, 'DUPLICATE_CONTACT']);
    const outra = await post('/studio/accounts', { name: 'Cia Sigma' });
    expect((await post('/studio/accounts/contacts', { accountId: outra.body.id, name: 'Carla Dias', email: 'carla@omega.example', basis: 'consentimento' })).status).toBe(201);
    expect(await app.db.$count(schema.crmContacts)).toBe(2);
    expect((await post('/studio/accounts/contacts', { accountId, name: 'X', email: 'x@y.example', basis: 'consentimento', consentAt: '2020-01-01T00:00:00Z' })).status).toBe(400);
  });

  it('o índice único do banco é a segunda barreira: e-mail repetido (mesma conta, outra caixa) é recusado mesmo gravado por fora do domínio', async () => {
    const [orig] = await app.db.select().from(schema.crmContacts).where(eq(schema.crmContacts.contaId, accountId));
    await expect(app.db.insert(schema.crmContacts).values({ ...orig!, id: 'ctt-fora', email: orig!.email.toUpperCase() })).rejects.toThrow();
  });

  it('contato não aparece em rota pública (mídia kit)', async () => {
    const mk = await call(d, 'GET', { path: P('/mediakit') });
    expect(JSON.stringify(mk.body)).not.toMatch(/omega\.example|Carla/i);
  });
});

describe('campanha com várias posições no banco', () => {
  it('grava todas as posições em ordem (slot_id = a primeira), relê igual depois de reidratar, e muda só quando a lista muda', async () => {
    const acc = await post('/studio/accounts', { name: 'Anunciante Posições' });
    const mk = await post('/studio/campaigns', { name: 'Multi', accountId: acc.body.id, formatId: 'banners--banner-rodape', positionIds: ['FOOTER', 'SIDEBAR_1'], startDate: '2026-12-01', endDate: '2027-01-31' });
    expect(mk.status).toBe(201);
    const cid = mk.body.id as string;
    const pos = async () => (await app.db.select().from(schema.campaignPositions).where(eq(schema.campaignPositions.campanhaId, cid)).orderBy(asc(schema.campaignPositions.ordem))).map((p) => p.slotId);
    expect(await pos()).toEqual(['FOOTER', 'SIDEBAR_1']);
    const [row] = await app.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, cid));
    expect(row!.slotId).toBe('FOOTER');
    const det = await call(d, 'GET', { path: P('/studio/campaigns/detail'), query: { campaignId: cid }, as: comercial });
    expect(JSON.stringify(det.body)).toMatch(/"positionIds":\["FOOTER","SIDEBAR_1"\]/);
    // outra escrita qualquer (sem mexer na campanha) não regrava as posições
    await post('/studio/accounts', { name: 'Só para escrever' });
    expect(await pos()).toEqual(['FOOTER', 'SIDEBAR_1']);
  });

  it('campanha legada (só slot_id, sem linhas em campaign_positions) é lida com a posição de slot_id', async () => {
    const acc = await post('/studio/accounts', { name: 'Legado' });
    const mk = await post('/studio/campaigns', { name: 'Uma', accountId: acc.body.id, formatId: 'banners--banner-topo', positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-03-01' });
    await app.db.delete(schema.campaignPositions).where(eq(schema.campaignPositions.campanhaId, mk.body.id)); // simula linha anterior à migração
    const det = await call(d, 'GET', { path: P('/studio/campaigns/detail'), query: { campaignId: mk.body.id }, as: comercial });
    expect(JSON.stringify(det.body)).toMatch(/"positionIds":\["TOP"\]/);
  });
});

describe('migração crm_contatos_posicoes', () => {
  const DIR = fileURLToPath(new URL('../../../../../packages/db/drizzle/', import.meta.url));
  const TAG = readdirSync(DIR).find((f) => /^\d{4}_crm_contatos_posicoes\.sql$/.test(f))!.replace(/\.sql$/, '');
  const UP = readFileSync(`${DIR}${TAG}.sql`, 'utf8');
  const DOWN = readFileSync(`${DIR}down/${TAG}.down.sql`, 'utf8');
  const JOURNAL = JSON.parse(readFileSync(`${DIR}meta/_journal.json`, 'utf8')) as { entries: { tag: string; when: number }[] };

  it('desce e sobe de novo; ao subir, campanha existente ganha a posição de slot_id como ordem 0', async () => {
    const t = await createTestDb();
    try {
      const existe = async (n: string) => (await t.client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = '${n}'`)).rows.length === 1;
      const reg = async () => Number((await t.client.query<{ n: string }>(`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`)).rows[0]!.n);
      const antes = await reg();
      await t.client.exec(DOWN);
      expect([await existe('crm_contacts'), await existe('campaign_positions'), await reg()]).toEqual([false, false, antes - 1]);
      await t.client.exec(`INSERT INTO ad_formats (id) SELECT 'f' WHERE false`).catch(() => undefined);
      const fmt = (await t.client.query<{ id: string }>(`SELECT id FROM ad_formats LIMIT 1`)).rows[0]?.id;
      const slot = (await t.client.query<{ id: string }>(`SELECT id FROM ad_slots LIMIT 1`)).rows[0]?.id;
      if (fmt && slot) {
        await t.client.exec(`INSERT INTO crm_accounts (id, nome) VALUES ('acc-m', 'M'); INSERT INTO campaigns (id, nome, conta_id, formato_id, slot_id, inicio, fim) VALUES ('cmp-m', 'M', 'acc-m', '${fmt}', '${slot}', '2026-12-01', '2026-12-31')`);
      }
      for (const s of UP.split('--> statement-breakpoint')) if (s.trim()) await t.client.exec(s);
      expect([await existe('crm_contacts'), await existe('campaign_positions')]).toEqual([true, true]);
      if (fmt && slot) {
        const r = await t.client.query<{ slot_id: string; ordem: number }>(`SELECT slot_id, ordem FROM campaign_positions WHERE campanha_id = 'cmp-m'`);
        expect(r.rows).toEqual([{ slot_id: slot, ordem: 0 }]);
      }
    } finally {
      await t.close();
    }
  }, 120_000);

  it('o down só toca nas duas tabelas e no registro desta migração', () => {
    expect([...DOWN.matchAll(/DROP TABLE IF EXISTS (\w+);/g)].map((m) => m[1]).sort()).toEqual(['campaign_positions', 'crm_contacts']);
    expect(DOWN).toContain(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${JOURNAL.entries.find((e) => e.tag === TAG)!.when};`);
    expect(DOWN.replace(/--.*$/gm, '')).not.toMatch(/\bDROP (SCHEMA|DATABASE)\b|TRUNCATE|\bDELETE FROM (?!drizzle\.__drizzle_migrations)/i);
  });
});
