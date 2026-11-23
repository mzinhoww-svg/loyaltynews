'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { PAPEIS_COMERCIAIS } from '@/lib/studio/comercial';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

export async function criarCampanhaAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const r = await api.comercial.criarCampanha({
    name: texto(fd, 'nome'),
    accountId: texto(fd, 'conta'),
    formatId: texto(fd, 'formato'),
    startDate: texto(fd, 'inicio'),
    endDate: texto(fd, 'fim'),
    sponsoredLabel: fd.get('rotulo') === 'on',
  });
  if (ehErro(r)) return voltar('/studio/campanhas', { ok: false, erros: [mensagemErro(r)] }, '');
  const id = (r.body as { id: string }).id;
  redirect(`/studio/campanhas/${encodeURIComponent(id)}?tipo=ok&aviso=${encodeURIComponent('Campanha criada em rascunho.')}`);
}

export async function transicaoAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const id = texto(fd, 'id');
  const r = await api.comercial.transicaoCampanha({ campaignId: id, to: texto(fd, 'para'), ...(texto(fd, 'nota') ? { note: texto(fd, 'nota') } : {}) });
  voltar(`/studio/campanhas/${encodeURIComponent(id)}`, ehErro(r) ? { ok: false, erros: [mensagemErro(r)] } : { ok: true }, 'Estado da campanha atualizado.');
}
