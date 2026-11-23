// Ligação do Studio ao @ln/commercial: estado em memória (o Backend hidrata do banco) e contexto por sessão.
// Todas as regras (inventário, CRM, campanhas) ficam nos handlers do pacote; aqui só se adapta sessão, relógio e resposta.
import type { Session } from '@ln/auth';
import { createCommercialState, makeCtx, type CommercialCtx, type CommercialState } from '@ln/commercial';
import type { HttpResult } from '@ln/commercial/api';
import { hojeSP } from './agenda';
import { singleton, type Resultado } from './registros';

export const getComercialState = (): CommercialState => singleton('comercial', () => createCommercialState());

/** Flags do produto em vigor (todas desligadas por padrão; não há override no Studio). */
export function comercialCtx(session: Session): CommercialCtx {
  const podeGerir = session.roles.includes('admin') || session.roles.includes('comercial');
  return makeCtx(getComercialState(), { now: new Date().toISOString(), today: hojeSP(), actor: { id: session.userId, canManageCommercial: podeGerir } });
}

export const PAPEIS_COMERCIAIS = ['admin', 'comercial'] as const;

/** Converte a resposta HTTP-agnóstica do handler em Resultado do Studio, sem esconder o motivo da recusa. */
export function viaHandler<T>(r: HttpResult<T>): Resultado<T> {
  if (r.status < 400) return { ok: true, valor: r.body as T };
  const e = (r.body as { error?: { message?: string; details?: unknown } }).error;
  const base = e?.message ?? `Erro ${r.status}`;
  const detalhes = Array.isArray(e?.details) ? (e.details as { path?: string; message?: string }[]) : [];
  const det = detalhes.length ? ' ' + detalhes.map((d) => `${d.path ? d.path + ': ' : ''}${d.message ?? ''}`).join('; ') : '';
  return { ok: false, erros: [base + det] };
}

/** Período padrão das consultas de inventário: hoje + 30 dias. */
export function periodo30(hoje = hojeSP()): { from: string; to: string } {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  return { from: hoje, to: d.toISOString().slice(0, 10) };
}
