// Coleta contínua, fase 1, SEM modelo: a cada intervalo, lê as fontes HABILITADAS no Studio e grava os itens novos na caixa de
// pautas (registro editorial sem rascunho). Temporizador próprio do processo, como as retenções: a fila `coleta` segue desligada.
// Só liga com a flag `editorialCollector` do resolvedor (ADR-022: decisão registrada; em produção, só por commit). Sem provedor de
// leitura: fontes "via provedor" não são lidas e nada tarifado é chamado. Nada é redigido, aprovado ou publicado.
// Parar: desabilitar as fontes no Studio (vale antes da próxima fonte); a flag é lida só na subida do processo.
import type { Db } from '@ln/auth';
import type { FlagName } from '@ln/contracts';
import { Collector, SEED_SOURCES, SourceRegistry, collectToInbox, createNodeFetcher, describeRound, type EditorialStore, type InboxRound } from '@ln/editorial';
import { PgEditorialStore } from './editorial-store';

export const COLLECTOR_INTERVAL_MS = 2 * 3_600_000;
/** Espera depois da subida: o contador de ritmo por site vive em memória, e reinícios seguidos não podem virar rajada. */
export const COLLECTOR_FIRST_DELAY_MS = 5 * 60_000;
export const COLLECTOR_LIMIT_PER_SOURCE = 5;

export interface EditorialCollectorOptions {
  db: Db;
  flags: (f: FlagName) => boolean;
  intervalMs?: number;
  firstDelayMs?: number;
  /** Só para teste: o padrão é o coletor real (robots.txt, intervalo e limite por site), uma instância por processo. */
  collector?: Collector;
  registry?: SourceRegistry;
  store?: EditorialStore;
  now?: () => Date;
  onResult?: (r: InboxRound) => void;
  onError?: (e: unknown) => void;
}

/** Linha de log de uma rodada (só ids de fonte e contagens). */
export const roundLogLine = (r: InboxRound): string => (r.sources.length ? describeRound(r) : 'nenhuma fonte habilitada');

export function startEditorialCollector(o: EditorialCollectorOptions): { stop(): void; tick(): Promise<void> } | null {
  if (!o.flags('editorialCollector')) return null;
  const store = o.store ?? new PgEditorialStore(o.db);
  const registry = o.registry ?? new SourceRegistry(SEED_SOURCES);
  const collector = o.collector ?? new Collector(createNodeFetcher(), { flags: { editorialCollector: true } });
  let running = false;
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  const tick = async (): Promise<void> => {
    if (running || stopped) return; // rodada anterior ainda em curso: não sobrepõe
    running = true;
    try {
      const r = await collectToInbox(
        { store, registry, collector, flags: { editorialCollector: true }, ...(o.now ? { now: o.now } : {}) },
        { limitPerSource: COLLECTOR_LIMIT_PER_SOURCE },
      );
      o.onResult?.(r);
    } catch (e) {
      o.onError?.(e);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), o.intervalMs ?? COLLECTOR_INTERVAL_MS);
  }, o.firstDelayMs ?? COLLECTOR_FIRST_DELAY_MS);
  return {
    tick,
    stop() {
      stopped = true;
      clearTimeout(first);
      if (interval) clearInterval(interval);
    },
  };
}
