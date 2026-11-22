// Sessão do LN Studio. Usa @ln/auth (o stub do scaffold nega sempre; o Backend entrega a real).
// Exceção controlada de teste: sessão simulada SOMENTE se LN_STUDIO_TEST_SESSION=1 no ambiente do processo.
// O playwright.config a define; nenhum deploy pode defini-la (ponto para Security/QA verificarem). Quando ativa, a UI mostra o aviso MOCK.
import { ROLES, getSession, type Role, type Session } from '@ln/auth';

export const TEST_COOKIE = 'ln-test-session';

export function testSessionEnabled(env: Record<string, string | undefined>): boolean {
  return env.LN_STUDIO_TEST_SESSION === '1';
}

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
  return { userId, roles, mfa: flag !== 'nomfa' };
}

export interface ResolvedSession {
  session: Session | null;
  /** true quando a sessão veio da exceção de teste (a UI deve exibir MOCK). */
  simulada: boolean;
}

export async function resolveStudioSession(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): Promise<ResolvedSession> {
  if (testSessionEnabled(env)) {
    const sim = parseTestSession(readCookie(headers.get('cookie'), TEST_COOKIE));
    if (sim) return { session: sim, simulada: true };
  }
  const session = await getSession(new Request('http://studio.local/', { headers }));
  return { session, simulada: false };
}
