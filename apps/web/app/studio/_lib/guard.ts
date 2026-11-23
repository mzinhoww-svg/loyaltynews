// Proteção de rota do LN Studio: todo /studio exige sessão real (negar por padrão). Layouts não rodam em navegação
// suave, então CADA página e CADA server action chama o guard por conta própria.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role, Session } from '@ln/auth';
import { checkAccess, type StudioModule } from '@/lib/studio/modules';
import { resolveStudioSession } from '@/lib/studio/session';

export interface Guarded {
  session: Session;
}

export async function requireStudio(allowed: readonly Role[]): Promise<Guarded> {
  const { session } = await currentSession();
  const r = checkAccess(session, allowed);
  if (!r.ok) redirect(`/studio/entrar?motivo=${r.reason}`);
  return { session: session! };
}

export const requireModule = (mod: StudioModule) => requireStudio(mod.roles);

/** Para o layout: sessão sem exigir papel (o papel é exigido por página). */
export async function currentSession() {
  return resolveStudioSession(await headers());
}
