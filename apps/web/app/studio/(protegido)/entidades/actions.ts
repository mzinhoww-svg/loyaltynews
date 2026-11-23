'use server';

import { reviewMoveHandler } from '@ln/intelligence';
import { bancoIntelligence } from '@/lib/studio/intelligence-db';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

/** Revisão humana de movimentação (papel editorial com revisão). O handler recusa move já revisado. */
export async function revisarMoveAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(['admin', 'editor_chefe', 'revisor']);
  const { db } = await bancoIntelligence();
  const r = await reviewMoveHandler(db, session.userId, { id: texto(fd, 'id'), status: texto(fd, 'status') });
  const err = (r.body as { error?: { message: string } }).error;
  voltar('/studio/entidades', err ? { ok: false, erros: [err.message] } : { ok: true }, 'Movimentação revisada.');
}
