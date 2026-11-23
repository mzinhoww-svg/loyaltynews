import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { isEnabled } from '@ln/contracts';
import { StudioLayout } from '@ln/ui';
import { visibleModules, GRUPOS, checkAccess } from '@/lib/studio/modules';
import { StudioSidebar, type NavItem } from '../_components/Sidebar';
import { currentSession } from '../_lib/guard';

export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const { session } = await currentSession();
  const acesso = checkAccess(session, ['admin', 'editor_chefe', 'editor', 'revisor', 'comercial', 'leitor']);
  if (!acesso.ok) redirect(`/studio/entrar?motivo=${acesso.reason}`);
  const itens: NavItem[] = visibleModules(session).map((m) => ({
    slug: m.slug,
    nome: m.nome,
    grupo: GRUPOS[m.grupo],
    flagDesligada: Boolean(m.flag) && !isEnabled(m.flag!),
  }));
  return (
    <StudioLayout sidebar={<StudioSidebar itens={itens} />}>
      <header className="st-top">
        <p>
          Sessão: <strong>{session!.email ?? session!.userId}</strong> · papéis: {session!.roles.join(', ')}
        </p>
      </header>
      {children}
    </StudioLayout>
  );
}
