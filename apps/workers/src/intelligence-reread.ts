// Releitura agendada das páginas OFICIAIS de diretoria (Entity Intelligence). DESLIGADA por padrão: só roda com
//   LN_INTELLIGENCE_REREAD=on      (chave operacional deste job)
//   flag `intelligencePessoas`      (J-01; pelo RESOLVEDOR de flags, ADR-022: `opts.flags`; sem resolvedor, desligada)
// e com LN_REREAD_SEED apontando o conjunto de cargos (seed.public.v5/v7.json) que o job relê. A leitura por provedor (reserva, só se a direta
// recusar) usa a Bright Data do staging (DP-36) e SÓ liga pela flag `leitorViaProvedor` do mesmo resolvedor (ADR-022, adendo 2); a chave vem
// de BRIGHTDATA_API_KEY no ambiente (nunca em log). Nenhuma flag de produto é lida de variável de ambiente própria.
// Intervalo por página: LN_REREAD_INTERVAL_HOURS (padrão 168; piso 24).
// Logs: só contagens e motivos (nunca texto de página, nunca segredo). Lógica e testes: packages/intelligence/src/reread.ts.
import { readFileSync } from 'node:fs';
import {
  DEFAULT_REREAD_CONFIG, createBrightDataStagingReader, createDirectPageReader, rereadSourcesFromSeed, runRereadCycle, validateSeed,
  type Db as IntelDb, type PageReader, type SeedDataset,
} from '@ln/intelligence';

type Env = Record<string, string | undefined>;
const TICK_MS = 6 * 3_600_000;

/** Resolvedor de flags do app (ex.: `(f) => isEnabled(f, runtimeFlags())`, ADR-022). Sem ele, toda flag está desligada. */
export type FlagResolver = (flag: 'intelligencePessoas' | 'leitorViaProvedor') => boolean;
const NO_FLAGS: FlagResolver = () => false;

export function startIntelligenceReread(opts: { db: IntelDb; env?: Env; flags?: FlagResolver; log?: (line: string) => void }): { stop: () => void } | null {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((l: string) => console.log(l));
  const flags = opts.flags ?? NO_FLAGS;
  const flagOn = (f: Parameters<FlagResolver>[0]) => { try { return flags(f) === true; } catch { return false; } }; // falha fechada
  if (env.LN_INTELLIGENCE_REREAD !== 'on') return null;
  if (!flagOn('intelligencePessoas')) {
    log('[intelligence-reread] desligado: flag intelligencePessoas desligada (J-01; ADR-022)');
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
  // reserva por provedor: Bright Data do staging (uma conta, sem troca), ligada SÓ pela flag leitorViaProvedor (consultada a cada leitura)
  const provider = createBrightDataStagingReader((ref) => env[ref], (f) => flagOn(f));
  const fallback: PageReader = async (url) => {
    const r = await provider.read({ url });
    return r.ok ? { ok: true, text: r.text, finalUrl: r.finalUrl ?? url } : { ok: false, failure: r.failure ?? 'falha' };
  };
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
