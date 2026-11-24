// Cerimônia do PRIMEIRO administrador de PRODUÇÃO (ato reservado do proprietário; roteiro: r0-preparacao/seguranca/20_cerimonia-primeiro-admin-producao.md, limites P1–P11 e S1–S8).
// Diferente do bootstrap de staging: NINGUÉM gera nem recebe segredo por esta função. A senha, o e-mail e os dois códigos do 2º fator são DIGITADOS pelo proprietário (o código vem do celular
// dele, não é calculado aqui); o segredo do TOTP e os códigos de recuperação só existem na memória e na tela do terminal do proprietário, que é limpa (com o histórico de rolagem) depois de
// cada etapa sensível. Esta função nunca grava senha, segredo, código nem o e-mail completo em log, arquivo ou auditoria; a auditoria leva só o id e o DOMÍNIO do e-mail.
// A entrada e a saída vêm de uma interface (`ProdAdminIO`): a CLI usa o terminal (TTY obrigatório); os testes usam um roteiro.
import { eq, or } from 'drizzle-orm';
import { schema } from '@ln/db';
import { audit } from './audit';
import { createStaffUser, type Auth } from './server';
import type { Db } from './types';

/** Frase digitada pelo proprietário (P2), além da flag `--confirm-production-bootstrap`. */
export const PROD_ADMIN_CONFIRM_PHRASE = 'CRIAR O PRIMEIRO ADMINISTRADOR DE PRODUCAO';
/** Palavra digitada depois de guardar os códigos de recuperação (P7). */
export const PROD_ADMIN_SAVED_WORD = 'SALVEI';
/** Senha mínima de produção (o Better Auth exige 12). */
export const PROD_ADMIN_MIN_PASSWORD = 16;
/** Tentativas por pergunta antes de desistir. */
export const PROD_ADMIN_MAX_TRIES = 3;

export interface ProdAdminIO {
  /** Pergunta com eco (frase, e-mail, nome, SALVEI). */
  ask(prompt: string): Promise<string>;
  /** Pergunta SEM eco (senha, códigos do celular). */
  askHidden(prompt: string): Promise<string>;
  show(line: string): void;
  /** Limpa a tela E o histórico de rolagem (S2). */
  clear(): void;
}

export interface ProdAdminDeps {
  db: Db;
  auth: Auth;
  handle: (request: Request) => Promise<Response>;
  /** Origem do Studio (BETTER_AUTH_URL): o handler confere o cabeçalho `origin`. */
  baseURL: string;
}

export type ProdAdminResult =
  | { status: 'created'; userId: string; emailDomain: string }
  | { status: 'refused'; reason: string }
  | { status: 'failed'; step: string; reason: string };

export interface ProdAdminOptions {
  /** Commit/SHA da CLI (vai para a auditoria). */
  commit?: string | null;
}

class Step extends Error {
  constructor(readonly step: string, message: string) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_RE = /^\d{6}$/;

export function validateProdEmail(raw: string): string {
  const e = raw.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) throw new Error('e-mail inválido');
  if (e.endsWith('.invalid') || e.endsWith('.test') || e.endsWith('.example') || e.endsWith('.localhost')) throw new Error('e-mail de produção precisa ser um endereço real (não .invalid, .test, .example ou .localhost)');
  return e;
}

async function tries<T>(io: ProdAdminIO, step: string, attempt: (n: number) => Promise<T>): Promise<T> {
  let last = 'entrada inválida';
  for (let n = 1; n <= PROD_ADMIN_MAX_TRIES; n++) {
    try {
      return await attempt(n);
    } catch (e) {
      if (e instanceof Step || (e as Error).name === 'ProdAdminAborted') throw e;
      last = (e as Error).message;
      if (n < PROD_ADMIN_MAX_TRIES) io.show(`  ${last}. Tente de novo (${n}/${PROD_ADMIN_MAX_TRIES}).`);
    }
  }
  throw new Step(step, `${last} (${PROD_ADMIN_MAX_TRIES} tentativas)`);
}

/** Apaga TUDO que o usuário criado deixou (S4): sessões, 2º fator, conta, desafios de verificação e contadores de tentativa. Cada passo é tentado mesmo se o anterior falhar. */
async function removeEverything(db: Db, userId: string, email: string): Promise<void> {
  const steps: Array<() => Promise<unknown>> = [
    () => db.delete(schema.session).where(eq(schema.session.userId, userId)),
    () => db.delete(schema.twoFactor).where(eq(schema.twoFactor.userId, userId)),
    () => db.delete(schema.account).where(eq(schema.account.userId, userId)),
    () => db.delete(schema.verification).where(eq(schema.verification.value, userId)),
    () => db.delete(schema.authAttempt).where(or(eq(schema.authAttempt.subject, email), eq(schema.authAttempt.subject, `2fa:${userId}`))),
    () => db.delete(schema.user).where(eq(schema.user.id, userId)),
  ];
  for (const s of steps) await s().catch(() => undefined);
}

const groups = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

export async function bootstrapProductionAdmin(deps: ProdAdminDeps, io: ProdAdminIO, opts: ProdAdminOptions = {}): Promise<ProdAdminResult> {
  const { db, auth, handle } = deps;
  const origin = new URL(deps.baseURL).origin;
  let userId: string | null = null;
  let email = '';
  let step = 'confirmacao';
  try {
    // P2: frase de confirmação (antes de tocar no banco)
    io.show('CERIMÔNIA DO PRIMEIRO ADMINISTRADOR DE PRODUÇÃO. Nenhum agente deve estar em execução neste computador (OpenBot fechado).');
    const phrase = await io.ask(`Para continuar, digite exatamente: ${PROD_ADMIN_CONFIRM_PHRASE}\n> `);
    if (phrase.trim() !== PROD_ADMIN_CONFIRM_PHRASE) return { status: 'refused', reason: 'frase de confirmação incorreta: nada foi feito' };

    // P8: só o primeiro
    const outros = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.role, 'admin')).limit(1);
    if (outros.length > 0) return { status: 'refused', reason: 'já existe um administrador: esta cerimônia só cria o primeiro (nada foi alterado)' };

    // P4: identidade (e-mail real e nome, digitados)
    step = 'identidade';
    email = await tries(io, step, async () => validateProdEmail(await io.ask('E-mail do administrador (endereço real seu): ')));
    const name = await tries(io, step, async () => {
      const n = (await io.ask('Nome: ')).trim();
      if (n.length < 1 || n.length > 80) throw new Error('nome de 1 a 80 caracteres');
      return n;
    });

    // P5: senha digitada duas vezes, sem eco
    step = 'senha';
    const password = await tries(io, step, async () => {
      const a = await io.askHidden(`Senha (mínimo ${PROD_ADMIN_MIN_PASSWORD} caracteres, não aparece na tela): `);
      if (a.length < PROD_ADMIN_MIN_PASSWORD || a.length > 128) throw new Error(`a senha precisa ter de ${PROD_ADMIN_MIN_PASSWORD} a 128 caracteres`);
      const b = await io.askHidden('Repita a senha: ');
      if (a !== b) throw new Error('as senhas não conferem');
      return a;
    });

    // criação (revalida "só o primeiro" imediatamente antes)
    step = 'criacao';
    if ((await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.role, 'admin')).limit(1)).length > 0) return { status: 'refused', reason: 'já existe um administrador: nada foi alterado' };
    userId = (await createStaffUser(auth, { email, name, password, role: 'admin' })).id;

    const req = (path: string, body: unknown, cookie?: string) =>
      new Request(`${origin}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': '127.0.0.1', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    const cookieOf = (r: Response) =>
      r.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .filter((c) => c && !c.endsWith('='))
        .join('; ');

    // P6: 2º fator com o celular do proprietário
    step = 'enrolamento';
    const first = await handle(req('/sign-in/email', { email, password }));
    if (!first.ok) throw new Step(step, `entrada inicial recusada (HTTP ${first.status})`);
    const c0 = cookieOf(first);
    const en = await handle(req('/two-factor/enable', { password }, c0));
    if (!en.ok) throw new Step(step, `ativação do 2º fator recusada (HTTP ${en.status})`);
    const { totpURI, backupCodes } = (await en.json()) as { totpURI: string; backupCodes?: string[] };
    const secret = new URL(totpURI).searchParams.get('secret');
    if (!secret) throw new Step(step, 'o Better Auth não devolveu o segredo do TOTP');

    io.show('');
    io.show('Abra o seu aplicativo autenticador NO CELULAR, escolha "inserir chave de configuração" e digite:');
    io.show(`  chave: ${groups(secret)}`);
    io.show('  (conta: Loyalty News; tipo: baseado em tempo; 6 dígitos; 30 segundos)');
    io.show(`  URI (alternativa): ${totpURI}`);
    io.show('Não copie nem fotografe esta tela. Ela será apagada logo depois do primeiro código.');

    step = 'codigo_1';
    let code1 = '';
    await tries(io, step, async () => {
      const c = (await io.askHidden('Código de 6 dígitos mostrado no celular: ')).trim();
      if (!CODE_RE.test(c)) throw new Error('o código tem 6 dígitos');
      const v = await handle(req('/two-factor/verify-totp', { code: c }, c0));
      if (!v.ok) throw new Error('código recusado');
      code1 = c;
    });
    io.clear(); // S2: a chave e a URI saem da tela e do histórico

    // login completo (senha + outro código) antes de entregar o administrador
    step = 'login_completo';
    const login = await handle(req('/sign-in/email', { email, password }));
    if (!login.ok) throw new Step(step, `entrada recusada (HTTP ${login.status})`);
    const pending = cookieOf(login);
    step = 'codigo_2';
    io.show('Aguarde o celular mostrar um código NOVO (muda a cada 30 s) e digite-o.');
    await tries(io, step, async () => {
      const c = (await io.askHidden('Segundo código (diferente do anterior): ')).trim();
      if (!CODE_RE.test(c)) throw new Error('o código tem 6 dígitos');
      if (c === code1) throw new Error('é o mesmo código: espere o celular trocar');
      const v = await handle(req('/two-factor/verify-totp', { code: c }, pending));
      if (!v.ok) throw new Error('código recusado');
    });

    // P7: códigos de recuperação, uma vez
    step = 'salvei';
    io.show('');
    io.show('CÓDIGOS DE RECUPERAÇÃO (cada um vale uma vez; mostrados UMA só vez). Guarde em papel ou no seu gerenciador de senhas pessoal, nunca em chat nem com agentes:');
    for (const c of backupCodes ?? []) io.show(`  ${c}`);
    await tries(io, step, async () => {
      const w = (await io.ask(`Quando tiver guardado, digite ${PROD_ADMIN_SAVED_WORD}: `)).trim();
      if (w !== PROD_ADMIN_SAVED_WORD) throw new Error(`digite ${PROD_ADMIN_SAVED_WORD} depois de guardar os códigos`);
    });
    io.clear(); // S2: os códigos saem da tela e do histórico

    // as sessões da própria CLI não ficam abertas
    await db.delete(schema.session).where(eq(schema.session.userId, userId));

    // P9: auditoria SEM segredo e SEM o endereço de e-mail (só o domínio)
    step = 'auditoria';
    const emailDomain = email.split('@')[1] ?? '';
    await audit(db, {
      actorId: null,
      actorRole: 'cli',
      action: 'bootstrap_admin_producao',
      resource: 'usuarios',
      resourceId: userId,
      detalhe: { emailDominio: emailDomain, entrega: 'tty', commit: opts.commit ?? null },
    });
    io.show('Administrador de produção criado e auditado. Feche este terminal.');
    return { status: 'created', userId, emailDomain };
  } catch (e) {
    io.clear(); // nada de segredo fica na tela depois de uma falha
    const reason = e instanceof Step ? e.message : (e as Error).name === 'ProdAdminAborted' ? 'interrompido pelo proprietário' : 'erro inesperado';
    const failedStep = e instanceof Step ? e.step : step;
    if (userId) {
      await removeEverything(db, userId, email); // S4
      await audit(db, { actorId: null, actorRole: 'cli', action: 'bootstrap_admin_producao_falhou', resource: 'usuarios', resourceId: userId, detalhe: { etapa: failedStep, commit: opts.commit ?? null } }).catch(() => undefined);
    }
    return { status: 'failed', step: failedStep, reason };
  }
}
