'use server';

import { addWatchlistItemHandler, createWatchlistHandler, reviewAlertHandler } from '@ln/intelligence';
import { bancoIntelligence } from '@/lib/studio/intelligence-db';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/watchlists';
const ESCRITA = ['admin', 'editor_chefe', 'editor', 'revisor'] as const;
const msg = (r: { body: unknown }) => (r.body as { error?: { message: string } }).error?.message;

export async function criarWatchlistAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(ESCRITA);
  const { db } = await bancoIntelligence();
  const r = await createWatchlistHandler(db, session.userId, { name: texto(fd, 'nome') });
  const m = msg(r);
  voltar(BASE, m ? { ok: false, erros: [m] } : { ok: true }, 'Watchlist criada.');
}

export async function acompanharAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA);
  const { db } = await bancoIntelligence();
  const r = await addWatchlistItemHandler(db, { watchlistId: texto(fd, 'lista'), entityId: texto(fd, 'entidade'), entityType: texto(fd, 'tipoEntidade') });
  const m = msg(r);
  voltar(BASE, m ? { ok: false, erros: [m] } : { ok: true }, 'Entidade adicionada à watchlist.');
}

export async function revisarAlertaAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(['admin', 'editor_chefe', 'revisor']);
  const { db } = await bancoIntelligence();
  const r = await reviewAlertHandler(db, session.userId, { id: texto(fd, 'id'), status: texto(fd, 'status') });
  const m = msg(r);
  voltar(BASE, m ? { ok: false, erros: [m] } : { ok: true }, 'Alerta revisado.');
}
