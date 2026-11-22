export type FormatStatus = 'ativo' | 'sob_consulta' | 'indisponivel';
export type PriceType = 'fixo' | 'a_partir_de' | 'verba_mais_taxa';
export type PriceUnit = 'mes' | 'dia' | 'unidade' | 'verba';

export interface FormatSeed {
  id: string; n: number; section: string; name: string;
  referenceText: string; scope: string;
  priceType: PriceType; fromBRL: number | null; unit: PriceUnit; feePct: number | null;
  sourceLine: number;
}
export interface CommercialFormat extends FormatSeed {
  status: FormatStatus;
  /** Motivo do estado; obrigatório quando não é 'ativo'. */
  statusReason: string;
  /** Preço é referência comercial, ajustável no admin; não é promessa de audiência. */
  isReferencePrice: true;
}

export type Iso = string; // ISO-8601 com offset
export type MetricStatus = 'available' | 'unavailable' | 'stale';
export interface MetricRecord {
  source: string; metric: string; value: number | null;
  period_start: Iso | null; period_end: Iso | null; fetched_at: Iso | null;
  status: MetricStatus; methodology_version: string;
}
