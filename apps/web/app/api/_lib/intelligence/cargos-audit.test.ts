// O adaptador do Intelligence grava no audit_log por SQL próprio: o motivo livre passa pela mesma barreira de audit() (parecer do QA 6, F2).
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDb } from '@ln/db/testing';
import { schema } from '@ln/db';
import type { Db as IntelDb } from '@ln/intelligence';
import { confirmRoleHandler, discardRoleHandler } from './cargos';

// só a operação de domínio é simulada; o adaptador e o INSERT são os reais, no banco de teste
vi.mock('@ln/intelligence', async (original) => ({
  ...(await original<object>()),
  discardRoleHandler: async () => ({ status: 200, body: {} }),
  confirmRoleHandler: async () => ({ status: 200, body: {} }),
}));

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); }, 120_000);
afterAll(async () => { await t.close(); });
// audit_log é append-only: cada teste usa um ator próprio e lê só as linhas dele
let ator = '';
let n = 0;
beforeEach(() => { ator = `ator-${++n}`; });

const ID = '12345678-1234-4123-8123-123456789abc';
const db = (pessoa = 'Pessoa Sintética') => ({
  query: async (query: string, values?: unknown[]) => {
    if (query.includes('INSERT INTO public.audit_log')) return t.client.query(query, values);
    return { rows: [{ organization_id: 'org-mock', person_name: pessoa, title: 'Cargo Sintético', org_ev_url: 'https://example.invalid', source_url: 'https://example.invalid' }] };
  },
}) as unknown as IntelDb;
const doAtor = async () => (await t.db.select().from(schema.auditLog)).filter((r) => r.actorId === ator);

it('descartar: motivo com e-mail não é gravado em claro; ação, recurso e id continuam na trilha', async () => {
  const email = 'qa6-cargo@example.invalid';
  const r = await discardRoleHandler(db(), ator, { id: ID, motivo: `Correção pedida por ${email}` });
  expect(r.status).toBe(200);
  const rows = await doAtor();
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain(email);
  expect(rows[0]).toMatchObject({ action: 'intelligence.cargo_descartado', resource: 'intelligence', resourceId: ID, actorRole: null, detalhe: { motivo: '[e-mail removido]', cargo: 'Cargo Sintético' } });
});

it('confirmar: texto vindo do banco com e-mail e ator em forma de e-mail também são barrados', async () => {
  ator = 'sem-linha';
  const r = await confirmRoleHandler(db('contato@example.invalid'), 'pessoa@example.invalid', { id: ID, officialUrl: 'https://example.invalid/diretoria' });
  expect(r.status).toBe(200);
  const rows = (await t.db.select().from(schema.auditLog)).filter((x) => x.action === 'intelligence.cargo_confirmado');
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain('@');
  expect(rows[0]!.detalhe).toMatchObject({ fonteOficial: 'example.invalid' });
});
