// Troca da PRÓPRIA senha pelo usuário logado (LN Studio, /studio/conta). Única porta de troca de senha: a rota direta
// /api/auth/change-password do Better Auth fica fora da lista do handler (sem ela este limite e a política seriam contornáveis).
// Regras: sessão com 2º fator; nova senha com 12+ caracteres (até 128), igual à confirmação e diferente da atual; a troca em si é o
// changePassword do Better Auth (hash e gravação dele, nada próprio) com revokeOtherSessions (apaga todas as sessões e abre uma nova
// para quem trocou); limite de senha atual errada: 5 por 15 min, bloqueio de 15 min, por usuário e por IP (pré-cobrado, atômico,
// compartilhado com as rotas do 2º fator que conferem a senha);
// auditoria `change_password` em todo resultado, sem senha (o detalhe só leva o resultado).
import { audit } from './audit';
import { chargePasswordAttempt, passwordNotChecked, passwordOk } from './password-attempts';
import { sessionFromHeaders } from './guard';
import type { Auth } from './server';
import type { Db } from './types';

export const SENHA_MIN = 12;
export const SENHA_MAX = 128;
export const CHANGE_PASSWORD_ACTION = 'change_password';

export interface ChangeOwnPasswordInput {
  atual: unknown;
  nova: unknown;
  confirmacao: unknown;
}

export interface ChangeOwnPasswordDeps {
  auth: Auth;
  db: Db;
  /** Cabeçalhos da requisição (cookie da sessão). */
  headers: Headers;
  ip: string | null;
  now?: () => Date;
}

export type ChangeOwnPasswordCode =
  | 'UNAUTHENTICATED'
  | 'MFA_REQUIRED'
  | 'VALIDATION_ERROR'
  | 'INVALID_CURRENT_PASSWORD'
  | 'TOO_MANY_ATTEMPTS'
  | 'INTERNAL_ERROR';

export type ChangeOwnPasswordResult =
  | { ok: true; status: 200; mensagem: string; setCookies: string[] }
  | { ok: false; status: number; code: ChangeOwnPasswordCode; mensagem: string; erros?: string[]; retryAfter?: number };

/** Política da nova senha (sem tocar no banco). Lista vazia = ok. Mensagens em pt-BR. */
export function validarNovaSenha(atual: string, nova: string, confirmacao: string): string[] {
  const erros: string[] = [];
  if (!atual) erros.push('Informe a senha atual.');
  if (!nova) erros.push('Informe a nova senha.');
  else if (nova.length < SENHA_MIN) erros.push(`A nova senha precisa ter pelo menos ${SENHA_MIN} caracteres.`);
  else if (nova.length > SENHA_MAX) erros.push(`A nova senha pode ter no máximo ${SENHA_MAX} caracteres.`);
  if (nova && confirmacao !== nova) erros.push('A confirmação não é igual à nova senha.');
  if (atual && nova && atual === nova) erros.push('A nova senha precisa ser diferente da atual.');
  return erros;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Código de erro do Better Auth (APIError: body.code), sem depender da classe. */
function codigoBetterAuth(e: unknown): string | undefined {
  const x = e as { body?: { code?: unknown }; code?: unknown } | null;
  const c = x?.body?.code ?? x?.code;
  return typeof c === 'string' ? c : undefined;
}

export async function changeOwnPassword(deps: ChangeOwnPasswordDeps, input: ChangeOwnPasswordInput): Promise<ChangeOwnPasswordResult> {
  const { auth, db, headers, ip } = deps;
  const t = (deps.now ?? (() => new Date()))();
  const session = await sessionFromHeaders(auth, headers);
  if (!session) return { ok: false, status: 401, code: 'UNAUTHENTICATED', mensagem: 'Sua sessão terminou. Entre de novo para trocar a senha.' };
  if (!session.mfa) return { ok: false, status: 403, code: 'MFA_REQUIRED', mensagem: 'A troca de senha exige a verificação em duas etapas ativa.' };

  const registrar = (resultado: string, extra: Record<string, unknown> = {}) =>
    audit(db, { actorId: session.userId, actorRole: session.role, action: CHANGE_PASSWORD_ACTION, resource: 'usuario', resourceId: session.userId, ip, detalhe: { resultado, ...extra }, at: t });

  const atual = str(input.atual);
  const nova = str(input.nova);
  const confirmacao = str(input.confirmacao);
  const erros = validarNovaSenha(atual, nova, confirmacao);
  if (erros.length) {
    await registrar('recusada_politica');
    return { ok: false, status: 400, code: 'VALIDATION_ERROR', mensagem: erros.join(' '), erros };
  }

  // pré-cobra a tentativa (atômico por sujeito) ANTES de verificar a senha atual: N simultâneas não passam de 5.
  // Contador compartilhado com as rotas do 2º fator que conferem a senha (password-attempts.ts).
  const gate = await chargePasswordAttempt(db, session.userId, ip, t);
  if (!gate.allowed) {
    await registrar('bloqueada', { ate: gate.until.toISOString() });
    const minutos = Math.max(1, Math.ceil(gate.retryAfter / 60));
    return { ok: false, status: 429, code: 'TOO_MANY_ATTEMPTS', mensagem: `Muitas tentativas com a senha atual errada. Tente de novo em ${minutos} min.`, retryAfter: gate.retryAfter };
  }

  let setCookies: string[];
  try {
    const r = await auth.api.changePassword({ headers, body: { currentPassword: atual, newPassword: nova, revokeOtherSessions: true }, returnHeaders: true });
    setCookies = r.headers.getSetCookie();
  } catch (e) {
    const code = codigoBetterAuth(e);
    if (code === 'INVALID_PASSWORD') {
      await registrar('senha_atual_incorreta');
      return { ok: false, status: 400, code: 'INVALID_CURRENT_PASSWORD', mensagem: 'A senha atual está incorreta.' };
    }
    // erro inesperado: devolve a cobrança (não foi senha errada) e registra só o código
    await passwordNotChecked(db, gate.charge);
    if (code === 'UNAUTHORIZED') {
      await registrar('sem_sessao');
      return { ok: false, status: 401, code: 'UNAUTHENTICATED', mensagem: 'Sua sessão terminou. Entre de novo para trocar a senha.' };
    }
    await registrar('erro', { erro: code ?? 'desconhecido' });
    return { ok: false, status: 500, code: 'INTERNAL_ERROR', mensagem: 'Não foi possível trocar a senha agora. Tente de novo.' };
  }

  // senha certa: zera o contador do usuário e devolve a cobrança do IP
  await passwordOk(db, gate.charge);
  await registrar('ok', { outrasSessoesRevogadas: true });
  return { ok: true, status: 200, mensagem: 'Senha trocada. As outras sessões foram encerradas.', setCookies };
}
