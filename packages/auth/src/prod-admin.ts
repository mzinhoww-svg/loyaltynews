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
  /** O proprietário interrompeu (Ctrl-C) ANTES de qualquer alteração: nada mudou. */
  | { status: 'cancelled' }
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
    if (!userId && (e as Error).name === 'ProdAdminAborted') return { status: 'cancelled' }; // antes de criar qualquer coisa: nada mudou
    const reason = e instanceof Step ? e.message : (e as Error).name === 'ProdAdminAborted' ? 'interrompido pelo proprietário' : 'erro inesperado';
    const failedStep = e instanceof Step ? e.step : step;
    if (userId) {
      await removeEverything(db, userId, email); // S4
      await audit(db, { actorId: null, actorRole: 'cli', action: 'bootstrap_admin_producao_falhou', resource: 'usuarios', resourceId: userId, detalhe: { etapa: failedStep, commit: opts.commit ?? null } }).catch(() => undefined);
    }
    return { status: 'failed', step: failedStep, reason };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// S8: REVOGAR o administrador de produção (credencial vazada, celular e códigos perdidos). Mesmos P1–P3 da criação (CLI só do proprietário, TTY, ambiente e banco de produção), frase PRÓPRIA,
// e a ordem importa: primeiro `banned` (a guarda nega qualquer sessão de usuário banido) e as sessões são apagadas; só depois se apaga o resto. Se a remoção falhar no meio o usuário
// continua BANIDO e sem sessão (estado seguro) e o evento `revogacao_admin_producao_incompleta` é auditado. Depois da revogação não há administrador: a cerimônia de criação pode ser repetida.
// Auditoria `revogacao_admin_producao`: id e DOMÍNIO do e-mail, nunca o endereço nem segredo.
// ---------------------------------------------------------------------------------------------------------------------

/** Frase digitada pelo proprietário para revogar (diferente da de criação). */
export const PROD_ADMIN_REVOKE_PHRASE = 'REVOGAR O ADMINISTRADOR DE PRODUCAO';

export type ProdAdminRevokeResult =
  | { status: 'revoked'; userId: string; emailDomain: string }
  | { status: 'refused'; reason: string }
  /** Ctrl-C antes de qualquer alteração: nada mudou. */
  | { status: 'cancelled' }
  | { status: 'incomplete'; userId: string; step: string };

/** O que dizer ao proprietário conforme ONDE a revogação parou: a mensagem nunca afirma um estado que não foi alcançado. */
export function revokeIncompleteMessage(step: string): string {
  if (step === 'banimento') return 'A revogação falhou ao BANIR o administrador: NADA foi alterado (ele continua ativo, com sessões e 2º fator). Rode de novo; se persistir, chame o Security (quebra-vidro).';
  if (step === 'sessoes') return 'A revogação parou ao apagar as sessões: o administrador está BANIDO (a guarda nega qualquer sessão de banido), mas as sessões podem ainda existir no banco. Rode de novo ou chame o Security.';
  return 'A revogação parou na remoção: o administrador está BANIDO e sem sessões (estado seguro), mas a remoção dos dados não terminou. Rode de novo ou chame o Security.';
}

export async function revokeProductionAdmin(deps: Pick<ProdAdminDeps, 'db'>, io: ProdAdminIO, opts: ProdAdminOptions = {}): Promise<ProdAdminRevokeResult> {
  const { db } = deps;
  io.show('REVOGAÇÃO DO ADMINISTRADOR DE PRODUÇÃO. Nenhum agente deve estar em execução neste computador (OpenBot fechado).');
  let phrase: string;
  try {
    phrase = await io.ask(`Para continuar, digite exatamente: ${PROD_ADMIN_REVOKE_PHRASE}\n> `);
  } catch (e) {
    if ((e as Error).name === 'ProdAdminAborted') return { status: 'cancelled' }; // Ctrl-C antes de qualquer alteração: nada mudou
    throw e;
  }
  if (phrase.trim() !== PROD_ADMIN_REVOKE_PHRASE) return { status: 'refused', reason: 'frase de confirmação incorreta: nada foi feito' };
  const admins = await db.select({ id: schema.user.id, email: schema.user.email }).from(schema.user).where(eq(schema.user.role, 'admin'));
  if (admins.length === 0) return { status: 'refused', reason: 'não há administrador para revogar' };
  let alvo: { id: string; email: string } | undefined;
  try {
    alvo = await tries(io, 'identidade', async () => {
      const e = (await io.ask('E-mail do administrador a revogar: ')).trim().toLowerCase();
      const achado = admins.find((a) => a.email.toLowerCase() === e);
      if (!achado) throw new Error('nenhum administrador com esse e-mail');
      return achado;
    });
  } catch (e) {
    if ((e as Error).name === 'ProdAdminAborted') return { status: 'cancelled' };
    return { status: 'refused', reason: 'administrador não identificado: nada foi feito' };
  }
  const emailDomain = alvo.email.split('@')[1] ?? '';
  const userId = alvo.id;
  let step = 'banimento';
  try {
    // 1) banido primeiro: a guarda nega qualquer sessão de usuário banido, mesmo que o resto falhe
    await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, userId));
    // 2) sessões
    step = 'sessoes';
    await db.delete(schema.session).where(eq(schema.session.userId, userId));
    // 3) o resto (cada passo é obrigatório aqui: se algo falhar, o usuário fica banido e o evento é incompleto)
    step = 'remocao';
    await db.delete(schema.twoFactor).where(eq(schema.twoFactor.userId, userId));
    await db.delete(schema.account).where(eq(schema.account.userId, userId));
    await db.delete(schema.verification).where(eq(schema.verification.value, userId));
    await db.delete(schema.authAttempt).where(or(eq(schema.authAttempt.subject, alvo.email), eq(schema.authAttempt.subject, `2fa:${userId}`)));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
  } catch {
    await audit(db, { actorId: null, actorRole: 'cli', action: 'revogacao_admin_producao_incompleta', resource: 'usuarios', resourceId: userId, detalhe: { etapa: step, commit: opts.commit ?? null } }).catch(() => undefined);
    io.show(revokeIncompleteMessage(step));
    return { status: 'incomplete', userId, step };
  }
  await audit(db, { actorId: null, actorRole: 'cli', action: 'revogacao_admin_producao', resource: 'usuarios', resourceId: userId, detalhe: { emailDominio: emailDomain, etapas: ['banido', 'sessoes_apagadas', 'removido'], commit: opts.commit ?? null } });
  io.show('Administrador revogado: banido, sessões apagadas e removido (auditado como revogacao_admin_producao). Para voltar a ter um administrador, repita a cerimônia de criação.');
  return { status: 'revoked', userId, emailDomain };
}
