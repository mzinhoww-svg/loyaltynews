import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { CMS_READ } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../../../_lib/guard';
import { SemBanco } from '../../../../_components/SemBanco';

export const metadata: Metadata = { title: 'Caso de correção' };
export const dynamic = 'force-dynamic';

interface Caso {
  id: string;
  articleId: string;
  kind: string;
  state: string;
  legal: boolean;
  contested: string;
  receivedAt: string;
  deadlineAt: string | null;
  requester: { name: string; identityVerified: boolean; channel: string };
  socialPosts: unknown[];
  entitiesRebuilt: boolean;
  ownerAckAt: string | null;
  history: { at?: string; step?: string; state?: string; [k: string]: unknown }[];
  replyText: string | null;
}

export default async function CasoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStudio(CMS_READ);
  const id = decodeURIComponent((await params).id);
  const r = await api.editorial.correcao(id);
  if (naoConfigurado(r)) return <SemBanco modulo="O módulo de correções" />;
  if (r.status === 404 || r.status === 400) notFound();
  if (ehErro(r)) throw new Error(mensagemErro(r));
  const c = r.body as Caso;
  return (
    <>
      <p>
        <Link href="/studio/cms/correcoes">← Correções</Link>
      </p>
      <h1>Caso {c.id}</h1>
      <p className="st-hint">
        {c.kind} · estado {c.state} · matéria {c.articleId} · recebido {c.receivedAt.slice(0, 16).replace('T', ' ')} · prazo {c.deadlineAt ? c.deadlineAt.slice(0, 10) : 'sem prazo'}
      </p>
      <h2>Contestação</h2>
      <p>{c.contested}</p>
      <p>
        Solicitante: {c.requester.name} ({c.requester.channel}) — identidade {c.requester.identityVerified ? 'verificada' : 'NÃO verificada'}. O contato nunca é exibido.
      </p>
      {c.legal ? <p className="st-alert err">Caso com componente jurídico: exige ciência do responsável.</p> : null}
      <p>
        Entidades reconstruídas: {c.entitiesRebuilt ? 'sim' : 'não'} · posts sociais ligados: {c.socialPosts.length} · ciência do dono: {c.ownerAckAt ? c.ownerAckAt.slice(0, 16).replace('T', ' ') : 'pendente'}
      </p>
      {c.replyText ? (
        <>
          <h2>Texto da resposta</h2>
          <p>{c.replyText}</p>
        </>
      ) : null}
      <h2>Histórico ({c.history.length})</h2>
      {c.history.length === 0 ? (
        <p className="st-hint">Sem passos registrados.</p>
      ) : (
        <ul className="st-issues">
          {c.history.map((h, i) => (
            <li key={i}>
              <code>{JSON.stringify(h)}</code>
            </li>
          ))}
        </ul>
      )}
      <p className="st-hint">Os passos do fluxo (verificar solicitante, preservar evidência, triagem, aviso, redes, fechamento) são rotas da API com papéis e prazos; a ação por botão entra junto da tela de abertura de caso.</p>
    </>
  );
}
