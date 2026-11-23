// Comercial no Studio: as telas chamam as rotas reais /api/commercial/** (Backend), que hidratam o estado do PostgreSQL por requisição.
// Aqui ficam só constantes e utilitários de período.
import { hojeSP } from './datas';

export const PAPEIS_COMERCIAIS = ['admin', 'comercial'] as const;

/** Período padrão das consultas de inventário: hoje + 30 dias. */
export function periodo30(hoje = hojeSP()): { from: string; to: string } {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  return { from: hoje, to: d.toISOString().slice(0, 10) };
}
