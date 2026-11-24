// Comercial no Studio: as telas chamam as rotas reais /api/commercial/** (Backend), que hidratam o estado do PostgreSQL por requisição.
// Aqui ficam só constantes e utilitários de período.
import { hojeSP } from './datas';

export const PAPEIS_COMERCIAIS = ['admin', 'comercial'] as const;
/** DP-43 (proprietário, 23/11): aprovar cada imagem (criativo) e cada campanha é do proprietário, o papel admin. O comercial prepara e envia. */
export const PAPEIS_APROVACAO = ['admin'] as const;
export const podeAprovar = (roles: readonly string[]): boolean => roles.some((r) => (PAPEIS_APROVACAO as readonly string[]).includes(r));

/** Período padrão das consultas de inventário: hoje + 30 dias. */
export function periodo30(hoje = hojeSP()): { from: string; to: string } {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  return { from: hoje, to: d.toISOString().slice(0, 10) };
}
