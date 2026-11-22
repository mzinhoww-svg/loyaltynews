import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { isEnabled } from '@ln/contracts';
import { StudioLayout } from '@ln/ui';
import { visibleModules, GRUPOS, checkAccess } from '@/lib/studio/modules';
import { StudioSidebar, type NavItem } from '../_components/Sidebar';
import { currentSession } from '../_lib/guard';

export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const { session, simulada } = await currentSession();
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
          Sessão: <strong>{session!.userId}</strong> · papéis: {session!.roles.join(', ')}
        </p>
        {simulada ? <span className="st-mock">MOCK · sessão de teste simulada (não é login real)</span> : null}
      </header>
      {children}
    </StudioLayout>
  );
}
