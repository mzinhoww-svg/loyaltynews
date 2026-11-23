'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { retornoSeguro } from '@/lib/studio/site-docs';
import { requireStudio } from '../_lib/guard';

const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');

function volta(fd: FormData, ok: boolean, msg: string): never {
  const base = retornoSeguro(t(fd, 'retorno'), '/studio');
  const sep = base.includes('?') ? '&' : '?';
  return redirect(`${base}${sep}tipoMsg=${ok ? 'ok' : 'err'}&aviso=${encodeURIComponent(msg)}`);
}

const PUBLICA = ['admin', 'editor_chefe'] as const;

/** Publicar o rascunho agora, ou agendar (data/hora local de Brasília). O Backend recusa pendências (matéria fixada fora do ar, posição sem dimensão). */
export async function publicarDocAction(fd: FormData): Promise<void> {
  await requireStudio(PUBLICA);
  const quando = t(fd, 'agendarPara');
  const iso = quando ? `${quando.length === 16 ? `${quando}:00` : quando}-03:00` : undefined;
  const r = await api.site.publicar(t(fd, 'tipo'), iso);
  volta(fd, !ehErro(r), ehErro(r) ? mensagemErro(r) : iso ? 'Publicação agendada.' : 'Documento publicado.');
}

export async function cancelarAgendamentoAction(fd: FormData): Promise<void> {
  await requireStudio(PUBLICA);
  const r = await api.site.cancelarAgendamento(t(fd, 'tipo'));
  volta(fd, !ehErro(r), ehErro(r) ? mensagemErro(r) : 'Agendamento cancelado: o conteúdo voltou a rascunho.');
}

/** Rollback = NOVA versão com o conteúdo de uma anterior (o histórico não é reescrito). */
export async function rollbackDocAction(fd: FormData): Promise<void> {
  await requireStudio(PUBLICA);
  const r = await api.site.rollback(t(fd, 'tipo'), Number(t(fd, 'versao')));
  volta(fd, !ehErro(r), ehErro(r) ? mensagemErro(r) : `Rollback concluído: nova versão com o conteúdo da v${t(fd, 'versao')}.`);
}
