'use server';

import { dispatchSocial } from '@/app/api/_lib/social';
import { chamar, ehErro, mensagemErro } from '@/lib/studio/backend';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const API = '/api/studio/social';

export async function gerarPacotesAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe', 'editor']);
  const articleId = texto(fd, 'articleId');
  if (!articleId) return voltar('/studio/social', { ok: false, erros: ['Escolha uma matéria aprovada.'] }, '');
  const r = await chamar(dispatchSocial, `${API}/packages`, { metodo: 'POST', corpo: { articleId, channels: [texto(fd, 'canal') || 'linkedin'] } });
  voltar('/studio/social', ehErro(r) ? { ok: false, erros: [mensagemErro(r)] } : { ok: true }, 'Pacote gerado (idempotente).');
}

export async function publicarSimuladoAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe']);
  const id = texto(fd, 'id');
  const r = await chamar(dispatchSocial, `${API}/packages/${encodeURIComponent(id)}/publish-simulated`, { metodo: 'POST', corpo: {} });
  voltar(`/studio/social/${encodeURIComponent(id)}`, ehErro(r) ? { ok: false, erros: [mensagemErro(r)] } : { ok: true }, 'Publicação SIMULADA registrada (nada foi ao mLabs).');
}
