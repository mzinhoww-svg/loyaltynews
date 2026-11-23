'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { retornoSeguro } from '@/lib/studio/site-docs';
import { requireStudio } from '../../_lib/guard';

const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');

/** Revisão humana de um Move (editor ou superior), pela rota do Backend. O Backend recusa Move já revisado; a mensagem aparece como veio. */
export async function revisarMoveAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe', 'editor', 'revisor']);
  const status = t(fd, 'status') === 'confirmed' ? 'confirmed' : 'rejected';
  const r = await api.intelligence.revisarMove(t(fd, 'id'), status);
  const base = retornoSeguro(t(fd, 'retorno'), '/studio/entidades');
  const sep = base.includes('?') ? '&' : '?';
  const msg = ehErro(r) ? mensagemErro(r) : status === 'confirmed' ? 'Movimentação confirmada: agora o portal pode mostrá-la.' : 'Movimentação rejeitada: o portal não a mostra.';
  redirect(`${base}${sep}tipo=${ehErro(r) ? 'err' : 'ok'}&aviso=${encodeURIComponent(msg)}`);
}
