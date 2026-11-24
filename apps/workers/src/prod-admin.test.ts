import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { PROD_ADMIN_CONFIRM_PHRASE, createAuth, createAuthHandler, type ProdAdminIO } from '@ln/auth';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import { CLEAR_SEQUENCE, TerminalAborted, TerminalIO, assertProductionBound, run } from './prod-admin';
import type { BindingsFile } from './staging-admin';

// CLI da cerimônia do 1º administrador de PRODUÇÃO (roteiro 20_, P1–P11, S1–S8). A lógica da cerimônia está em packages/auth/src/prod-admin.test.ts; aqui: barreiras da CLI (ambiente,
// vínculo do banco, confirmação, TTY, argumentos), o terminal (entrada SEM eco, Ctrl-C, limpeza de tela e do histórico de rolagem) e a saída sem segredo.
const DB = 'postgres://app:SENHA-DO-BANCO@prod-db.vertra.invalid:5432/ln_prod';
const PROD = { APP_ENV: 'production', DATABASE_URL: DB };
const BINDINGS: BindingsFile = { ambientes: { staging: { dbHost: 'stg.vertra.invalid', dbName: 'ln_stg' }, production: { dbHost: 'prod-db.vertra.invalid', dbName: 'ln_prod' } } };
const SEM_PROD: BindingsFile = { ambientes: { staging: { dbHost: 'stg.vertra.invalid', dbName: 'ln_stg' }, production: { dbHost: null, dbName: null } } };
const OK = ['--confirm-production-bootstrap'];
const ORIGIN = 'https://studio.loyaltynews.invalid';
const SENHA = 'frase-longa-do-proprietario-123';
let t: Awaited<ReturnType<typeof createTestDb>>;
let deps: { db: never; auth: ReturnType<typeof createAuth>; handle: (r: Request) => Promise<Response>; baseURL: string };

beforeAll(async () => {
  t = await createTestDb();
  const db = t.db as never;
  const auth = createAuth({ db, secret: 'x'.repeat(40), baseURL: ORIGIN });
  deps = { db, auth, handle: createAuthHandler({ auth, db }), baseURL: ORIGIN };
});
afterAll(async () => t.close());

const nenhumUsuario = async () => expect(await t.db.select().from(schema.user)).toHaveLength(0);
const exec = async (argv: string[], env: Record<string, string | undefined> = PROD, ctx: Parameters<typeof run>[4] = {}) => {
  const out: string[] = [];
  const code = await run(argv, env, (s) => out.push(s), deps, { bindings: BINDINGS, tty: true, io: undefined, ...ctx });
  return { code, text: out.join('\n') };
};

describe('P1: ambiente e vínculo do banco (antes de qualquer conexão)', () => {
  it('APP_ENV diferente de production (staging, producao, Production, vazio) recusa com 2 e não toca no banco', async () => {
    for (const APP_ENV of ['staging', 'producao', 'Production', ' production', '', 'homologacao']) {
      const r = await exec(OK, { APP_ENV, DATABASE_URL: DB });
      expect(r.code, APP_ENV).toBe(2);
      expect(r.text).toMatch(/só vale com APP_ENV=production/);
    }
    expect((await exec(OK, { DATABASE_URL: DB } as never)).code).toBe(2);
    await nenhumUsuario();
  });

  it('produção SEM vínculo no bindings.json (dbHost/dbName nulos, como hoje) recusa', async () => {
    const r = await exec(OK, PROD, { bindings: SEM_PROD });
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/sem vínculo de banco/);
    expect(() => assertProductionBound(DB, {})).toThrow(/sem vínculo/);
    await nenhumUsuario();
  });

  it('DATABASE_URL de outro banco (staging, host ou nome diferentes, ausente ou inválida) recusa SEM repetir a URL', async () => {
    for (const url of [
      'postgres://app:SENHA-STG@stg.vertra.invalid:5432/ln_stg',
      'postgres://app:SENHA-X@prod-db.vertra.invalid:5432/ln_stg', // host certo, banco errado
      'postgres://app:SENHA-Y@outro.vertra.invalid:5432/ln_prod', // banco certo, host errado
      'mysql://app:SENHA-Z@prod-db.vertra.invalid/ln_prod',
      'isto-nao-e-url',
      '',
    ]) {
      const r = await exec(OK, { APP_ENV: 'production', DATABASE_URL: url });
      expect(r.code, url).toBe(2);
      expect(r.text).not.toMatch(/SENHA|@|ln_prod|vertra\.invalid/); // a mensagem nunca repete host, banco nem credencial
    }
    expect(() => assertProductionBound(DB, BINDINGS)).not.toThrow();
    expect(() => assertProductionBound('postgres://u:p@PROD-DB.vertra.invalid/ln_prod', BINDINGS)).not.toThrow(); // host sem diferença de caixa
    await nenhumUsuario();
  });
});

describe('P2 e P3: confirmação e só interativo', () => {
  it('sem --confirm-production-bootstrap recusa; flags de entrega por arquivo ou argumento (--secret-file, --tty, --email, --recreate) também', async () => {
    expect((await exec([])).code).toBe(2);
    expect((await exec([])).text).toMatch(/--confirm-production-bootstrap/);
    for (const extra of [['--secret-file', '/tmp/x.json'], ['--tty'], ['--email', 'a@b.com'], ['--recreate'], ['--senha', 'x'], ['valor-solto']]) {
      const r = await exec([...OK, ...extra]);
      expect(r.code, extra.join(' ')).toBe(2);
      expect(r.text).toMatch(/^uso: prod-admin/);
    }
    await nenhumUsuario();
  });

  it('sem terminal na entrada E na saída (pipe, arquivo, CI) recusa e orienta Windows Terminal ou PowerShell', async () => {
    const r = await exec(OK, PROD, { tty: false });
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/Windows Terminal ou o PowerShell/);
    expect(r.text).toMatch(/Git Bash/);
    await nenhumUsuario();
  });

  it('fora dos testes (sem dependências injetadas) exige BETTER_AUTH_SECRET ≥ 32 e BETTER_AUTH_URL https://', async () => {
    const out: string[] = [];
    const sem = await run(OK, { ...PROD }, (s) => out.push(s), undefined, { bindings: BINDINGS, tty: true });
    expect(sem).toBe(2);
    expect(out.join('\n')).toMatch(/BETTER_AUTH_SECRET/);
    out.length = 0;
    const http = await run(OK, { ...PROD, BETTER_AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: 'http://studio.exemplo.com' }, (s) => out.push(s), undefined, { bindings: BINDINGS, tty: true });
    expect(http).toBe(2);
    expect(out.join('\n')).toMatch(/BETTER_AUTH_URL/);
  });
});

describe('cerimônia pela CLI (terminal falso): saída sem segredo e códigos de saída', () => {
  /** Proprietário de roteiro: a chave aparece em `show`, o "celular" calcula os códigos. */
  const dono = (over: { frase?: string } = {}) => {
    const mostrado: string[] = [];
    let limpezas = 0;
    const io: ProdAdminIO = {
      show: (l) => mostrado.push(l),
      clear: () => { limpezas++; },
      ask: async (p) => (p.includes('digite exatamente') ? (over.frase ?? PROD_ADMIN_CONFIRM_PHRASE) : p.startsWith('E-mail') ? 'dona@exemplo-real.com' : p.startsWith('Nome') ? 'Fulana' : 'SALVEI'),
      askHidden: async (p) => {
        if (p.startsWith('Senha') || p.startsWith('Repita')) return SENHA;
        const l = mostrado.find((x) => x.trim().startsWith('chave:'))!;
        const key = base32.decode(l.replace('chave:', '').replace(/\s+/g, '').toUpperCase());
        return p.includes('Segundo') ? createOTP(key).hotp(Math.floor(Date.now() / 1000 / 30) + 1) : createOTP(key).totp();
      },
    };
    return { io, mostrado, limpezas: () => limpezas };
  };

  it('cria o administrador (saída 0): a mensagem final só leva o domínio; nada de senha, chave, código ou e-mail no stdout da CLI', async () => {
    const d = dono();
    const r = await exec(OK, PROD, { io: d.io });
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/Administrador de produção criado \(domínio exemplo-real\.com\)/);
    for (const proibido of [SENHA, 'dona@exemplo-real.com', 'secret=', 'otpauth', 'SENHA-DO-BANCO', DB]) expect(r.text, proibido).not.toContain(proibido);
    expect(d.limpezas()).toBeGreaterThanOrEqual(2);
    const [u] = await t.db.select().from(schema.user);
    expect(u).toMatchObject({ role: 'admin', twoFactorEnabled: true });
  });

  it('com o administrador já criado a segunda execução recusa (saída 2) sem alterar nada', async () => {
    const antes = (await t.db.select().from(schema.user)).length;
    const r = await exec(OK, PROD, { io: dono().io });
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/já existe um administrador/);
    expect((await t.db.select().from(schema.user)).length).toBe(antes);
  });
});

describe('TerminalIO: entrada sem eco, Ctrl-C e limpeza da tela e do histórico (S2, S5)', () => {
  const mk = () => {
    const stdin = Object.assign(new PassThrough(), { isRaw: false, setRawMode(v: boolean) { this.isRaw = v; return this; } });
    const saida: string[] = [];
    const io = new TerminalIO(stdin as never, { write: (s: string) => saida.push(s) });
    return { stdin, saida, io };
  };

  it('askHidden NÃO ecoa o que foi digitado (nem backspace); o texto volta intacto; modo bruto ligado e restaurado', async () => {
    const { stdin, saida, io } = mk();
    const p = io.askHidden('Senha: ');
    expect(stdin.isRaw).toBe(true);
    stdin.write('segr');
    stdin.write('ex\u007fo-123\r');
    expect(await p).toBe('segreo-123'); // 'segrex' + backspace + 'o-123'
    expect(stdin.isRaw).toBe(false);
    expect(saida.join('')).not.toMatch(/segr|123|o-/); // só o prompt e a quebra de linha
    expect(saida.join('')).toContain('Senha: ');
  });

  it('ask ECOA (frase, e-mail, SALVEI); setas e outros controles são descartados; colar vários caracteres de uma vez funciona', async () => {
    const { stdin, saida, io } = mk();
    const p = io.ask('E-mail: ');
    stdin.write('ab\u001b[Ac\u0001d@x.co\r');
    expect(await p).toBe('abcd@x.co');
    expect(saida.join('')).toContain('abcd@x.co');
  });

  it('Ctrl-C e Ctrl-D (linha vazia) rejeitam com ProdAdminAborted e restauram o terminal', async () => {
    for (const tecla of ['\u0003', '\u0004']) {
      const { stdin, io } = mk();
      const p = io.askHidden('Código: ');
      stdin.write(tecla);
      await expect(p).rejects.toBeInstanceOf(TerminalAborted);
      expect(stdin.isRaw).toBe(false);
    }
  });

  it('clear escreve exatamente ESC[3J ESC[2J ESC[H (tela, histórico de rolagem e cursor)', () => {
    const { saida, io } = mk();
    io.clear();
    expect(CLEAR_SEQUENCE).toBe('\u001b[3J\u001b[2J\u001b[H');
    expect(saida).toEqual([CLEAR_SEQUENCE]);
  });

  it('o código-fonte da CLI não usa área de transferência (S5) nem leitura de segredo por argumento ou variável', async () => {
    const { readFileSync } = await import('node:fs');
    const fonte = readFileSync(new URL('./prod-admin.ts', import.meta.url), 'utf8');
    expect(fonte).not.toMatch(/clipboard|pbcopy|clip\.exe|Set-Clipboard|xclip/i);
    expect(fonte).not.toMatch(/process\.env\.(?:[A-Z_]*PASSWORD|[A-Z_]*SENHA|[A-Z_]*TOTP)/);
    const nucleo = readFileSync(new URL('../../../packages/auth/src/prod-admin.ts', import.meta.url), 'utf8');
    expect(nucleo).not.toMatch(/console\.(log|error|info)|process\.stdout/); // todo texto sai pela interface de terminal
  });
});

describe('S8: modo --revoke pela CLI', () => {
  const REV = ['--revoke', '--confirm-production-revoke'];

  it('exige os DOIS argumentos e nada mais; não mistura com a criação; as mesmas barreiras P1/P3 valem (ambiente, vínculo, TTY)', async () => {
    for (const ruim of [['--revoke'], ['--confirm-production-revoke'], [...REV, '--confirm-production-bootstrap'], [...REV, '--secret-file', '/tmp/x'], [...REV, 'x@y.com'], ['--revoke', '--confirm-production-bootstrap']]) {
      const r = await exec(ruim);
      expect(r.code, ruim.join(' ')).toBe(2);
      expect(r.text).toMatch(/^uso: prod-admin/);
    }
    expect((await exec(REV, { APP_ENV: 'staging', DATABASE_URL: DB })).code).toBe(2);
    expect((await exec(REV, PROD, { bindings: SEM_PROD })).text).toMatch(/sem vínculo de banco/);
    expect((await exec(REV, { APP_ENV: 'production', DATABASE_URL: 'postgres://u:SENHA@outro.vertra.invalid/ln_prod' })).code).toBe(2);
    const sem = await exec(REV, PROD, { tty: false });
    expect(sem.code).toBe(2);
    expect(sem.text).toMatch(/Windows Terminal ou o PowerShell/);
  });

  it('revoga pelo terminal (saída 0): a mensagem só leva o domínio; frase errada = saída 2 sem alterar; depois de revogada, repetir recusa (não há administrador)', async () => {
    // cria o administrador pela própria CLI (terminal falso)
    const mostrado: string[] = [];
    const criador: ProdAdminIO = {
      show: (l) => mostrado.push(l),
      clear: () => undefined,
      ask: async (p) => (p.includes('digite exatamente') ? PROD_ADMIN_CONFIRM_PHRASE : p.startsWith('E-mail') ? 'dona@exemplo-real.com' : p.startsWith('Nome') ? 'Fulana' : 'SALVEI'),
      askHidden: async (p) => {
        if (p.startsWith('Senha') || p.startsWith('Repita')) return SENHA;
        const l = mostrado.find((x) => x.trim().startsWith('chave:'))!;
        const key = base32.decode(l.replace('chave:', '').replace(/\s+/g, '').toUpperCase());
        return p.includes('Segundo') ? createOTP(key).hotp(Math.floor(Date.now() / 1000 / 30) + 1) : createOTP(key).totp();
      },
    };
    await t.db.delete(schema.user as never);
    expect((await exec(OK, PROD, { io: criador })).code).toBe(0);
    const revogador = (frase: string): ProdAdminIO => ({ show: () => undefined, clear: () => undefined, ask: async (p) => (p.includes('digite exatamente') ? frase : 'dona@exemplo-real.com'), askHidden: async () => '' });
    const errada = await exec(REV, PROD, { io: revogador('revogar') });
    expect(errada.code).toBe(2);
    expect(await t.db.select().from(schema.user)).toHaveLength(1);
    const ok = await exec(REV, PROD, { io: revogador('REVOGAR O ADMINISTRADOR DE PRODUCAO') });
    expect(ok.code).toBe(0);
    expect(ok.text).toMatch(/revogado \(domínio exemplo-real\.com\)/);
    for (const proibido of [SENHA, 'dona@exemplo-real.com', 'otpauth', DB]) expect(ok.text, proibido).not.toContain(proibido);
    await nenhumUsuario();
    const de_novo = await exec(REV, PROD, { io: revogador('REVOGAR O ADMINISTRADOR DE PRODUCAO') });
    expect(de_novo.code).toBe(2);
    expect(de_novo.text).toMatch(/não há administrador para revogar/);
  });
});
