import type { Channel } from '../types';
import {
  PACKAGE_STATUSES,
  type PackageListItem,
  type PackageStatus,
  type QueueQuery,
  type QueueResult,
  type SocialPackageRecord,
} from './types';

/** Porta de persistência do dashboard. A implementação real (PostgreSQL) vem do Backend; aqui o contrato. */
export interface PackageStore {
  get(id: string): Promise<SocialPackageRecord | null>;
  put(record: SocialPackageRecord): Promise<void>;
  all(): Promise<SocialPackageRecord[]>;
}

/** Implementação em memória (testes e desenvolvimento). Guarda cópias: quem lê não altera o armazenado. */
export class InMemoryPackageStore implements PackageStore {
  private readonly rows = new Map<string, SocialPackageRecord>();

  async get(id: string): Promise<SocialPackageRecord | null> {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async put(record: SocialPackageRecord): Promise<void> {
    this.rows.set(record.id, structuredClone(record));
  }

  async all(): Promise<SocialPackageRecord[]> {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
}

export function toListItem(r: SocialPackageRecord): PackageListItem {
  if (!r.summary) return { ...r, summary: undefined };
  const { svg: _svg, ...creative } = r.summary.creative;
  void _svg;
  return { ...r, summary: { ...r.summary, creative } };
}

export function emptyStatusCounts(): Record<PackageStatus, number> {
  return Object.fromEntries(PACKAGE_STATUSES.map((s) => [s, 0])) as Record<PackageStatus, number>;
}

export function emptyChannelCounts(): Record<Channel, number> {
  return { linkedin: 0, instagram: 0, the_loyal: 0 };
}

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** Ordena por atualização (mais recente primeiro), depois por id; filtra; pagina por deslocamento. */
export function queryQueue(all: SocialPackageRecord[], q: QueueQuery): QueueResult {
  const counts = { byStatus: emptyStatusCounts(), byChannel: emptyChannelCounts() };
  for (const r of all) {
    counts.byStatus[r.status] += 1;
    counts.byChannel[r.channel] += 1;
  }
  const filtered = all
    .filter((r) => (q.channel ? r.channel === q.channel : true))
    .filter((r) => (q.status ? r.status === q.status : true))
    .filter((r) => (q.blocker ? r.blockers.includes(q.blocker) : true))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)));
  const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number.parseInt(q.cursor ?? '0', 10) || 0, 0);
  const page = filtered.slice(offset, offset + limit);
  const next = offset + limit < filtered.length ? String(offset + limit) : null;
  return { items: page.map(toListItem), total: filtered.length, nextCursor: next, counts };
}
