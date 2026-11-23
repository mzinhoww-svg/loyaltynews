'use server';

import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { PAPEIS_COMERCIAIS } from '@/lib/studio/comercial';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/crm';
const falha = (r: Parameters<typeof mensagemErro>[0]) => ({ ok: false as const, erros: [mensagemErro(r)] });

/** Lead registrado manualmente pelo comercial (contato por telefone/evento). Mesma rota e mesmas regras do formulário do mídia kit. */
export async function registrarLeadAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const whatsapp = texto(fd, 'whatsapp');
  const mensagem = texto(fd, 'mensagem');
  const r = await api.comercial.registrarLead({
    nome: texto(fd, 'nome'),
    empresa: texto(fd, 'empresa'),
    email: texto(fd, 'email'),
    ...(whatsapp ? { whatsapp } : {}),
    formatosInteresse: [],
    objetivo: texto(fd, 'objetivo'),
    ...(mensagem ? { mensagem } : {}),
    optInNewsletter: false,
  });
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Lead registrado (consentimento gravado com o horário do servidor).');
}

export async function leadAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const id = texto(fd, 'id');
  const op = texto(fd, 'op');
  if (op === 'qualificar') {
    const r = await api.comercial.qualificarLead(id);
    return voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Lead qualificado.');
  }
  if (op === 'descartar') {
    const r = await api.comercial.descartarLead(id);
    return voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Lead descartado.');
  }
  if (op === 'converter') {
    const r = await api.comercial.converterLead(id);
    return voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Lead convertido em oportunidade.');
  }
  voltar(BASE, { ok: false, erros: ['Operação desconhecida.'] }, '');
}

export async function moverEstagioAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const lostReason = texto(fd, 'motivo');
  const r = await api.comercial.moverEstagio({ opportunityId: texto(fd, 'id'), to: texto(fd, 'para'), ...(lostReason ? { lostReason } : {}) });
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Estágio atualizado.');
}

/** Anunciante direto (sem lead do mídia kit). Nome repetido ou vazio: o domínio recusa. */
export async function criarContaAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const r = await api.comercial.criarConta(texto(fd, 'nome'));
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Anunciante criado.');
}

/** Contato da conta com base legal; a data do registro e o autor são gravados pelo servidor. */
export async function adicionarContatoAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const whatsapp = texto(fd, 'whatsapp');
  const cargo = texto(fd, 'cargo');
  const r = await api.comercial.adicionarContato({
    accountId: texto(fd, 'conta'),
    name: texto(fd, 'nome'),
    email: texto(fd, 'email'),
    basis: texto(fd, 'base'),
    ...(whatsapp ? { whatsapp } : {}),
    ...(cargo ? { role: cargo } : {}),
  });
  voltar(BASE, ehErro(r) ? falha(r) : { ok: true }, 'Contato registrado (base legal, data e autor gravados no servidor).');
}
