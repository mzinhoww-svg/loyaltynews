import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { flagAtiva } from '@/lib/studio/flags';
import { StudioLayout } from '@ln/ui';
import { visibleModules, GRUPOS, checkAccess } from '@/lib/studio/modules';
import { StudioSidebar, type NavItem } from '../_components/Sidebar';
import { MigalhasStudio } from '../_components/MigalhasStudio';
import { currentSession, urlDeEntrada } from '../_lib/guard';

export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const { session } = await currentSession();
  const acesso = checkAccess(session, ['admin', 'editor_chefe', 'editor', 'revisor', 'comercial', 'leitor']);
  if (!acesso.ok) redirect(await urlDeEntrada(acesso.reason));
  const itens: NavItem[] = visibleModules(session).map((m) => ({
    slug: m.slug,
    nome: m.nome,
    grupo: GRUPOS[m.grupo],
    flagDesligada: Boolean(m.flag) && !flagAtiva(m.flag!),
  }));
  return (
    <StudioLayout sidebar={<StudioSidebar itens={itens} />}>
      <header className="st-top">
        <p>
          Sessão: <strong>{session!.email ?? session!.userId}</strong> · papéis: {session!.roles.join(', ')} · <a href="/studio/conta" data-link-conta>Minha conta</a>
        </p>
      </header>
      <MigalhasStudio />
      {children}
    </StudioLayout>
  );
}
