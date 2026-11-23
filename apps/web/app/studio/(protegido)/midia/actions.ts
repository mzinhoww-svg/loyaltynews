'use server';

import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/midia';
const falha = (r: Parameters<typeof mensagemErro>[0]) => ({ ok: false as const, erros: [mensagemErro(r)] });
const ESCRITA = ['admin', 'editor_chefe', 'editor'] as const;

/** Evidência da licença: referência a contrato, e-mail, página de termos ou documento (nunca o arquivo em si). */
function evidencia(fd: FormData) {
  const referencia = texto(fd, 'evidencia');
  if (!referencia) return undefined;
  const descricao = texto(fd, 'evidenciaDescricao');
  return { tipo: texto(fd, 'evidenciaTipo') || 'url', referencia, ...(descricao ? { descricao } : {}) };
}

function direitos(fd: FormData, comUrl: boolean) {
  const link = texto(fd, 'link');
  return {
    ...(comUrl ? { url: texto(fd, 'url') } : {}),
    origem: texto(fd, 'origem') || 'propria',
    credito: texto(fd, 'credito'),
    baseDeDireito: texto(fd, 'base') || 'pendente',
    textoAlternativo: texto(fd, 'alt'),
    edicoes: [],
    ...(link ? { link } : {}),
  };
}

/** Registra os metadados de um ativo hospedado fora (URL + hash do arquivo), com evidência e expiração da licença. */
export async function registrarMidiaAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA);
  const expira = texto(fd, 'expira');
  const ev = evidencia(fd);
  const r = await api.midia.criar({
    tipo: texto(fd, 'tipo') || 'imagem',
    sha256: texto(fd, 'sha256').toLowerCase(),
    direitos: direitos(fd, true),
    ...(expira ? { licencaExpiraEm: expira } : {}),
    ...(ev ? { licencaEvidencia: ev } : {}),
  });
  if (ehErro(r)) return voltar(BASE, falha(r), '');
  voltar(BASE, { ok: true }, r.body.deduplicada ? 'Já existia um ativo com este conteúdo (mesmo SHA-256): nada foi duplicado.' : 'Ativo registrado na biblioteca.');
}

/** Upload do arquivo: o Backend decide tipo e hash pelo CONTEÚDO (JPEG, PNG, GIF, WebP ou PDF) e grava no armazenamento. */
export async function enviarArquivoAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA);
  const arquivo = fd.get('arquivo');
  if (!(arquivo instanceof File) || arquivo.size === 0) return voltar(BASE, { ok: false, erros: ['Escolha um arquivo.'] }, '');
  const expira = texto(fd, 'expira');
  const ev = evidencia(fd);
  const meta = { direitos: direitos(fd, false), ...(expira ? { licencaExpiraEm: expira } : {}), ...(ev ? { licencaEvidencia: ev } : {}) };
  const form = new FormData();
  form.set('arquivo', arquivo);
  form.set('metadados', JSON.stringify(meta));
  const r = await api.midia.enviarArquivo(form);
  if (ehErro(r)) return voltar(BASE, falha(r), '');
  voltar(BASE, { ok: true }, r.body.deduplicada ? 'Arquivo já existia (mesmo conteúdo): nada foi duplicado.' : 'Arquivo enviado e registrado.');
}

/** Renovar a licença: nova data de expiração (e, opcionalmente, nova evidência). */
export async function renovarLicencaAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA);
  const expira = texto(fd, 'expira');
  if (!expira) return voltar(BASE, { ok: false, erros: ['Informe a nova data de expiração (AAAA-MM-DD).'] }, '');
  const ev = evidencia(fd);
  const r = await api.midia.atualizar(texto(fd, 'id'), { licencaExpiraEm: expira, ...(ev ? { licencaEvidencia: ev } : {}) });
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Licença atualizada.');
}

export async function removerMidiaAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe']);
  const r = await api.midia.excluir(texto(fd, 'id'));
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Ativo removido.');
}
