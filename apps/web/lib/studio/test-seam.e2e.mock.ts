// MOCK — sessão simulada SOMENTE para e2e. Este arquivo só entra no build quando LN_E2E_BUILD=1 (alias em next.config.ts,
// distDir .next-e2e). O build de produção nunca o inclui (scripts/verify-no-mock.mjs prova). Mesmo no build e2e, só vale com
// LN_STUDIO_TEST_SESSION=1 no ambiente do processo. A UI mostra o aviso MOCK quando ele é usado.
import { ROLES, type Role, type Session } from '@ln/auth';
import type { TestSeam } from './session';

export const TEST_COOKIE = 'ln-test-session';

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** Cookie `ln-test-session=<userId>:<papel>[+papel][:nomfa]`. Papel desconhecido: sem sessão. */
export function parseTestSession(cookieValue: string | undefined): Session | null {
  if (!cookieValue) return null;
  const [userId, rolesRaw, flag] = cookieValue.split(':');
  if (!userId || !rolesRaw) return null;
  const roles = rolesRaw.split('+');
  if (!roles.every((r): r is Role => (ROLES as readonly string[]).includes(r))) return null;
  // Campos da Session real (@ln/auth, Better Auth): papel principal = primeiro da lista; e-mail e id fictícios (MOCK).
  return { userId, email: `${userId}@mock.invalid`, role: roles[0]!, roles, mfa: flag !== 'nomfa', sessionId: `mock-${userId}` };
}

export const testSeam: TestSeam | null = (headers, env) => {
  if (env.LN_STUDIO_TEST_SESSION !== '1') return null;
  return parseTestSession(readCookie(headers.get('cookie'), TEST_COOKIE));
};
