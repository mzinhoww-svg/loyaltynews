'use server';

import { createHash } from 'node:crypto';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { ESCRITA_EDITORIAL } from '@/lib/studio/papeis';
import { slugify } from '@/lib/studio/cms/slug';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/fontes';
const falha = (r: Parameters<typeof mensagemErro>[0]) => ({ ok: false as const, erros: [mensagemErro(r)] });

export async function criarFonteAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA_EDITORIAL);
  const nome = texto(fd, 'nome');
  const r = await api.fontes.criar({
    id: slugify(nome) || 'fonte',
    nome,
    url: texto(fd, 'url'),
    tipo: texto(fd, 'tipo') || 'site',
    editorias: fd.getAll('editorias').map(String),
    acesso: 'publico',
    termosRevisados: fd.get('termos') === 'on',
  });
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Fonte cadastrada (inativa até a ativação).');
}

export async function alterarFonteAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA_EDITORIAL);
  const id = texto(fd, 'id');
  const op = texto(fd, 'op');
  const corpo = op === 'ativar' ? { ativo: true } : op === 'desativar' ? { ativo: false } : op === 'termos' ? { termosRevisados: true } : null;
  if (!corpo) return voltar(BASE, { ok: false, erros: ['Operação desconhecida.'] }, '');
  const r = await api.fontes.atualizar(id, corpo);
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Fonte atualizada.');
}

/** Captura manual de evidência: o hash é do TEXTO capturado informado, calculado no servidor (nunca digitado). */
export async function capturarEvidenciaAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA_EDITORIAL);
  const id = texto(fd, 'id');
  const conteudo = texto(fd, 'conteudo');
  const destino = `${BASE}/${encodeURIComponent(id)}`;
  if (!conteudo) return voltar(destino, { ok: false, erros: ['Informe o texto capturado da página.'] }, '');
  const r = await api.fontes.criarEvidencia(id, { url: texto(fd, 'url'), capturadoEm: new Date().toISOString(), sha256: createHash('sha256').update(conteudo).digest('hex') });
  voltar(destino, ehErro(r) ? falha(r) : { ok: true }, 'Evidência registrada.');
}
