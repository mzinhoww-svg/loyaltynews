// Exclusão de lead pela rota do Studio (LGPD), ponta a ponta: cria, apaga, some do banco e da caixa,
// e a trilha sobra sem PII. O lead é fictício (@example.invalid); nada vai a staging ou produção.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';
import { leadRefHash } from '@ln/commercial';

// O lead nasce pelo pedido de proposta público, que só existe com a flag portalFormularios ligada (ver leads-flag.test.ts).
// A flag fica explícita aqui, como no arquivo vizinho: o teste não depende do LN_FLAGS_ON/APP_ENV de quem roda a suíte.
vi.mock('../../../lib/portal-formularios', () => ({ formulariosAtivos: () => true }));

const SALT = 'sal-de-teste-da-rota-32-caracteres';
const SALT_ANTES = process.env.LN_LEAD_AUDIT_SALT;

let app: Awaited<ReturnType<typeof makeApp>>;
let comercial: Awaited<ReturnType<typeof app.actor>>;
let admin: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;

const P = (p: string) => `/api/commercial${p}`;
const leadBody = (email: string) => ({
  nome: 'Pessoa Fictícia', empresa: 'Empresa Fictícia', email, formatosInteresse: ['banners--banner-topo'],
  objetivo: 'awareness', optInNewsletter: false,
});

beforeAll(async () => {
  process.env.LN_LEAD_AUDIT_SALT = SALT;
  app = await makeApp();
  comercial = await app.actor('comercial');
  admin = await app.actor('admin');
  editor = await app.actor('editor');
}, 120_000);
afterAll(async () => {
  if (SALT_ANTES === undefined) delete process.env.LN_LEAD_AUDIT_SALT; else process.env.LN_LEAD_AUDIT_SALT = SALT_ANTES;
  await app.close();
});

// Cada criação sai de um IP próprio: com TRUSTED_PROXY_HOPS no ambiente o limite por IP do formulário público entra em jogo,
// e um IP fixo somaria as tentativas de todos os casos. Assim nenhum caso depende de quantos leads os anteriores criaram.
let ipSeq = 0;
const criar = async (email = `lgpd-${Math.random().toString(36).slice(2)}@example.invalid`) => {
  ipSeq += 1;
  const r = await call(d, 'POST', { path: P('/leads'), body: leadBody(email), ip: `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}` });
  expect(r.status).toBe(201);
  return r.body.id as string;
};
const naCaixa = async () => ((await call(d, 'GET', { path: P('/studio/leads'), as: comercial })).body as Array<{ id: string }>).map((l) => l.id);

describe('DELETE /api/commercial/studio/leads/:id', () => {
  it('sem sessão 401; editor (sem canManageCommercial) 403 e o lead continua', async () => {
    const id = await criar();
    expect((await call(d, 'DELETE', { path: P(`/studio/leads/${id}`), params: { leadId: id } })).status).toBe(401);
    expect((await call(d, 'DELETE', { path: P(`/studio/leads/${id}`), params: { leadId: id }, as: editor })).status).toBe(403);
    expect(await app.db.$count(schema.crmLeads, eq(schema.crmLeads.id, id))).toBe(1);
    expect((await call(d, 'DELETE', { path: P('/studio/leads'), params: { leadId: id }, as: comercial })).status).toBe(405);
  });

  it('sem o sal do servidor a rota recusa (500) e não apaga: trilha sem sal não é segura', async () => {
    const id = await criar();
    const antes = process.env.LN_LEAD_AUDIT_SALT;
    delete process.env.LN_LEAD_AUDIT_SALT;
    try {
      const r = await call(d, 'DELETE', { path: P(`/studio/leads/${id}`), params: { leadId: id }, as: comercial });
      expect(r.status).toBe(500);
      expect(r.body.error.code).toBe('LEAD_AUDIT_NOT_CONFIGURED');
    } finally {
      process.env.LN_LEAD_AUDIT_SALT = antes;
    }
    expect(await app.db.$count(schema.crmLeads, eq(schema.crmLeads.id, id))).toBe(1);
    expect(await app.db.$count(schema.commercialLeadDeletions)).toBe(0);
  });

  it('comercial apaga: 204, some do banco e da caixa do Studio, e a trilha grava só o hash', async () => {
    const id = await criar('apagar@example.invalid');
    expect(await naCaixa()).toContain(id);
    const r = await call(d, 'DELETE', { path: P(`/studio/leads/${id}`), params: { leadId: id }, as: comercial });
    expect(r.status).toBe(204);
    expect(r.body).toBeNull();
    expect(await app.db.$count(schema.crmLeads, eq(schema.crmLeads.id, id))).toBe(0);
    expect(await naCaixa()).not.toContain(id);
    const [row] = await app.db.select().from(schema.commercialLeadDeletions);
    expect(row).toMatchObject({ leadRefHash: leadRefHash(id, SALT), actorRole: 'comercial', origin: 'studio' });
    expect(JSON.stringify(row)).not.toContain(id);
    expect(JSON.stringify(row)).not.toContain('apagar@example.invalid');
    expect(JSON.stringify(row)).not.toContain('Pessoa Fictícia');
    // repetir: 404 e nenhuma trilha nova
    expect((await call(d, 'DELETE', { path: P(`/studio/leads/${id}`), params: { leadId: id }, as: comercial })).status).toBe(404);
    expect(await app.db.$count(schema.commercialLeadDeletions)).toBe(1);
  });

  it('admin também apaga (204)', async () => {
    const id = await criar();
    expect((await call(d, 'DELETE', { path: P(`/studio/leads/${id}`), params: { leadId: id }, as: admin })).status).toBe(204);
    expect(await app.db.$count(schema.crmLeads, eq(schema.crmLeads.id, id))).toBe(0);
  });

  it('lead convertido: apaga a pessoa e mantém a conta e a oportunidade (sem o vínculo)', async () => {
    const id = await criar();
    const conv = await call(d, 'POST', { path: P('/studio/leads/convert'), body: { leadId: id }, as: comercial });
    expect(conv.status).toBe(201);
    const oppId = conv.body.opportunity.id as string;
    const accId = conv.body.account.id as string;
    expect((await call(d, 'DELETE', { path: P(`/studio/leads/${id}`), params: { leadId: id }, as: comercial })).status).toBe(204);
    expect(await app.db.$count(schema.crmLeads, eq(schema.crmLeads.id, id))).toBe(0);
    const [opp] = await app.db.select().from(schema.crmOpportunities).where(eq(schema.crmOpportunities.id, oppId));
    expect(opp).toBeTruthy();
    expect(opp?.leadId).toBeNull();
    expect(await app.db.$count(schema.crmAccounts, eq(schema.crmAccounts.id, accId))).toBe(1);
  });
});
