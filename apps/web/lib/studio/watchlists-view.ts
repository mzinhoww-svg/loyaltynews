// Watchlists e alertas no Studio (Studio 2): tipos do que /api/studio/intelligence/watchlists|alerts devolvem (WATCHLISTS_API.md)
// e regras de exibição. Funções puras, testadas em watchlists-view.test.ts.
import type { MoveLinha } from './intelligence-view';

export interface WatchlistLinha {
  id: string;
  name: string;
  owner_ref: string;
  items: number;
  pending_alerts: number;
}
export interface WatchlistItem {
  entity_type: 'organization' | 'person';
  entity_id: string;
  name: string;
}
export type EstadoAlerta = 'pending_review' | 'approved' | 'rejected';
export interface AlertaLinha {
  id: string;
  watchlist_id: string;
  move_id: string;
  status: EstadoAlerta;
  kind: MoveLinha['kind'];
  person_name: string;
  basis: MoveLinha['basis'];
  evidence_id: string;
  observed_on: string;
  reviewed_by: string | null;
  /** null quando o Move saiu da consulta (pessoa suprimida): a tela mostra "indisponível". */
  move: MoveLinha | null;
}

export const ROTULO_ALERTA: Record<EstadoAlerta, string> = {
  pending_review: 'Pendente de revisão',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};
export const ROTULO_ESTADO_MOVE: Record<MoveLinha['status'], string> = {
  detected: 'Move detectado (não confirmado)',
  confirmed: 'Move confirmado',
  rejected: 'Move rejeitado',
};
export const ROTULO_ENTIDADE: Record<WatchlistItem['entity_type'], string> = { organization: 'Empresa', person: 'Executivo' };

/** Estado do alerta vindo da query (?estado=): só os três válidos; o resto vira "pending_review". */
export function estadoDoFiltro(v: string | undefined): EstadoAlerta {
  return v === 'approved' || v === 'rejected' ? v : 'pending_review';
}

/** Tipo de entidade vindo do formulário: só os dois que o Backend aceita; outro valor volta null (a action recusa sem chamar a rota). */
export function tipoDeEntidade(v: string): WatchlistItem['entity_type'] | null {
  return v === 'organization' || v === 'person' ? v : null;
}

/** Nome da watchlist como o Backend valida (1 a 120 caracteres, sem espaços nas pontas). Devolve a mensagem de erro ou null. */
export function erroDoNome(nome: string): string | null {
  const n = nome.trim();
  if (!n) return 'Dê um nome à watchlist.';
  if (n.length > 120) return 'O nome tem no máximo 120 caracteres.';
  return null;
}
