import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import {
  PROD_ADMIN_CONFIRM_PHRASE, bootstrapProductionAdmin, createAuth, createAuthHandler, createStaffUser, validateProdEmail, type ProdAdminIO, type ProdAdminResult,
} from './index';

// Cerimônia do 1º administrador de PRODUÇÃO (decisão PM-2026-11-23-N; roteiro r0-preparacao/seguranca/20_*; limites P1–P11 e S1–S8). O "proprietário" do teste é um roteiro: responde às
// perguntas e, como o celular dele, calcula o código a partir da chave que a CLI MOSTRA na tela (a CLI nunca calcula o código por ele).
const ORIGIN = 'https://studio.loyaltynews.invalid';
const EMAIL = 'Dona.Fulana@Exemplo-Real.com';
const SENHA = 'frase-longa-do-proprietario-123';
const PHRASE = PROD_ADMIN_CONFIRM_PHRASE;
let t: Awaited<ReturnType<typeof createTestDb>>;
let auth: ReturnType<typeof createAuth>;
let handle: (r: Request) => Promise<Response>;

beforeAll(async () => {
  t = await createTestDb();
  const db = t.db as never;
  auth = createAuth({ db, secret: 'x'.repeat(40), baseURL: ORIGIN });
  handle = createAuthHandler({ auth, db });
});
afterAll(async () => t.close());
const deps = () => ({ db: t.db as never, auth, handle, baseURL: ORIGIN });

/** Terminal falso: guarda o que está VISÍVEL (desde a última limpeza) e tudo o que já foi mostrado. `clear` zera o visível (tela e histórico). */
class FakeTerm implements ProdAdminIO {
  visible: string[] = [];
  everShown: string[] = [];
  clears = 0;
  prompts: string[] = [];
  constructor(private readonly answers: (prompt: string, hidden: boolean, term: FakeTerm) => string | Promise<string>) {}
  async ask(prompt: string) { this.prompts.push(prompt); return this.answers(prompt, false, this); }
  async askHidden(prompt: string) { this.prompts.push(prompt); return this.answers(prompt, true, this); }
  show(line: string) { this.visible.push(line); this.everShown.push(line); }
  clear() { this.clears++; this.visible = []; }
  /** O que o celular mostraria: a chave em base32 está na tela (linha "chave: …"). */
  key(): Uint8Array | null {
    const l = this.everShown.find((x) => x.trim().startsWith('chave:'));
    return l ? base32.decode(l.replace('chave:', '').replace(/\s+/g, '').toUpperCase()) : null;
  }
  backupCodesShown(): string[] {
    const i = this.everShown.findIndex((x) => x.startsWith('CÓDIGOS DE RECUPERAÇÃO'));
    return i < 0 ? [] : this.everShown.slice(i + 1).filter((x) => /^\s+\S+$/.test(x)).map((x) => x.trim());
  }
}

/** Proprietário que acerta tudo: o 2º código vem da JANELA SEGUINTE do celular (a CLI exige um código diferente do primeiro). */
function owner(over: Partial<{ phrase: string; email: string; name: string; senha: string; senha2: string; salvei: string; code1: (k: Uint8Array) => Promise<string>; code2: (k: Uint8Array) => Promise<string> }> = {}) {
  return new FakeTerm(async (prompt, hidden, term) => {
    if (prompt.includes('digite exatamente')) return over.phrase ?? PHRASE;
    if (prompt.startsWith('E-mail')) return over.email ?? EMAIL;
    if (prompt.startsWith('Nome')) return over.name ?? 'Fulana Proprietária';
    if (prompt.startsWith('Senha')) return over.senha ?? SENHA;
    if (prompt.startsWith('Repita')) return over.senha2 ?? over.senha ?? SENHA;
    if (prompt.includes('digite SALVEI')) return over.salvei ?? 'SALVEI';
    if (hidden) {
      const key = term.key()!;
      if (prompt.includes('Segundo código')) {
        const next = Math.floor(Date.now() / 1000 / 30) + 1;
        return over.code2 ? over.code2(key) : createOTP(key).hotp(next);
      }
      return over.code1 ? over.code1(key) : createOTP(key).totp();
    }
    return '';
  });
}

const counts = async () => ({
  users: (await t.db.select().from(schema.user)).length,
  twoFactor: (await t.db.select().from(schema.twoFactor)).length,
  accounts: (await t.db.select().from(schema.account)).length,
  sessions: (await t.db.select().from(schema.session)).length,
});
const reset = async () => {
  for (const tbl of [schema.session, schema.twoFactor, schema.account, schema.verification, schema.authAttempt, schema.user] as const) await t.db.delete(tbl as never);
};
const run = (term: FakeTerm): Promise<ProdAdminResult> => bootstrapProductionAdmin(deps(), term, { commit: 'abc1234' });

describe('validação do e-mail de produção', () => {
  it('só endereço real: .invalid/.test/.example/.localhost e formato inválido são recusados; normaliza para minúsculas', () => {
    expect(validateProdEmail('  Dona@Exemplo.COM ')).toBe('dona@exemplo.com');
    for (const ruim of ['sem-arroba', 'a@b', 'a b@c.com', 'admin@loyaltynews.invalid', 'x@y.test', 'x@y.example', 'x@host.localhost', '']) expect(() => validateProdEmail(ruim), ruim).toThrow();
  });
});

describe('cerimônia completa (caminho feliz)', () => {
  it('cria UM admin com 2º fator ativo, login completo conferido, sessões apagadas, auditoria só com id e domínio; a tela é limpa e nada sensível fica visível', async () => {
    await reset();
    const term = owner();
    const r = await run(term);
    expect(r).toMatchObject({ status: 'created', emailDomain: 'exemplo-real.com' });
    const [u] = await t.db.select().from(schema.user);
    expect(u).toMatchObject({ role: 'admin', twoFactorEnabled: true, banned: false, email: 'dona.fulana@exemplo-real.com' });
    expect(await counts()).toEqual({ users: 1, twoFactor: 1, accounts: 1, sessions: 0 });
    // o login de verdade funciona: senha + código do "celular"
    const login = await handle(new Request(`${ORIGIN}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({ email: 'dona.fulana@exemplo-real.com', password: SENHA }) }));
    expect(((await login.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    // S2: duas limpezas (depois da chave e depois do SALVEI); no fim NADA sensível está visível
    expect(term.clears).toBeGreaterThanOrEqual(2);
    const visivel = term.visible.join('\n');
    const key = term.key()!;
    expect(visivel).not.toContain(SENHA);
    expect(visivel).not.toMatch(/chave:|otpauth:|secret=/);
    for (const c of term.backupCodesShown()) expect(visivel).not.toContain(c);
    // a chave e os códigos de recuperação foram mostrados UMA vez antes da limpeza correspondente
    expect(key.length).toBeGreaterThan(8);
    expect(term.backupCodesShown().length).toBeGreaterThan(0);
    // a senha NUNCA é mostrada nem em eco
    expect(term.everShown.join('\n')).not.toContain(SENHA);
    expect(term.prompts.filter((p) => p.startsWith('Senha') || p.startsWith('Repita') || p.includes('Código') || p.includes('Segundo código'))).toHaveLength(4);
  });

  it('auditoria bootstrap_admin_producao com id, domínio, entrega e commit: sem senha, chave, códigos nem o endereço de e-mail', async () => {
    const logs = (await t.db.select().from(schema.auditLog)).filter((l) => l.action === 'bootstrap_admin_producao');
    expect(logs).toHaveLength(1);
    const dump = JSON.stringify(logs);
    expect(logs[0]).toMatchObject({ resource: 'usuarios', actorRole: 'cli' });
    expect(dump).toContain('exemplo-real.com');
    expect(dump).toContain('abc1234');
    for (const proibido of [SENHA, 'dona.fulana', 'Dona.Fulana', 'secret', 'otpauth']) expect(dump, proibido).not.toContain(proibido);
  });
});

describe('recusas (nada é criado)', () => {
  it('frase de confirmação errada (P2): recusa antes de tocar no banco', async () => {
    await reset();
    const r = await run(owner({ phrase: 'criar o primeiro administrador de producao' }));
    expect(r).toMatchObject({ status: 'refused' });
    expect(await counts()).toMatchObject({ users: 0 });
  });

  it('já existe um administrador (P8): recusa e não altera nada', async () => {
    await reset();
    await createStaffUser(auth, { email: 'outro@exemplo-real.com', name: 'Outro', password: 'senha-longa-de-teste-1', role: 'admin' });
    const antes = await counts();
    const r = await run(owner());
    expect(r).toMatchObject({ status: 'refused', reason: expect.stringMatching(/já existe um administrador/) });
    expect(await counts()).toEqual(antes);
  });

  it('e-mail de teste (.invalid) três vezes: falha na identidade, sem usuário', async () => {
    await reset();
    const r = await run(owner({ email: 'admin.staging@loyaltynews.invalid' }));
    expect(r).toMatchObject({ status: 'failed', step: 'identidade' });
    expect(await counts()).toMatchObject({ users: 0 });
  });

  it('senha curta (menos de 16) ou que não confere: falha na senha, sem usuário', async () => {
    await reset();
    expect(await run(owner({ senha: 'curta-12345678' }))).toMatchObject({ status: 'failed', step: 'senha' });
    expect(await run(owner({ senha: SENHA, senha2: SENHA + 'x' }))).toMatchObject({ status: 'failed', step: 'senha' });
    expect(await counts()).toMatchObject({ users: 0 });
  });
});

describe('S4: falha não deixa nada', () => {
  const nada = async () => expect(await counts()).toEqual({ users: 0, twoFactor: 0, accounts: 0, sessions: 0 });
  let base = 0;
  const todas = async () => (await t.db.select().from(schema.auditLog)).filter((l) => l.action === 'bootstrap_admin_producao_falhou');
  const marca = async () => { base = (await todas()).length; };
  const falhou = async () => (await todas()).slice(base);

  it('código do celular errado três vezes: o usuário, o 2º fator, a conta e as sessões somem; auditoria bootstrap_admin_producao_falhou com a etapa e sem segredo; tela limpa', async () => {
    await reset();
    await marca();
    const term = owner({ code1: async () => '000000' });
    const r = await run(term);
    expect(r).toMatchObject({ status: 'failed', step: 'codigo_1' });
    await nada();
    const logs = await falhou();
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).toContain('codigo_1');
    for (const proibido of [SENHA, 'dona.fulana', 'secret', 'otpauth']) expect(JSON.stringify(logs), proibido).not.toContain(proibido);
    expect(term.visible.join('\n')).not.toMatch(/chave:|otpauth:/);
  });

  it('segundo código igual ao primeiro (não esperou o celular trocar): falha em codigo_2 e remove tudo', async () => {
    await reset();
    await marca();
    let primeiro = '';
    const term = owner({
      code1: async (k) => (primeiro = await createOTP(k).totp()),
      code2: async () => primeiro,
    });
    expect(await run(term)).toMatchObject({ status: 'failed', step: 'codigo_2' });
    await nada();
    expect((await falhou())).toHaveLength(1);
  });

  it('não digitou SALVEI (três vezes): falha e remove tudo (os códigos de recuperação não foram guardados)', async () => {
    await reset();
    await marca();
    const term = owner({ salvei: 'depois' });
    expect(await run(term)).toMatchObject({ status: 'failed', step: 'salvei' });
    await nada();
    expect(term.visible.join('\n')).not.toContain(term.backupCodesShown()[0] ?? '§');
  });

  it('o proprietário interrompe (Ctrl-C) no meio: o usuário parcial é removido e a falha é auditada', async () => {
    await reset();
    await marca();
    const term = new FakeTerm((prompt) => {
      if (prompt.includes('digite exatamente')) return PHRASE;
      if (prompt.startsWith('E-mail')) return EMAIL;
      if (prompt.startsWith('Nome')) return 'Fulana';
      if (prompt.startsWith('Senha') || prompt.startsWith('Repita')) return SENHA;
      const e = new Error('abortado');
      e.name = 'ProdAdminAborted';
      throw e;
    });
    const r = await run(term);
    expect(r).toMatchObject({ status: 'failed', reason: 'interrompido pelo proprietário' });
    await nada();
    expect((await falhou())).toHaveLength(1);
  });

  it('depois de uma falha a cerimônia pode ser repetida do zero e termina bem', async () => {
    await reset();
    await run(owner({ code1: async () => '000000' }));
    await nada();
    expect(await run(owner())).toMatchObject({ status: 'created' });
    expect(await counts()).toMatchObject({ users: 1, twoFactor: 1 });
    const [u] = await t.db.select().from(schema.user).where(eq(schema.user.role, 'admin'));
    expect(u?.twoFactorEnabled).toBe(true);
  });
});
