'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { requireStudio } from '../../../_lib/guard';

const BASE = '/studio/fontes/fabrica';
const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
/** Volta à mesma busca e página (a lista é paginada); a mensagem vai na query. */
const volta = (fd: FormData, ok: boolean, msg: string): never => {
  const q = t(fd, 'q');
  const pagina = t(fd, 'pagina');
  redirect(`${BASE}?${new URLSearchParams({ ...(q ? { q } : {}), ...(/^\d+$/.test(pagina) ? { pagina } : {}), tipo: ok ? 'ok' : 'err', aviso: msg }).toString()}`);
};

/** Revisão humana dos termos (não habilita). O Backend exige revisor diferente do pesquisador e recusa aprovação com paywall/login. */
export async function revisarFonteFabricaAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe', 'revisor']);
  const r = await api.editorial.revisarFonte(t(fd, 'sourceId'), {
    sourceId: t(fd, 'sourceId'),
    termsStatus: t(fd, 'termos'),
    termsNote: t(fd, 'nota'),
    urlVerified: fd.get('urlVerificada') === 'on',
    robotsChecked: fd.get('robots') === 'on',
    paywall: t(fd, 'paywall') || 'none',
  });
  volta(fd, !ehErro(r), ehErro(r) ? mensagemErro(r) : 'Revisão registrada. A fonte continua desabilitada até a habilitação.');
}

export async function habilitarFonteFabricaAction(fd: FormData): Promise<void> {
  const ligar = t(fd, 'ligar') === '1';
  await requireStudio(ligar ? ['admin', 'editor_chefe'] : ['admin', 'editor_chefe', 'revisor']);
  const r = await api.editorial.habilitarFonte(t(fd, 'sourceId'), ligar);
  volta(fd, !ehErro(r), ehErro(r) ? mensagemErro(r) : ligar ? 'Fonte habilitada.' : 'Fonte desabilitada.');
}
