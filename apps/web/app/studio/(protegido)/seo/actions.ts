'use server';

import { getSeo } from '@/lib/studio/seo';
import { ESCRITA_EDITORIAL } from '@/lib/studio/papeis';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/seo';

export async function criarRedirectAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(ESCRITA_EDITORIAL);
  voltar(BASE, getSeo().criar(session.userId, texto(fd, 'de'), texto(fd, 'para'), Number(texto(fd, 'codigo'))), 'Redirecionamento criado.');
}

export async function removerRedirectAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(ESCRITA_EDITORIAL);
  voltar(BASE, getSeo().remover(session.userId, texto(fd, 'id')), 'Redirecionamento removido.');
}
