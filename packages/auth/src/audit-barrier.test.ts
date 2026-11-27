// Barreira de privacidade do audit_log (parecer do QA 6 sobre 8dcce37d, F1): regras de estrutura, para QUALQUER chamador.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import { CONTATO_REMOVIDO, EMAIL_REMOVIDO, VALOR_INVALIDO, audit, sanitizeAuditRow, type AuditEntry } from './audit';
import type { Db } from './types';

let t: Awaited<ReturnType<typeof createTestDb>>;
let seq = 0;
beforeAll(async () => { t = await createTestDb(); }, 120_000);
afterAll(async () => { await t.close(); });

/** Grava por audit() e devolve a linha do banco. */
async function gravar(e: Partial<AuditEntry>) {
  const resourceId = e.resourceId ?? `linha-${++seq}`;
  const antes = new Set((await t.db.select({ id: schema.auditLog.id }).from(schema.auditLog)).map((r) => r.id));
  await audit(t.db as unknown as Db, { action: 'teste.barreira', resource: 'teste', ...e, resourceId });
  return (await t.db.select().from(schema.auditLog)).find((r) => !antes.has(r.id))!;
}
/** Todos os textos (chaves e valores) de um objeto, decodificados: comparar com o JSON escapado deixa passar aspas. */
const textos = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' && !(v instanceof Date) ? Object.entries(v).flatMap(([k, x]) => [k, ...textos(x)]) : [];

const INCOMUNS = [
  'sintetico@intranet', 'sintetico@[192.0.2.1]', '"sintetico"@example.invalid', '"nome com espaco"@example.invalid', 'sintetico @example.invalid',
  'sintetico@ example.invalid', 'sintetico＠example.invalid', 'sintetico﹫example.invalid', 'sintetico%40example.invalid', 'sintetico%2540example.invalid',
  'josé@domínio.com.br', 'пример@почта.рф', 'a@b', 'x@', '@perfil', 'mailto:sintetico@example.invalid', 'Fulana <fulana@example.invalid>',
];

describe('regra 1: texto com arroba sai inteiro, em qualquer coluna, chave ou profundidade', () => {
  it.each(INCOMUNS)('não persiste %s', async (endereco) => {
    const row = await gravar({
      actorId: endereco, resourceId: `contato:${endereco}`,
      detalhe: { texto: `antes ${endereco} depois`, lista: [endereco, { [endereco]: endereco }], filtros: { actorId: endereco } },
    });
    const gravado = textos(row);
    for (const s of gravado) { expect(s.normalize('NFKC')).not.toContain('@'); expect(s).not.toContain(endereco); expect(s).not.toMatch(/%(25)*40/); }
    expect(row).toMatchObject({ actorId: EMAIL_REMOVIDO, resourceId: EMAIL_REMOVIDO, detalhe: { texto: EMAIL_REMOVIDO } });
  });

  it('vale para o que o JSON gravaria (toJSON) e duas chaves removidas não se apagam', async () => {
    const row = await gravar({ detalhe: { obj: { toJSON: () => ({ nota: 'oculto@example.invalid' }) }, mapa: { 'a@x': 1, 'b@x': 2 } } });
    expect(row.detalhe).toEqual({ obj: { nota: EMAIL_REMOVIDO }, mapa: { [EMAIL_REMOVIDO]: 1, [`${EMAIL_REMOVIDO} 1`]: 2 } });
  });

  it('combinações geradas: nenhuma arroba sobrevive', () => {
    const pedacos = ['a', 'ç', ' ', '"', '[', ']', '.', '\\', '<', ':', '/', '\n', '​', '-'];
    for (let i = 0; i < 2_000; i++) {
      const p = (k: number) => Array.from({ length: (i * k) % 5 }, (_, j) => pedacos[(i * 7 + j * k) % pedacos.length]).join('');
      const v = `${p(3)}@${p(11)}`;
      const r = sanitizeAuditRow({ actorId: v, actorRole: v, action: v, resource: v, resourceId: v, detalhe: { [v]: [v, { n: v }] } });
      for (const s of textos(r)) expect(s, JSON.stringify(v)).not.toContain('@');
    }
  });
});

describe('regra 2: campo de contato sai pelo nome, com ou sem arroba', () => {
  it('não persiste texto cru marcado como e-mail ou contato, em qualquer grafia da chave, tipo ou profundidade', async () => {
    const cru = 'Texto-Sintetico-Sem-Arroba!';
    const row = await gravar({
      detalhe: {
        email: cru, Email: cru, 'e-mail': cru, e_mail: cru, userEmail: cru, MAIL: { x: cru }, contato: cru, contact: [cru], telefone: 11999990000, phone: cru, celular: cru, WhatsApp: cru,
        fundo: { a: [{ requesterEmail: cru }] }, emailRef: cru, emailDominio: `x ${cru}`,
      },
    });
    expect(textos(row.detalhe)).not.toContain(cru);
    expect(JSON.stringify(row)).not.toContain(cru);
    expect(JSON.stringify(row)).not.toContain('11999990000');
    expect(row.detalhe).toMatchObject({ email: EMAIL_REMOVIDO, telefone: CONTATO_REMOVIDO, contato: CONTATO_REMOVIDO, emailRef: EMAIL_REMOVIDO, fundo: { a: [{ requesterEmail: EMAIL_REMOVIDO }] } });
  });

  it('passam só o HMAC em emailRef, o domínio em emailDominio, o nulo e o que não é contato', async () => {
    const detalhe = { emailRef: `h1:${'a'.repeat(64)}`, emailDominio: 'exemplo-real.com', email: null, motivo: 'fonte sem confirmação', pacote: 'zod 4.1', n: 3, ok: true };
    expect((await gravar({ detalhe })).detalhe).toEqual(detalhe);
  });
});

describe('regra 3: colunas categóricas têm contrato fechado', () => {
  it('não persiste e-mail nem texto livre em action, resource e actorRole', async () => {
    for (const ruim of ['qa6-colunas@example.invalid', 'Texto livre com espaço', 'a/b', '', 'x'.repeat(161)]) {
      const row = await gravar({ action: ruim, resource: ruim, actorRole: ruim });
      expect(row, JSON.stringify(ruim)).toMatchObject({ action: VALOR_INVALIDO, resource: VALOR_INVALIDO, actorRole: VALOR_INVALIDO });
    }
    expect((await gravar({ actorRole: 'dona' })).actorRole).toBe(VALOR_INVALIDO);
  });

  it('os papéis do app, os atores de sistema e as ações em uso continuam iguais', async () => {
    for (const actorRole of ['admin', 'editor_chefe', 'editor', 'revisor', 'comercial', 'leitor', 'cli', 'worker', 'sistema', null]) expect((await gravar({ actorRole })).actorRole).toBe(actorRole);
    for (const action of ['login.2fa_codigo_recuperacao_falha', 'comercial.campaigns.transition', 'editorial.public.right-of-reply', 'orcamento.kill_switch_acionado']) expect((await gravar({ action })).action).toBe(action);
    const [um] = await t.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, VALOR_INVALIDO)).limit(1);
    expect(um).toBeTruthy();
  });
});
