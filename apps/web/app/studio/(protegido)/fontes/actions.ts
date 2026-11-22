'use server';

import { getFontes } from '@/lib/studio/fontes';
import { ESCRITA_EDITORIAL } from '@/lib/studio/papeis';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/fontes';

export async function criarFonteAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(ESCRITA_EDITORIAL);
  const r = getFontes().criar(session.userId, {
    nome: texto(fd, 'nome'),
    url: texto(fd, 'url'),
    tipo: texto(fd, 'tipo'),
    editorias: fd.getAll('editorias').map(String),
    termosRevisados: fd.get('termos') === 'on',
    ativo: fd.get('ativo') === 'on',
  });
  voltar(BASE, r, 'Fonte cadastrada.');
}

export async function revisarTermosAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(ESCRITA_EDITORIAL);
  const svc = getFontes();
  const f = svc.get(texto(fd, 'id'));
  if (!f) return voltar(BASE, { ok: false, erros: ['Fonte não encontrada.'] }, '');
  voltar(BASE, svc.atualizar(session.userId, f.id, { ...f, termosRevisados: true }), 'Termos marcados como revisados.');
}

export async function alternarFonteAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(ESCRITA_EDITORIAL);
  voltar(BASE, getFontes().alternarAtivo(session.userId, texto(fd, 'id')), 'Estado da fonte alterado.');
}
