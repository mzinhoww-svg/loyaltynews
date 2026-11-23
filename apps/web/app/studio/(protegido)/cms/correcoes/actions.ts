'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { requireStudio } from '../../../_lib/guard';

const GERIR = ['admin', 'editor_chefe'] as const;
const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');

const aviso = (destino: string, ok: boolean, msg: string): never => redirect(`${destino}?tipo=${ok ? 'ok' : 'err'}&aviso=${encodeURIComponent(msg)}`);

/** Abre um caso (errata interna ou direito de resposta registrado pela redação). Identidade do solicitante nasce NÃO verificada. */
export async function abrirCasoAction(fd: FormData): Promise<void> {
  await requireStudio(GERIR);
  const prazo = t(fd, 'prazo');
  const contato = t(fd, 'contato');
  const resposta = t(fd, 'resposta');
  const r = await api.editorial.abrirCorrecao({
    articleId: t(fd, 'articleId'),
    kind: t(fd, 'kind'),
    contested: t(fd, 'contestado'),
    requester: { name: t(fd, 'solicitante'), channel: t(fd, 'canal') || 'internal' },
    ...(contato ? { contact: contato } : {}),
    ...(resposta ? { replyText: resposta } : {}),
    ...(prazo ? { deadlineAt: `${prazo}T23:59:59-03:00` } : {}),
  });
  if (ehErro(r)) return aviso('/studio/cms/correcoes', false, mensagemErro(r));
  const id = (r.body as { id: string }).id;
  return aviso(`/studio/cms/correcoes/${encodeURIComponent(id)}`, true, 'Caso aberto. A identidade do solicitante ainda não está verificada.');
}

/** Um passo do fluxo do caso. O Backend aplica papéis, estados e bloqueios; a mensagem de recusa é mostrada como veio. */
export async function passoCasoAction(fd: FormData): Promise<void> {
  const op = t(fd, 'op');
  await requireStudio(op === 'ack-legal' ? ['admin'] : GERIR);
  const id = t(fd, 'id');
  let corpo: Record<string, unknown> = {};
  if (op === 'verify-requester') corpo = { method: t(fd, 'metodo') };
  else if (op === 'preserve-evidence') corpo = { url: t(fd, 'url'), body: t(fd, 'corpo') };
  else if (op === 'triage') {
    const claimTexto = t(fd, 'claimTexto');
    corpo = {
      accepted: t(fd, 'decisao') === 'aceitar',
      reason: t(fd, 'motivo'),
      ...(t(fd, 'corrigido') ? { corrected: t(fd, 'corrigido') } : {}),
      ...(claimTexto
        ? { claims: [{ id: 'c1', text: claimTexto, kind: t(fd, 'claimTipo') || 'fact', evidenceIds: t(fd, 'claimEvidencias').split(',').map((x) => x.trim()).filter(Boolean) }] }
        : {}),
      ...(fd.get('juridico') === 'on' ? { legal: true } : {}),
    };
  } else if (op === 'publish-notice') corpo = { socialPosts: [] };
  else if (op === 'reconcile-social') corpo = { receipts: [] };
  const r = await api.editorial.passoCorrecao(id, op, corpo);
  const destino = `/studio/cms/correcoes/${encodeURIComponent(id)}`;
  return aviso(destino, !ehErro(r), ehErro(r) ? mensagemErro(r) : 'Passo registrado.');
}
