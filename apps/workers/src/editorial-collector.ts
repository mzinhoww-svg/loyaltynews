// Coleta contínua, fase 1, SEM modelo: a cada intervalo, lê as fontes HABILITADAS no Studio e grava os itens novos na caixa de
// pautas (registro editorial sem rascunho). Temporizador próprio do processo, como as retenções: a fila `coleta` segue desligada.
// Só liga com a flag `editorialCollector` do resolvedor (ADR-022: decisão registrada; em produção, só por commit). Sem provedor de
// leitura: fontes "via provedor" não são lidas e nada tarifado é chamado. Nada é redigido, aprovado ou publicado.
// Parar: desabilitar as fontes no Studio (vale antes da próxima fonte); a flag é lida só na subida do processo.
// Aviso (DP-94, condição 4): um vigia com temporizador próprio, que também cobre rodada travada, registra no log e na trilha quando
// passam 5 h sem rodada boa. Ele vive neste processo: com o worker parado ou a flag desligada NÃO avisa; isso pede vigia externo.
import type { Db } from '@ln/auth';
import type { FlagName } from '@ln/contracts';
import {
  COLLECTOR_ALERT_ACTION, COLLECTOR_ROUND_ACTION, Collector, GOOD_ROUND_PREFIX, SEED_SOURCES, SourceRegistry, collectToInbox, createNodeFetcher, describeRound, isGoodRound,
  type EditorialStore, type InboxRound,
} from '@ln/editorial';
import { PgEditorialStore } from './editorial-store';

export const COLLECTOR_INTERVAL_MS = 2 * 3_600_000;
/** Espera depois da subida: o contador de ritmo por site vive em memória, e reinícios seguidos não podem virar rajada. */
export const COLLECTOR_FIRST_DELAY_MS = 5 * 60_000;
export const COLLECTOR_LIMIT_PER_SOURCE = 5;
/** Prazo da "rodada boa", decidido pelo PM: sem nenhuma em mais de 5 h, avisa; persistindo, repete a cada 5 h. */
export const COLLECTOR_STALE_AFTER_MS = 5 * 3_600_000;
export const COLLECTOR_WATCH_INTERVAL_MS = 15 * 60_000;

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
  watchIntervalMs?: number;
  /** Recebe a linha do aviso (a mesma que vai para a trilha). */
  onAlert?: (line: string) => void;
}

/** Linha de log de uma rodada (só ids de fonte e contagens). */
export const roundLogLine = (r: InboxRound): string => (r.sources.length ? describeRound(r) : 'nenhuma fonte habilitada');

export function startEditorialCollector(o: EditorialCollectorOptions): { stop(): void; tick(): Promise<void>; check(): Promise<void> } | null {
  if (!o.flags('editorialCollector')) return null;
  const store = o.store ?? new PgEditorialStore(o.db);
  const registry = o.registry ?? new SourceRegistry(SEED_SOURCES);
  const collector = o.collector ?? new Collector(createNodeFetcher(), { flags: { editorialCollector: true } });
  let running = false;
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  const now = o.now ?? (() => new Date());
  const startedAt = now().getTime();
  let lastGood: number | null = null;
  let lastAlert: number | null = null;
  /** Primeiro registro da coleta na trilha: é o marco quando nunca houve rodada boa, para reinícios não zerarem o prazo. */
  let firstSeen: number | null = null;
  let seeded = false;
  let checking = false;
  const seed = async (): Promise<void> => {
    for (const a of await store.listAudit()) {
      if (!a.action.startsWith('collector.')) continue;
      const at = Date.parse(a.at);
      firstSeen = Math.min(firstSeen ?? at, at);
      if (a.action === COLLECTOR_ROUND_ACTION && a.detail?.startsWith(GOOD_ROUND_PREFIX)) lastGood = Math.max(lastGood ?? at, at);
      if (a.action === COLLECTOR_ALERT_ACTION) lastAlert = Math.max(lastAlert ?? at, at);
    }
    seeded = true;
  };
  const check = async (): Promise<void> => {
    if (checking || stopped) return;
    checking = true;
    try {
      // sem a trilha, conta desde o que este processo sabe e tenta ler de novo na próxima vez
      if (!seeded) await seed().catch((e: unknown) => o.onError?.(e));
      const t = now().getTime();
      const since = lastGood ?? firstSeen ?? startedAt;
      if (t - since <= COLLECTOR_STALE_AFTER_MS) return;
      if (lastAlert !== null && lastAlert >= since && t - lastAlert < COLLECTOR_STALE_AFTER_MS) return;
      lastAlert = t;
      const line = `sem rodada boa há mais de ${Math.floor((t - since) / 3_600_000)} h (prazo 5 h); última boa: ${lastGood === null ? 'nenhuma registrada' : new Date(lastGood).toISOString()}`;
      o.onAlert?.(line); // primeiro o log: o aviso não depende de o banco estar de pé
      await store.appendAudit({ at: new Date(t).toISOString(), userId: null, action: COLLECTOR_ALERT_ACTION, target: 'collector', detail: line });
    } catch (e) {
      o.onError?.(e);
    } finally {
      checking = false;
    }
  };
  const tick = async (): Promise<void> => {
    if (running || stopped) return; // rodada anterior ainda em curso: não sobrepõe
    running = true;
    try {
      const r = await collectToInbox(
        { store, registry, collector, flags: { editorialCollector: true }, ...(o.now ? { now: o.now } : {}) },
        { limitPerSource: COLLECTOR_LIMIT_PER_SOURCE },
      );
      if (isGoodRound(r)) lastGood = Math.max(lastGood ?? 0, Date.parse(r.finishedAt));
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
  const watch = setInterval(() => void check(), o.watchIntervalMs ?? COLLECTOR_WATCH_INTERVAL_MS);
  return {
    tick,
    check,
    stop() {
      stopped = true;
      clearTimeout(first);
      clearInterval(watch);
      if (interval) clearInterval(interval);
    },
  };
}
