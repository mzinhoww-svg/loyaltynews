'use server';

import { redirect } from 'next/navigation';
import { getCmsService, type CheckIssue, type ServiceError } from '@/lib/studio/cms/articles';
import { parseVersionForm } from '@/lib/studio/cms/form';
import { CMS_EDIT, CMS_REVIEW } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../_lib/guard';

export interface FormState {
  erros: Record<string, string>;
  mensagem?: string;
}

function issuesToErros(issues: CheckIssue[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues ?? []) out[i.campo] ??= i.mensagem;
  return out;
}

const back = (id: string, tipo: 'ok' | 'err', msg: string): never =>
  redirect(`/studio/cms/${id}?tipo=${tipo}&aviso=${encodeURIComponent(msg)}`);

function fail(e: ServiceError): FormState {
  return { erros: issuesToErros(e.issues), mensagem: e.mensagem };
}

/** Cria (sem id) ou edita (com id: gera nova versão). */
export async function saveArticleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await requireStudio(CMS_EDIT);
  const input = parseVersionForm(fd);
  const id = typeof fd.get('id') === 'string' ? (fd.get('id') as string) : '';
  const nota = typeof fd.get('nota') === 'string' ? (fd.get('nota') as string).trim() : '';
  const svc = getCmsService();
  const r = id ? svc.edit(session.userId, id, input, nota || undefined) : svc.create(session.userId, input);
  if (!r.ok) return fail(r);
  redirect(`/studio/cms/${r.value.id}?tipo=ok&aviso=${encodeURIComponent(id ? `Nova versão v${r.value.versoes.length} salva.` : 'Rascunho criado (v1).')}`);
}

export async function submitReviewAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(CMS_EDIT);
  const id = String(fd.get('id') ?? '');
  const r = getCmsService().submitForReview(session.userId, id);
  if (!r.ok) back(id, 'err', `${r.mensagem}${r.issues ? ' ' + r.issues.filter((i) => i.severidade === 'bloqueio').map((i) => i.mensagem).join(' ') : ''}`);
  else back(id, 'ok', 'Enviada para a fila de checagem.');
}

export async function approveAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(CMS_REVIEW);
  const id = String(fd.get('id') ?? '');
  const r = getCmsService().approve(session.userId, id, Number(fd.get('versao')));
  if (!r.ok) back(id, 'err', r.mensagem);
  else back(id, 'ok', `Versão v${r.value.aprovacao!.versao} aprovada por ${session.userId}.`);
}

export async function blockAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(CMS_REVIEW);
  const id = String(fd.get('id') ?? '');
  const r = getCmsService().block(session.userId, id, String(fd.get('motivo') ?? ''));
  if (!r.ok) back(id, 'err', r.mensagem);
  else back(id, 'ok', 'Matéria bloqueada.');
}

export async function reopenAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(CMS_EDIT);
  const id = String(fd.get('id') ?? '');
  const r = getCmsService().reopen(session.userId, id);
  if (!r.ok) back(id, 'err', r.mensagem);
  else back(id, 'ok', `Reaberta como rascunho (v${r.value.versoes.length}).`);
}
