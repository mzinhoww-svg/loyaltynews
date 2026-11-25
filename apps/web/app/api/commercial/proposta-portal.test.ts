import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';
import { corpoDaProposta, OBJETIVOS, ROTA_PROPOSTA, type PropostaValores } from '../../(portal)/_proposta/proposta';

// O corpo que o formulário do mídia kit envia, passando pela rota pública REAL (contrato estrito, banco e consentimento).
let app: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => { app = await makeApp(); }, 120_000);
afterAll(async () => { await app.close(); });

const v = (over: Partial<PropostaValores> = {}): PropostaValores => ({
  nome: 'Ana Souza', empresa: 'Programa Alfa', email: 'Ana@Alfa.example', whatsapp: '', objetivo: OBJETIVOS[1], mensagem: '', optInNewsletter: false, ...over,
});

describe('pedido de proposta do portal → POST /api/commercial/leads', () => {
  it('só o mínimo: 201, resposta sem dado pessoal, linha gravada como dado pessoal, WhatsApp e mensagem nulos, opt-in desmarcado', async () => {
    const r = await call(d, 'POST', { path: ROTA_PROPOSTA, body: corpoDaProposta(v()) });
    expect(r.status).toBe(201);
    expect(Object.keys(r.body).sort()).toEqual(['consentimentoEm', 'id', 'status']);
    const [row] = await app.db.select().from(schema.crmLeads).where(eq(schema.crmLeads.id, r.body.id));
    expect(row).toMatchObject({
      nome: 'Ana Souza', empresa: 'Programa Alfa', email: 'ana@alfa.example', whatsapp: null, objetivo: OBJETIVOS[1], optInNewsletter: false, classeDeDado: 'personal', status: 'novo',
    });
    expect(row!.mensagem ?? null).toBeNull();
    expect(row!.consentimentoEm).toBeInstanceOf(Date); // horário do servidor: registro do pedido
  });
  it('com os opcionais e o opt-in marcado pela pessoa', async () => {
    const r = await call(d, 'POST', { path: ROTA_PROPOSTA, body: corpoDaProposta(v({ email: 'bia@beta.example', whatsapp: '(11) 91234-5678', mensagem: 'Banner topo em janeiro', optInNewsletter: true })) });
    expect(r.status).toBe(201);
    const [row] = await app.db.select().from(schema.crmLeads).where(eq(schema.crmLeads.id, r.body.id));
    expect(row).toMatchObject({ whatsapp: '(11) 91234-5678', mensagem: 'Banner topo em janeiro', optInNewsletter: true });
  });
  it('a linha do lead não guarda IP, navegador nem origem: só o que a pessoa digitou e o registro do pedido', async () => {
    const colunas = Object.keys((await app.db.select().from(schema.crmLeads).limit(1))[0]!).sort();
    expect(colunas).toEqual(['classeDeDado', 'consentimentoEm', 'contaId', 'criadoEm', 'email', 'empresa', 'formatoIds', 'id', 'mensagem', 'nome', 'objetivo', 'optInNewsletter', 'status', 'whatsapp']);
  });
  it('campo a mais (como o honeypot) é recusado pelo contrato estrito: o portal nunca o envia', async () => {
    expect((await call(d, 'POST', { path: ROTA_PROPOSTA, body: { ...corpoDaProposta(v()), site: 'x' } })).status).toBe(400);
  });
});
