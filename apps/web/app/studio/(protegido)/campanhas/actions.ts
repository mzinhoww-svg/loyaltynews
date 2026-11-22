'use server';

import { createCampaign, transitionCampaign } from '@ln/commercial/api';
import { comercialCtx, PAPEIS_COMERCIAIS, viaHandler } from '@/lib/studio/comercial';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

export async function criarCampanhaAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(PAPEIS_COMERCIAIS);
  const r = createCampaign(comercialCtx(session), {
    name: texto(fd, 'nome'),
    accountId: texto(fd, 'conta'),
    formatId: texto(fd, 'formato'),
    startDate: texto(fd, 'inicio'),
    endDate: texto(fd, 'fim'),
    sponsoredLabel: fd.get('rotulo') === 'on',
  });
  voltar('/studio/campanhas', viaHandler(r), 'Campanha criada em rascunho.');
}

export async function transicaoAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(PAPEIS_COMERCIAIS);
  const id = texto(fd, 'id');
  const r = transitionCampaign(comercialCtx(session), { campaignId: id, to: texto(fd, 'para') as 'cancelled', ...(texto(fd, 'nota') ? { note: texto(fd, 'nota') } : {}) });
  voltar(`/studio/campanhas/${encodeURIComponent(id)}`, viaHandler(r), 'Estado da campanha atualizado.');
}
