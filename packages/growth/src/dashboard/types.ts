import type { SocialMetrics } from '../metrics/mlabs-metrics';
import type { PublishReceipt } from '../mlabs/port';
import type { Channel } from '../types';

// Tipos do Social Dashboard (Studio). Só tipos: seguro para importar no cliente (sem node:*).
// Quando o Chief Architect publicar um contrato `SocialPackage` em @ln/contracts, estes tipos migram para lá.

export const PACKAGE_STATUSES = ['gerado', 'bloqueado', 'simulado', 'recusado', 'falhou'] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export interface CreativeSummary {
  format: string;
  width: number;
  height: number;
  sha256: string;
  brandStatus: string;
  contextKey: string;
  /** SVG completo: só em `getPackage`; ausente nas listagens. */
  svg?: string;
}

export interface PackageSummary {
  title: string;
  editoria: string;
  /** Texto final do post (legenda no Instagram). */
  copyText: string;
  hook: string;
  hashtags: string[];
  /** Menções com identidade verificada (marcáveis). */
  mentions: { name: string }[];
  /** Entidades citadas só em texto puro. */
  plainEntities: string[];
  textOnlyFallback: boolean;
  creative: CreativeSummary;
  carouselSlides: number;
  imageRef: string;
}

export interface SocialPackageRecord {
  /** `${articleId}:${channel}:v${version}` */
  id: string;
  articleId: string;
  channel: Channel;
  version: number;
  status: PackageStatus;
  createdAt: string;
  updatedAt: string;
  /** Todos os bloqueios (inclui os que só valem para publicação real). */
  blockers: string[];
  /** Falha de geração: regras violadas (copy/criativo). Sem `summary`. */
  failure?: { rules: string[]; detail: string };
  summary?: PackageSummary;
  /** Recibos de publicação SIMULADA. Nenhum recibo aqui é de publicação real. */
  receipts: PublishReceipt[];
  /** Motivo da última recusa do publisher, se houve. */
  lastRefusal?: string;
  mock: boolean;
}

export interface PackageListItem extends Omit<SocialPackageRecord, 'summary'> {
  summary?: Omit<PackageSummary, 'creative'> & { creative: Omit<CreativeSummary, 'svg'> };
}

export interface QueueQuery {
  channel?: Channel;
  status?: PackageStatus;
  /** Filtra pacotes que têm este bloqueio. */
  blocker?: string;
  limit?: number;
  cursor?: string;
}

export interface QueueResult {
  items: PackageListItem[];
  total: number;
  nextCursor: string | null;
  counts: { byStatus: Record<PackageStatus, number>; byChannel: Record<Channel, number> };
}

export interface DashboardSummary {
  totals: { packages: number; byStatus: Record<PackageStatus, number>; byChannel: Record<Channel, number> };
  channels: { channel: Channel; flagEnabled: boolean; mode: 'simulado' | 'real' }[];
  topBlockers: { blocker: string; count: number }[];
  brandStatus: string;
  /** Sem fonte de métricas (ou leitura falhou): estado vazio honesto, nunca números fictícios. Com fonte: leitura do mLabs (só leitura). */
  metrics: { available: false; reason: string } | { available: true; data: SocialMetrics };
  note: string;
}

export interface ReceiptRow {
  packageId: string;
  articleId: string;
  channel: Channel;
  receipt: PublishReceipt;
}
