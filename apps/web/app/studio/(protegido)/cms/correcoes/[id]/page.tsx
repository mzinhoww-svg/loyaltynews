import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { checkAccess } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { CMS_READ } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../../../_lib/guard';
import { Flash } from '../../../../_components/Flash';
import { SemBanco } from '../../../../_components/SemBanco';
import { passoCasoAction } from '../actions';

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
  notice: { text: string; publishedAt: string } | null;
  history: { at: string; from: string | null; to: string; note?: string }[];
  replyText: string | null;
}

function Passo({ op, id, rotulo, children }: { op: string; id: string; rotulo: string; children?: React.ReactNode }) {
  return (
    <form action={passoCasoAction} className="st-card" style={{ marginBottom: 12 }} aria-label={rotulo}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <h3 style={{ marginTop: 0 }}>{rotulo}</h3>
      {children}
      <button className="st-btn" type="submit">
        {rotulo}
      </button>
    </form>
  );
}

export default async function CasoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireStudio(CMS_READ);
  const id = decodeURIComponent((await params).id);
  const { tipo, aviso } = await searchParams;
  const r = await api.editorial.correcao(id);
  if (naoConfigurado(r)) return <SemBanco modulo="O módulo de correções" />;
  if (r.status === 404 || r.status === 400) notFound();
  if (ehErro(r)) throw new Error(mensagemErro(r));
  const c = r.body as Caso;
  const podeGerir = checkAccess(session, ['admin', 'editor_chefe']).ok;
  const ehAdmin = checkAccess(session, ['admin']).ok;
  // URL pública canônica da página contestada: /noticia/{slug} (a matéria pode ser só do CMS ou da Fábrica; sem slug o campo fica vazio)
  const materia = await api.materias.obter(c.articleId);
  const slug = !ehErro(materia) ? materia.body.data.slug : null;
  const base = (process.env.PORTAL_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');
  const urlPublica = base && slug ? base + '/noticia/' + slug : '';
  const aceito = ['accepted', 'escalated_legal', 'notice_published', 'social_reconciled'].includes(c.state);
  return (
    <>
      <p>
        <Link href="/studio/cms/correcoes">← Correções</Link>
      </p>
      <h1>Caso {c.id}</h1>
      <p className="st-hint" data-estado={c.state}>
        {c.kind} · estado <strong>{c.state}</strong> · matéria {c.articleId} · recebido {c.receivedAt.slice(0, 16).replace('T', ' ')} · prazo {c.deadlineAt ? c.deadlineAt.slice(0, 10) : 'sem prazo'}
      </p>
      <Flash tipo={tipo} aviso={aviso} />
      <p>
        <Link href={`/studio/cms/${encodeURIComponent(c.articleId)}`}>Abrir a matéria</Link>
        {aceito ? ' para registrar a revisão de correção (seção Correção).' : '.'}
      </p>
      <h2>Contestação</h2>
      <p>{c.contested}</p>
      <p>
        Solicitante: {c.requester.name} ({c.requester.channel}) — identidade {c.requester.identityVerified ? 'verificada' : 'NÃO verificada'}. O contato nunca é exibido.
      </p>
      {c.legal ? <p className="st-alert err">Caso com componente jurídico: exige ciência do responsável (admin).</p> : null}
      <p>
        Entidades reconstruídas: {c.entitiesRebuilt ? 'sim' : 'não'} · posts sociais ligados: {c.socialPosts.length} · ciência do responsável: {c.ownerAckAt ? c.ownerAckAt.slice(0, 16).replace('T', ' ') : 'pendente'}
      </p>
      {c.replyText ? (
        <>
          <h2>Texto da resposta (preservado sem alteração)</h2>
          <p>{c.replyText}</p>
        </>
      ) : null}
      {c.notice ? (
        <>
          <h2>Aviso publicado</h2>
          <p>{c.notice.text}</p>
        </>
      ) : null}

      <h2>Fluxo</h2>
      {c.state === 'closed' ? <p className="st-hint">Caso encerrado.</p> : null}
      {!podeGerir && !ehAdmin ? <p className="st-hint">Seu papel só acompanha os casos.</p> : null}
      {podeGerir && c.state !== 'closed' ? (
        <div>
          {!c.requester.identityVerified ? (
            <Passo op="verify-requester" id={c.id} rotulo="Verificar solicitante">
              <div className="st-field">
                <label htmlFor="metodo">Método de verificação (mínimo 3 caracteres)</label>
                <input id="metodo" name="metodo" type="text" />
              </div>
            </Passo>
          ) : null}
          {c.state === 'received' ? (
            <Passo op="preserve-evidence" id={c.id} rotulo="Preservar evidência">
              <div className="st-field">
                <label htmlFor="url">URL da página contestada</label>
                <input id="url" name="url" type="url" defaultValue={urlPublica} />
              </div>
              <div className="st-field">
                <label htmlFor="corpo">Conteúdo capturado da página</label>
                <textarea id="corpo" name="corpo" style={{ minHeight: 80 }} />
              </div>
            </Passo>
          ) : null}
          {c.state === 'evidence_preserved' ? (
            <Passo op="triage" id={c.id} rotulo="Registrar triagem">
              <div className="st-field">
                <label htmlFor="decisao">Decisão</label>
                <select id="decisao" name="decisao" defaultValue="aceitar">
                  <option value="aceitar">Aceitar</option>
                  <option value="rejeitar">Rejeitar</option>
                </select>
              </div>
              <div className="st-field">
                <label htmlFor="motivo">Motivo (mínimo 3 caracteres)</label>
                <input id="motivo" name="motivo" type="text" />
              </div>
              {c.kind === 'erratum' ? (
                <>
                  <div className="st-field">
                    <label htmlFor="corrigido">Texto corrigido (errata aceita)</label>
                    <input id="corrigido" name="corrigido" type="text" />
                  </div>
                  <div className="st-field">
                    <label htmlFor="claimTexto">Afirmação que sustenta a correção</label>
                    <input id="claimTexto" name="claimTexto" type="text" />
                  </div>
                  <div className="st-field">
                    <label htmlFor="claimEvidencias">IDs das evidências (separados por vírgula)</label>
                    <input id="claimEvidencias" name="claimEvidencias" type="text" />
                  </div>
                </>
              ) : null}
              <div className="st-field">
                <label>
                  <input type="checkbox" name="juridico" /> Marcar como caso jurídico
                </label>
              </div>
            </Passo>
          ) : null}
          {c.state === 'accepted' || (c.state === 'escalated_legal' && c.ownerAckAt) ? <Passo op="publish-notice" id={c.id} rotulo="Publicar aviso" /> : null}
          {c.state === 'notice_published' ? (
            <>
              <Passo op="reconcile-social" id={c.id} rotulo="Reconciliar redes sociais" />
              {!c.entitiesRebuilt ? <Passo op="entities-rebuilt" id={c.id} rotulo="Marcar entidades reconstruídas" /> : null}
            </>
          ) : null}
          {c.state === 'social_reconciled' || c.state === 'rejected' ? <Passo op="close" id={c.id} rotulo="Encerrar caso" /> : null}
        </div>
      ) : null}
      {ehAdmin && c.state === 'escalated_legal' && !c.ownerAckAt ? <Passo op="ack-legal" id={c.id} rotulo="Dar ciência do caso jurídico" /> : null}
      {!ehAdmin && c.state === 'escalated_legal' && !c.ownerAckAt ? <p className="st-hint">Aguardando a ciência do responsável (admin).</p> : null}

      <h2>Histórico ({c.history.length})</h2>
      {c.history.length === 0 ? (
        <p className="st-hint">Sem passos registrados.</p>
      ) : (
        <ol className="st-issues" aria-label="Histórico do caso">
          {c.history.map((h, i) => (
            <li key={i}>
              {h.at.slice(0, 16).replace('T', ' ')} · {h.from ?? '—'} → {h.to}
              {h.note ? ` — ${h.note}` : ''}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
