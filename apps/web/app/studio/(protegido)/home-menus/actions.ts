'use server';

import { alternarBloco, alternarMenu, getHome, moverBloco, moverMenu } from '@/lib/studio/home';
import { CHEFIA_EDITORIAL } from '@/lib/studio/papeis';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/home-menus';
const dir = (fd: FormData) => (texto(fd, 'dir') === 'up' ? -1 : 1);

/** Edições da tela mexem só no RASCUNHO; nada vira versão até "Salvar versão". */
export async function editarHomeAction(fd: FormData): Promise<void> {
  await requireStudio(CHEFIA_EDITORIAL);
  const id = texto(fd, 'id');
  const op = texto(fd, 'op');
  getHome().editarRascunho((c) => {
    if (op === 'mover-bloco') return moverBloco(c, id, dir(fd));
    if (op === 'alternar-bloco') return alternarBloco(c, id);
    if (op === 'mover-menu') return moverMenu(c, id, dir(fd));
    if (op === 'alternar-menu') return alternarMenu(c, id);
    return c;
  });
  voltar(BASE, { ok: true }, 'Rascunho atualizado (ainda não é uma versão).');
}

export async function salvarVersaoAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(CHEFIA_EDITORIAL);
  const r = getHome().salvarRascunho(session.userId, texto(fd, 'nota'));
  voltar(BASE, r, r.ok ? `Versão v${r.valor.numero} salva.` : '');
}

export async function descartarRascunhoAction(): Promise<void> {
  await requireStudio(CHEFIA_EDITORIAL);
  getHome().descartarRascunho();
  voltar(BASE, { ok: true }, 'Rascunho descartado.');
}

export async function reverterAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(CHEFIA_EDITORIAL);
  const r = getHome().reverter(session.userId, Number(texto(fd, 'versao')));
  voltar(BASE, r, r.ok ? `Rollback concluído: nova versão v${r.valor.numero}.` : '');
}
