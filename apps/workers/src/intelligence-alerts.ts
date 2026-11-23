// Geração agendada dos ALERTAS das watchlists (Entity Intelligence): quando um Move é CONFIRMADO por revisão humana, cria o alerta (pending_review) para
// cada watchlist que observa a pessoa ou a organização do Move. Antes deste job nenhum código de produção chamava `generateAlerts`.
// DESLIGADO por padrão: só roda com as DUAS chaves explícitas
//   LN_INTELLIGENCE_ALERTS=on     (este job)
//   LN_INTELLIGENCE_PESSOAS=on    (flag `intelligencePessoas`, J-01/DP-38: sem ela não há dado de pessoa em operação)
// Só Moves `confirmed` entram (detectado e rejeitado nunca geram alerta). Idempotente (UNIQUE watchlist+move + ON CONFLICT DO NOTHING): repetir o ciclo não duplica.
// Janela: só Moves detectados nos últimos LN_ALERTS_WINDOW_DAYS dias (padrão 30), para uma lista nova não despejar o histórico inteiro.
// Intervalo: LN_ALERTS_INTERVAL_MIN (padrão 15; piso 5). Logs: só contagens (nunca nome de pessoa, lista ou dono).
import { errLine } from '@ln/db/safe-log';
import { generateAlerts, type Db as IntelDb } from '@ln/intelligence';

type Env = Record<string, string | undefined>;

export interface AlertCycleResult {
  /** Moves confirmados dentro da janela que foram avaliados. */
  moves: number;
  /** Alertas CRIADOS neste ciclo (os já existentes não contam). */
  created: number;
}

/** Um ciclo: Moves confirmados na janela → alertas das watchlists que os observam. Usa só `intelligence.move` e `generateAlerts` do pacote do Data. */
export async function runAlertCycle(db: IntelDb, opts: { now?: Date; windowDays?: number } = {}): Promise<AlertCycleResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - Math.max(opts.windowDays ?? 30, 1) * 86_400_000);
  const r = await db.query<{ id: string }>(`SELECT id FROM intelligence.move WHERE status = 'confirmed' AND detected_at >= $1 ORDER BY detected_at`, [since.toISOString()]);
  const ids = r.rows.map((m) => m.id);
  if (ids.length === 0) return { moves: 0, created: 0 };
  const created = await generateAlerts(db, { moveIds: ids });
  return { moves: ids.length, created: created.length };
}

const intEnv = (v: string | undefined, def: number, min: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.max(Math.floor(n), min) : def;
};

export function startIntelligenceAlerts(opts: { db: IntelDb; env?: Env; log?: (line: string) => void; now?: () => Date }): { stop: () => void } | null {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((l: string) => console.log(l));
  if (env.LN_INTELLIGENCE_ALERTS !== 'on') return null;
  if (env.LN_INTELLIGENCE_PESSOAS !== 'on') {
    log('[intelligence-alerts] desligado: falta LN_INTELLIGENCE_PESSOAS=on (J-01)');
    return null;
  }
  const windowDays = intEnv(env.LN_ALERTS_WINDOW_DAYS, 30, 1);
  const everyMin = intEnv(env.LN_ALERTS_INTERVAL_MIN, 15, 5);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runAlertCycle(opts.db, { now: opts.now?.(), windowDays });
      log(`[intelligence-alerts] moves=${r.moves} alertas_criados=${r.created}`);
    } catch (e) {
      log(errLine('[intelligence-alerts] ciclo falhou', e));
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void tick(), 90_000);
  const timer = setInterval(() => void tick(), everyMin * 60_000);
  first.unref?.();
  timer.unref?.();
  log(`[intelligence-alerts] ligado: janela ${windowDays} d, a cada ${everyMin} min`);
  return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}
