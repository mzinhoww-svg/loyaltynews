// Exclusão de contato no CRM: a regra da tela exercitada contra a rota real (despachante do comercial, banco PGlite, sessões com
// MFA por papel). Lead fictício (@example.invalid); nada vai a staging ou produção.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLES, can, type Role } from '@ln/auth';
import { schema } from '@ln/db';
import { call, makeApp, type Actor } from '../../app/api/_lib/testkit';
import { dispatchCommercial as d } from '../../app/api/_lib/commercial';
import type { RespostaApi } from './backend';
import { PAPEIS_COMERCIAIS } from './comercial';
import {
  EXCLUIDO, MUDOU, NAO_CONFIRMADA, NAO_ENCONTRADO, SEM_CONFIGURACAO, executarExclusao, interpretarExclusao, type RotasExclusao,
} from './crm-exclusao';
import { findModule } from './modules';

const SALT = 'sal-de-teste-da-tela-32-caracteres';
const SALT_ANTES = process.env.LN_LEAD_AUDIT_SALT;
const P = '/api/commercial/studio/leads';

let app: Awaited<ReturnType<typeof makeApp>>;
const atores = {} as Record<Role, Actor>;

beforeAll(async () => {
  process.env.LN_LEAD_AUDIT_SALT = SALT;
  app = await makeApp();
  for (const papel of ROLES) atores[papel] = await app.actor(papel);
}, 120_000);
afterAll(async () => {
  if (SALT_ANTES === undefined) delete process.env.LN_LEAD_AUDIT_SALT;
  else process.env.LN_LEAD_AUDIT_SALT = SALT_ANTES;
  await app.close();
});

const resposta = (status: number, body: unknown): RespostaApi => ({ status, ok: status < 400, body }) as RespostaApi;

/** As mesmas duas chamadas que a action faz, com a sessão do papel; `apagadas` conta quantas vezes a rota DELETE foi chamada. */
function rotas(papel: Role) {
  const apagadas: string[] = [];
  const r: RotasExclusao = {
    leads: async () => {
      const x = await call(d, 'GET', { path: P, as: atores[papel] });
      return resposta(x.status, x.body);
    },
    excluir: async (id) => {
      apagadas.push(id);
      const x = await call(d, 'DELETE', { path: `${P}/${id}`, params: { leadId: id }, as: atores[papel] });
      return resposta(x.status, x.body);
    },
  };
  return { r, apagadas };
}

let minuto = 0;
async function criar() {
  // cada lead nasce num instante próprio (o relógio do kit é fixo)
  app.clock.now = new Date(Date.UTC(2026, 10, 22, 12, ++minuto));
  const x = await call(d, 'POST', {
    path: P,
    body: { nome: 'Pessoa Fictícia', empresa: 'Empresa Fictícia', email: `tela-${minuto}@example.invalid`, formatosInteresse: [], objetivo: 'awareness', optInNewsletter: false },
    as: atores.comercial,
  });
  expect(x.status).toBe(201);
  const lista = (await call(d, 'GET', { path: P, as: atores.comercial })).body as { id: string; createdAt: string }[];
  const l = lista.find((i) => i.id === (x.body as { id: string }).id)!;
  return { id: l.id, criadoEm: l.createdAt };
}
const existe = async (id: string) => (await app.db.$count(schema.crmLeads, eq(schema.crmLeads.id, id))) === 1;
const trilhas = () => app.db.$count(schema.commercialLeadDeletions);

describe('papel autorizado', () => {
  it('a tela do CRM e a ação aceitam exatamente os papéis que a rota autoriza', () => {
    const daRota = ROLES.filter((p) => can(p, 'campanhas', 'update') && can(p, 'inventario', 'update'));
    expect([...PAPEIS_COMERCIAIS].sort()).toEqual([...daRota].sort());
    expect([...findModule('crm')!.roles].sort()).toEqual([...daRota].sort());
  });

  it.each(['editor_chefe', 'editor', 'revisor', 'leitor'] as const)('%s: não apaga e a rota DELETE nem é chamada', async (papel) => {
    const lead = await criar();
    const { r, apagadas } = rotas(papel);
    const res = await executarExclusao({ ...lead, confirmar: 'sim' }, r);
    expect(res.ok).toBe(false);
    expect(res.mensagem).toMatch(/Nada foi apagado/);
    expect(apagadas).toEqual([]);
    expect(await existe(lead.id)).toBe(true);
    // e a própria rota recusa, se alguém a chamar direto com esse papel
    expect(interpretarExclusao(await r.excluir(lead.id))).toEqual({ ok: false, mensagem: expect.stringMatching(/^O contato NÃO foi excluído: /) });
    expect(await existe(lead.id)).toBe(true);
  });
});

describe('sucesso', () => {
  it.each(['comercial', 'admin'] as const)('%s confirma: o lead sai do banco, a trilha ganha uma linha e a mensagem não leva dado pessoal', async (papel) => {
    const lead = await criar();
    const antes = await trilhas();
    const res = await executarExclusao({ ...lead, confirmar: 'sim' }, rotas(papel).r);
    expect(res).toEqual({ ok: true, mensagem: EXCLUIDO });
    expect(res.mensagem).not.toMatch(/@|Pessoa|Empresa/);
    expect(await existe(lead.id)).toBe(false);
    expect(await trilhas()).toBe(antes + 1);
  });
});

describe('cancelamento e confirmação', () => {
  it.each([
    ['sem confirmar', { confirmar: '' }],
    ['confirmação com outro valor', { confirmar: 'nao' }],
    ['sem a data do registro', { confirmar: 'sim', criadoEm: '' }],
    ['sem id', { confirmar: 'sim', id: '' }],
  ])('%s: nada é lido nem apagado', async (_n, mudanca) => {
    const lead = await criar();
    const chamadas: string[] = [];
    const res = await executarExclusao({ ...lead, ...mudanca } as never, {
      leads: async () => (chamadas.push('GET'), resposta(200, [])),
      excluir: async () => (chamadas.push('DELETE'), resposta(204, null)),
    });
    expect(res).toEqual({ ok: false, mensagem: NAO_CONFIRMADA });
    expect(chamadas).toEqual([]);
    expect(await existe(lead.id)).toBe(true);
  });

  it('confirmação antiga não apaga o contato novo que herdou o mesmo id', async () => {
    const antigo = await criar();
    expect((await executarExclusao({ ...antigo, confirmar: 'sim' }, rotas('comercial').r)).ok).toBe(true);
    const novo = await criar();
    // o domínio reaproveita o maior número depois de uma exclusão (packages/commercial, Crm.load): por isso a conferência existe
    expect(novo.id).toBe(antigo.id);
    const { r, apagadas } = rotas('comercial');
    expect(await executarExclusao({ ...antigo, confirmar: 'sim' }, r)).toEqual({ ok: false, mensagem: MUDOU });
    expect(apagadas).toEqual([]);
    expect(await existe(novo.id)).toBe(true);
  });
});

describe('erro nunca vira sucesso', () => {
  it('500 LEAD_AUDIT_NOT_CONFIGURED: diz que NÃO excluiu; o lead e a trilha ficam como estavam', async () => {
    const lead = await criar();
    const antes = await trilhas();
    delete process.env.LN_LEAD_AUDIT_SALT;
    try {
      const res = await executarExclusao({ ...lead, confirmar: 'sim' }, rotas('comercial').r);
      expect(res).toEqual({ ok: false, mensagem: SEM_CONFIGURACAO });
      expect(res.mensagem).toContain('NÃO foi excluído');
    } finally {
      process.env.LN_LEAD_AUDIT_SALT = SALT;
    }
    expect(await existe(lead.id)).toBe(true);
    expect(await trilhas()).toBe(antes);
  });

  it('leitura recusada antes de excluir: nada é apagado', async () => {
    const lead = await criar();
    const chamadas: string[] = [];
    const res = await executarExclusao({ ...lead, confirmar: 'sim' }, {
      leads: async () => resposta(503, { error: { code: 'SESSION_UNAVAILABLE', message: 'Sessão indisponível.' } }),
      excluir: async () => (chamadas.push('DELETE'), resposta(204, null)),
    });
    expect(res.ok).toBe(false);
    expect(res.mensagem).toBe('Nada foi apagado: não foi possível conferir o contato antes de excluir. Sessão indisponível.');
    expect(chamadas).toEqual([]);
  });

  it('404 diz que já não estava no CRM', async () => {
    expect(interpretarExclusao(await rotas('comercial').r.excluir('lead-999999'))).toEqual({ ok: false, mensagem: NAO_ENCONTRADO });
  });

  it.each([
    ['500 genérico', resposta(500, { error: { code: 'INTERNAL_ERROR', message: 'Erro interno.' } })],
    ['503', resposta(503, { error: { code: 'NOT_CONFIGURED', message: 'Banco não configurado neste ambiente.' } })],
    ['200 inesperado', resposta(200, { ok: true })],
    ['202 inesperado', resposta(202, null)],
  ])('%s: exclusão não confirmada, sem afirmar sucesso nem que nada saiu', (_n, r) => {
    const res = interpretarExclusao(r);
    expect(res.ok).toBe(false);
    expect(res.mensagem).toMatch(/^A exclusão não foi confirmada: .*Confira na lista/);
  });
});
