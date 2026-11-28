import type { ReadBudget } from '../collector/collector';
import type { EditorialStore } from '../api/store';
import { COLLECTOR_ALLOWLIST } from '../collector/allowlist';
import type { CollectorAllowlist } from '../collector/allowlist';

/**
 * Orçamento GLOBAL de leituras DP-31 (QA 2): o contador mora no banco (trilha de auditoria do EditorialStore, em PostgreSQL),
 * não na memória de cada instância do worker. Duas instâncias do worker, ou um restart, enxergam as mesmas leituras e o mesmo
 * instante da última leitura do host. Cada leitura permitida grava uma linha `collector.dp31_read` (alvo = host).
 *
 * Limite conhecido: reserve() é "ler a contagem e depois gravar"; duas instâncias que reservem no mesmo milissegundo podem passar
 * as duas. O espaçamento de 10 s e o teto de poucas páginas por dia tornam a janela irrelevante na prática; exclusão estrita
 * pediria uma linha de contador com lock/UPSERT no banco (a trilha de auditoria é somente-acréscimo).
 */
export const DP31_READ_ACTION = 'collector.dp31_read';

export class StoreReadBudget implements ReadBudget {
  constructor(private readonly store: EditorialStore) {}

  async reserve(host: string, nowMs: number, max: number, windowMs: number, spacingMs: number): Promise<{ allowed: boolean; used: number; waitMs: number }> {
    const times = (await this.store.listAudit())
      .filter((a) => a.action === DP31_READ_ACTION && a.target === host)
      .map((a) => Date.parse(a.at))
      .filter((t) => Number.isFinite(t) && nowMs - t < windowMs && t <= nowMs + 60_000)
      .sort((a, b) => a - b);
    if (times.length >= max) return { allowed: false, used: times.length, waitMs: 0 };
    const waitMs = Math.max(0, (times.at(-1) ?? -Infinity) + spacingMs - nowMs);
    await this.store.appendAudit({ at: new Date(nowMs + waitMs).toISOString(), userId: null, action: DP31_READ_ACTION, target: host });
    return { allowed: true, used: times.length + 1, waitMs };
  }
}

export const HOST_READ_ACTION = 'collector.host_read';

/**
 * Teto por hora do coletor direto, persistente: vale entre rodadas, reinícios e instâncias, porque a contagem e a gravação são
 * uma operação atômica do EditorialStore (no PostgreSQL, sob trava consultiva por host). Uma linha por requisição aprovada.
 * O espaçamento entre requisições continua por instância (Crawl-delay e intervalo mínimo no próprio coletor).
 */
export class StoreHostBudget implements ReadBudget {
  constructor(private readonly store: EditorialStore) {}

  async reserve(host: string, nowMs: number, max: number, windowMs: number): Promise<{ allowed: boolean; used: number; waitMs: number }> {
    const r = await this.store.reserveRead({ action: HOST_READ_ACTION, target: host, atMs: nowMs, max, windowMs });
    return { ...r, waitMs: 0 };
  }
}

/** O que todo coletor de worker recebe: a trava das fontes da decisão vigente e o teto por hora no banco. */
export const registeredCollectorGuards = (store: EditorialStore): { allowlist: CollectorAllowlist; hostBudget: ReadBudget } =>
  ({ allowlist: COLLECTOR_ALLOWLIST, hostBudget: new StoreHostBudget(store) });
