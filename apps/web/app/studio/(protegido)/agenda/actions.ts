'use server';

import { getAgenda } from '@/lib/studio/agenda';
import { ESCRITA_EDITORIAL, MODERACAO } from '@/lib/studio/papeis';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/agenda';

export async function criarEventoAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(ESCRITA_EDITORIAL);
  const url = texto(fd, 'url');
  const r = getAgenda().criar(session.userId, {
    titulo: texto(fd, 'titulo'),
    inicio: texto(fd, 'inicio'),
    fim: texto(fd, 'fim') || texto(fd, 'inicio'),
    local: texto(fd, 'local'),
    ...(url ? { url } : {}),
    editorias: fd.getAll('editorias').map(String),
    patrocinado: fd.get('patrocinado') === 'on',
    fonteUrl: texto(fd, 'fonteUrl'),
  });
  voltar(BASE, r, 'Evento criado e enviado para moderação.');
}

export async function moderarEventoAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(MODERACAO);
  const decisao = texto(fd, 'decisao') === 'aprovado' ? 'aprovado' : 'rejeitado';
  voltar(BASE, getAgenda().moderar(session.userId, texto(fd, 'id'), decisao, texto(fd, 'motivo')), decisao === 'aprovado' ? 'Evento aprovado.' : 'Evento rejeitado.');
}
