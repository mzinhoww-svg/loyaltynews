'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { retornoSeguro } from '@/lib/studio/site-docs';
import { requireStudio } from '../../_lib/guard';

const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');

const PODE_CARGOS = ['admin', 'editor_chefe', 'editor'] as const;
const voltaCom = (fd: FormData, ok: boolean, msg: string): never => {
  const base = retornoSeguro(t(fd, 'retorno'), '/studio/entidades');
  const sep = base.includes('?') ? '&' : '?';
  return redirect(`${base}${sep}tipo=${ok ? 'ok' : 'err'}&aviso=${encodeURIComponent(msg)}`);
};

/**
 * Confirma um cargo "a confirmar" com a página OFICIAL. Quem confirma é a pessoa (editor ou superior): o servidor não lê a página, só confere que é
 * https, do mesmo site da fonte oficial cadastrada da empresa e nunca LinkedIn/The Org. Vira fato (oficial); não cria Move.
 */
export async function confirmarCargoAction(fd: FormData): Promise<void> {
  await requireStudio(PODE_CARGOS);
  const r = await api.intelligence.confirmarCargo(t(fd, 'id'), t(fd, 'officialUrl'));
  voltaCom(fd, !ehErro(r), ehErro(r) ? mensagemErro(r) : 'Cargo confirmado com a página oficial: agora é fato (nível oficial).');
}

/** Descarta o cargo "a confirmar" com motivo (5 a 200 caracteres): fecha o cargo e sai da fila. */
export async function descartarCargoAction(fd: FormData): Promise<void> {
  await requireStudio(PODE_CARGOS);
  const r = await api.intelligence.descartarCargo(t(fd, 'id'), t(fd, 'motivo'));
  voltaCom(fd, !ehErro(r), ehErro(r) ? mensagemErro(r) : 'Cargo descartado: saiu da fila de confirmação.');
}

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
