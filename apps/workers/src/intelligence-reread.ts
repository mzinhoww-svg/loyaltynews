// Releitura agendada das páginas OFICIAIS de diretoria (Entity Intelligence). DESLIGADA por padrão: só roda com as DUAS chaves explícitas
//   LN_INTELLIGENCE_REREAD=on     (este job)
//   LN_INTELLIGENCE_PESSOAS=on    (ingestão de pessoas = flag `intelligencePessoas`, J-01; sem a decisão registrada, não liga)
// e com LN_REREAD_SEED apontando o conjunto de cargos (seed.public.v5.json) que o job relê. Chave do provedor (opcional, só se a leitura
// direta recusar): ZYTE_API_KEY no ambiente (nunca em log). Intervalo por página: LN_REREAD_INTERVAL_HOURS (padrão 168; piso 24).
// Logs: só contagens e motivos (nunca texto de página, nunca segredo). Lógica e testes: packages/intelligence/src/reread.ts.
import { readFileSync } from 'node:fs';
import {
  DEFAULT_REREAD_CONFIG, ZyteReader, createDirectPageReader, createReader, rereadSourcesFromSeed, runRereadCycle, validateSeed,
  type Db as IntelDb, type PageReader, type SeedDataset,
} from '@ln/intelligence';

type Env = Record<string, string | undefined>;
const TICK_MS = 6 * 3_600_000;

export function startIntelligenceReread(opts: { db: IntelDb; env?: Env; log?: (line: string) => void }): { stop: () => void } | null {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((l: string) => console.log(l));
  if (env.LN_INTELLIGENCE_REREAD !== 'on') return null;
  if (env.LN_INTELLIGENCE_PESSOAS !== 'on') {
    log('[intelligence-reread] desligado: falta LN_INTELLIGENCE_PESSOAS=on (J-01)');
    return null;
  }
  const seedPath = env.LN_REREAD_SEED;
  if (!seedPath) {
    log('[intelligence-reread] desligado: LN_REREAD_SEED ausente');
    return null;
  }
  const ds = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedDataset;
  const issues = validateSeed(ds);
  if (issues.length) {
    log(`[intelligence-reread] desligado: conjunto inválido (${issues.length} problemas)`);
    return null;
  }
  const sources = rereadSourcesFromSeed(ds);
  const key = env.ZYTE_API_KEY;
  const fallback: PageReader | undefined = key
    ? async (url) => {
        const r = await createReader({ keyed: new ZyteReader('http'), keys: [{ label: 'conta-1', secretRef: 'K', monthlyCreditCap: 50_000 }], resolveSecret: () => key }, { enabled: true }).read({ url });
        return r.ok ? { ok: true, text: r.text, finalUrl: r.finalUrl ?? url } : { ok: false, failure: r.failure ?? 'falha' };
      }
    : undefined;
  const read = createDirectPageReader({ fallback });
  const intervalHours = Math.max(Number(env.LN_REREAD_INTERVAL_HOURS) || DEFAULT_REREAD_CONFIG.intervalHours, 24);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runRereadCycle(opts.db, sources, { read, cfg: { personIngestion: true, extendedPersonalData: false }, config: { enabled: true, intervalHours } });
      const by = (s: string) => r.pages.filter((p) => p.status === s).length;
      log(`[intelligence-reread] páginas=${r.pages.length} alteradas=${by('changed')} revisar=${by('review')} suspeitas=${by('page_suspect')} falhas=${by('read_failed')} moves=${r.moves}`);
    } catch (e) {
      log(`[intelligence-reread] ciclo falhou: ${e instanceof Error ? e.message.slice(0, 120) : 'erro'}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void tick(), 60_000);
  const timer = setInterval(() => void tick(), TICK_MS);
  first.unref?.();
  timer.unref?.();
  log(`[intelligence-reread] ligado: ${sources.length} páginas, intervalo ${intervalHours} h por página`);
  return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}
