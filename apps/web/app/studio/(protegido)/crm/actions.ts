'use server';

import { convertLead, discardLead, moveOpportunityStage, qualifyLead, submitLead } from '@ln/commercial/api';
import { comercialCtx, PAPEIS_COMERCIAIS, viaHandler } from '@/lib/studio/comercial';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/crm';

/** Lead registrado manualmente pelo comercial (contato por telefone/evento). Mesmo handler e mesmas regras do formulário do mídia kit. */
export async function registrarLeadAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(PAPEIS_COMERCIAIS);
  const whatsapp = texto(fd, 'whatsapp');
  const mensagem = texto(fd, 'mensagem');
  const r = submitLead(comercialCtx(session), {
    nome: texto(fd, 'nome'),
    empresa: texto(fd, 'empresa'),
    email: texto(fd, 'email'),
    ...(whatsapp ? { whatsapp } : {}),
    formatosInteresse: [],
    objetivo: texto(fd, 'objetivo'),
    ...(mensagem ? { mensagem } : {}),
    optInNewsletter: false,
  });
  voltar(BASE, viaHandler(r), 'Lead registrado (consentimento gravado com o horário do servidor).');
}

export async function leadAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(PAPEIS_COMERCIAIS);
  const ctx = comercialCtx(session);
  const leadId = texto(fd, 'id');
  const op = texto(fd, 'op');
  if (op === 'qualificar') return voltar(BASE, viaHandler(qualifyLead(ctx, { leadId })), 'Lead qualificado.');
  if (op === 'descartar') return voltar(BASE, viaHandler(discardLead(ctx, { leadId })), 'Lead descartado.');
  if (op === 'converter') return voltar(BASE, viaHandler(convertLead(ctx, { leadId })), 'Lead convertido em oportunidade.');
  voltar(BASE, { ok: false, erros: ['Operação desconhecida.'] }, '');
}

export async function moverEstagioAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(PAPEIS_COMERCIAIS);
  const lostReason = texto(fd, 'motivo');
  const r = moveOpportunityStage(comercialCtx(session), { opportunityId: texto(fd, 'id'), to: texto(fd, 'para') as 'qualificado', ...(lostReason ? { lostReason } : {}) });
  voltar(BASE, viaHandler(r), 'Estágio atualizado.');
}
