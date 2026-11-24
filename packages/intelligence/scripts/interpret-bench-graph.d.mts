export const CRITERIO_P95_MS: number;
export const GATILHO_ADJACENCIA_P95_ORG_MS: number;
export const GATILHO_ADJACENCIA_ARESTAS: number;
export const GATILHO_ADJACENCIA_GRAU: number;
export const MIN_ARESTAS: number;
export const RTT_MAX_PADRAO_MS: number;
export const SERIES: string[];
export function extractJson(text: string): Record<string, unknown>;
export interface Interpretation {
  valida: boolean;
  problemas: string[];
  veredito: 'invalida' | 'inconclusivo' | 'cumpre' | 'nao_cumpre';
  /** 0 cumpre (de dentro da rede); 1 não cumpre; 2 inválida; 3 inconclusiva (de fora da rede) */
  saida: 0 | 1 | 2 | 3;
  resumo: string;
  de_dentro_da_rede?: boolean;
  avisos?: string[];
  consulta_unica?: { pior_p95: number; cumpre: boolean; por_serie: Array<{ serie: string; p95: number; estimativa_mesma_rede?: number; idas: number | null }> };
  lote?: { pior_p95_lote: number; cumpre_lote: boolean; ganho_do_lote_sobre_unica_pct: number; usar: 'unica' | 'lote' | 'nenhuma' | 'indefinido'; motivo: string; por_serie: Array<{ serie: string; unica: number; lote: number; idas_lote: number | null }> } | null;
  indices?: { pior_p95_com_indices: number; ganho_pct: number; series_que_pioraram_mais_de_10_pct: string[]; reabrir_0030: boolean; motivo: string } | null;
  gatilhos_adjacencia?: string[];
  gatilhos_nao_avaliados?: string[];
  recomendacao?: { implementacao_do_produto: string; adjacencia_materializada: string; reabrir_0030: boolean | null };
  [k: string]: unknown;
}
export function interpret(report: unknown, opts?: { rttMaxMs?: number; realEdges?: number; maxDegree?: number }): Interpretation;
export function formatMarkdown(v: Interpretation): string;
