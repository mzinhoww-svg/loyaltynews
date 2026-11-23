'use server';

import { getMidia } from '@/lib/studio/midia';
import { ESCRITA_EDITORIAL } from '@/lib/studio/papeis';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/midia';

export async function registrarMidiaAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(ESCRITA_EDITORIAL);
  const r = getMidia().registrar(session.userId, {
    url: texto(fd, 'url'),
    origem: texto(fd, 'origem') || 'propria',
    credito: texto(fd, 'credito'),
    baseDeDireito: texto(fd, 'base') || 'pendente',
    textoAlternativo: texto(fd, 'alt'),
    ...(texto(fd, 'link') ? { link: texto(fd, 'link') } : {}),
    ...(texto(fd, 'expira') ? { expiraEm: texto(fd, 'expira') } : {}),
    ...(texto(fd, 'evidencia') ? { evidenciaLicenca: texto(fd, 'evidencia') } : {}),
  });
  voltar(BASE, r, 'Ativo registrado na biblioteca.');
}

export async function removerMidiaAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(ESCRITA_EDITORIAL);
  voltar(BASE, getMidia().remover(session.userId, texto(fd, 'id')), 'Ativo removido.');
}
