'use server';

import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/agenda';
const falha = (r: Parameters<typeof mensagemErro>[0]) => ({ ok: false as const, erros: [mensagemErro(r)] });

export async function criarEventoAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe', 'editor']);
  const url = texto(fd, 'url');
  const r = await api.agenda.criar({
    titulo: texto(fd, 'titulo'),
    inicio: texto(fd, 'inicio'),
    fim: texto(fd, 'fim') || texto(fd, 'inicio'),
    local: texto(fd, 'local'),
    ...(url ? { url } : {}),
    editorias: fd.getAll('editorias').map(String),
    patrocinado: fd.get('patrocinado') === 'on',
    fonteUrl: texto(fd, 'fonteUrl'),
  });
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Evento criado.');
}

export async function removerEventoAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe']);
  const r = await api.agenda.excluir(texto(fd, 'id'));
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Evento removido.');
}

/** Moderação (editor-chefe e admin): aprovar publica no portal; rejeitar exige motivo e fica auditado. */
export async function moderarEventoAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe']);
  const estado = texto(fd, 'estado') === 'aprovado' ? 'aprovado' : 'rejeitado';
  const motivo = texto(fd, 'motivo');
  const r = await api.agenda.moderar(texto(fd, 'id'), { estado, ...(motivo ? { motivo } : {}) });
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, estado === 'aprovado' ? 'Evento aprovado.' : 'Evento rejeitado.');
}
