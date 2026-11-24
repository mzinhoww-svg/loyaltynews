import { FLAG_RELEASES, flagEnvFrom, type FlagEnv } from '@ln/contracts';
// Comercial no Studio: as telas chamam as rotas reais /api/commercial/** (Backend), que hidratam o estado do PostgreSQL por requisição.
// Aqui ficam só constantes e utilitários de período.
import { hojeSP } from './datas';

export const PAPEIS_COMERCIAIS = ['admin', 'comercial'] as const;
/** DP-43 (proprietário, 23/11): aprovar cada imagem (criativo) e cada campanha é do proprietário, o papel admin. O comercial prepara e envia. */
export const PAPEIS_APROVACAO = ['admin'] as const;

/**
 * DP-43 por ambiente: venda, aprovação e ativação no Studio só onde o proprietário liberou a venda (FLAG_RELEASES.adServerVendas, o mesmo
 * registro da flag e do CAPACITY_RELEASES). Hoje: staging = 'DP-43'; produção = null (só no go-live, com nova decisão). Ambiente desconhecido,
 * local ou CI: desligado. Quando a decisão de produção for preenchida, as telas acompanham sem mudar código aqui.
 */
export function vendaLiberadaNoAmbiente(appEnv: string | undefined = process.env.APP_ENV): boolean {
  const amb = flagEnvFrom(appEnv);
  if (!amb) return false;
  const decisao = (FLAG_RELEASES as Partial<Record<string, Partial<Record<FlagEnv, string | null>>>>).adServerVendas?.[amb];
  return typeof decisao === 'string' && decisao.length > 0;
}
export const AVISO_VENDA_DESLIGADA = 'Venda, aprovação e ativação desligadas neste ambiente (DP-43: só no staging até a decisão do go-live).';
export const podeAprovar = (roles: readonly string[]): boolean => roles.some((r) => (PAPEIS_APROVACAO as readonly string[]).includes(r));

/** Período padrão das consultas de inventário: hoje + 30 dias. */
export function periodo30(hoje = hojeSP()): { from: string; to: string } {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  return { from: hoje, to: d.toISOString().slice(0, 10) };
}
