'use server';

import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/midia';
const falha = (r: Parameters<typeof mensagemErro>[0]) => ({ ok: false as const, erros: [mensagemErro(r)] });

/** Registra os METADADOS e a base de direito de um ativo (upload ao armazenamento ainda não está ligado no Backend). */
export async function registrarMidiaAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe', 'editor']);
  const link = texto(fd, 'link');
  const r = await api.midia.criar({
    tipo: texto(fd, 'tipo') || 'imagem',
    sha256: texto(fd, 'sha256').toLowerCase(),
    direitos: {
      url: texto(fd, 'url'),
      origem: texto(fd, 'origem') || 'propria',
      credito: texto(fd, 'credito'),
      baseDeDireito: texto(fd, 'base') || 'pendente',
      textoAlternativo: texto(fd, 'alt'),
      edicoes: [],
      ...(link ? { link } : {}),
    },
  });
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Ativo registrado na biblioteca.');
}

export async function removerMidiaAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe']);
  const r = await api.midia.excluir(texto(fd, 'id'));
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Ativo removido.');
}
