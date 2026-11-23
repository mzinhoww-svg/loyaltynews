/**
 * Teste REAL e MÍNIMO dos adaptadores de leitura (poucas chamadas por provedor, dentro da cota gratuita). Lê as chaves do cofre
 * do OpenBot SÓ dentro deste processo: nunca imprime, grava ou comita o valor (toda saída passa por `scrub`, que troca qualquer
 * ocorrência de segredo por ***). Não imprime nem grava TEXTO de página: só tamanho, status, créditos e tempo.
 *
 * Uso (na raiz do checkout, depois de compilar com esbuild; ver STAGING/leitores-externos.md):
 *   node node_modules/.cache/ln-intelligence/reader-live-test.mjs <etapa> [<etapa>…]
 * Etapas: bd-zone | zyte | scrapfly | apify | exa | bd-read
 * Regra de custo: no máximo 2 leituras por provedor (uma página neutra e uma página que bloqueia o nosso User-Agent).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ApifyRagBrowserReader, BrightDataUnlockerReader, ExaContentsReader, ExaDiscoverer, ScrapflyReader, ZyteReader, createReader,
  type KeyedReader, type ReadResult,
} from '../src/index';

const VAULT = process.env.LN_VAULT_DIR ?? 'C:/Users/mazin/AppData/Roaming/OpenBot/agent-api-keys/.vault/agent-2668b5a1-5627-4692-a689-8524a4d5d3ef';
const NAMES = { brightdata: 'BRIGHTDATA_API_KEY', apify: 'APIFY_API_TOKEN', scrapfly: 'SCRAPFLY_API_KEY', zyte: 'ZYTE_API_KEY', exa: 'EXA_API_KEY' } as const;
const secrets: string[] = [];

function readSecret(name: string): string | undefined {
  const f = join(VAULT, name);
  if (!existsSync(f)) return undefined;
  let v = readFileSync(f, 'utf8').trim();
  if (v.startsWith('{')) {
    try { const j = JSON.parse(v) as Record<string, unknown>; v = String(j.value ?? j.key ?? j.token ?? v); } catch { /* usa o texto */ }
  }
  if (v) secrets.push(v);
  return v || undefined;
}
/** Remove qualquer segredo de uma saída. */
const scrub = (x: unknown): string => {
  let s = typeof x === 'string' ? x : JSON.stringify(x);
  for (const sec of secrets) if (sec.length >= 6) s = s.split(sec).join('***');
  return s;
};
const out: Record<string, unknown>[] = [];
const log = (o: Record<string, unknown>) => { out.push(o); console.log(scrub(o)); };

const NEUTRAL = 'https://example.com/';
const BLOCKED = 'https://ir.latam.com/'; // respondeu HTTP 403 ao nosso User-Agent identificado em 23/11/2026

async function readWith(label: string, keyed: KeyedReader, secretName: string, urls: string[]) {
  const secret = readSecret(secretName);
  if (!secret) { log({ provedor: label, erro: 'chave ausente no cofre' }); return; }
  const reader = createReader({ keyed, keys: [{ label: 'conta-1', secretRef: 'K', monthlyCreditCap: 1_000_000 }], resolveSecret: () => secret }, { enabled: true, pace: false });
  for (const url of urls) {
    const t0 = Date.now();
    const r: ReadResult = await reader.read({ url });
    log({ provedor: label, url, ok: r.ok, falha: r.failure ?? null, httpStatusDoAlvo: r.httpStatus ?? null, creditosUsados: r.creditsUsed ?? null, caracteresDeTexto: r.text?.length ?? 0, caracteresDeHtml: r.html?.length ?? 0, resolveuCaptcha: r.providerSolvedCaptcha ?? null, ms: Date.now() - t0 });
  }
}

async function api(method: string, url: string, token: string, body?: unknown, auth: 'bearer' | 'x-api-key' = 'bearer') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth === 'bearer') headers.authorization = `Bearer ${token}`; else headers['x-api-key'] = token;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) });
  const text = await r.text();
  return { status: r.status, text };
}

const steps: Record<string, () => Promise<void>> = {
  /** Bright Data: lista zonas ativas (grátis) e, se não houver, tenta criar UMA zona de Web Unlocker. Se pedir pagamento/KYC, PARA e relata. */
  async 'bd-zone'() {
    const key = readSecret(NAMES.brightdata);
    if (!key) return log({ etapa: 'bd-zone', erro: 'chave ausente' });
    const list = await api('GET', 'https://api.brightdata.com/zone/get_active_zones', key);
    log({ etapa: 'bd-zone/listar', status: list.status, corpo: list.text.slice(0, 400) });
    let names: string[] = [];
    try { names = (JSON.parse(list.text) as { name?: string }[]).map((z) => z.name ?? '').filter(Boolean); } catch { /* sem JSON */ }
    if (names.length) return log({ etapa: 'bd-zone', zonasAtivas: names, criou: false });
    const create = await api('POST', 'https://api.brightdata.com/zone', key, { zone: { name: 'ln_unlocker' }, plan: { type: 'unblocker' } });
    log({ etapa: 'bd-zone/criar', status: create.status, corpo: create.text.slice(0, 600), nota: 'Se o corpo falar em pagamento, fundos ou KYC: PARAR e avisar o PM.' });
  },
  async zyte() {
    await readWith('zyte-http', new ZyteReader('http'), NAMES.zyte, [NEUTRAL, BLOCKED]);
  },
  async scrapfly() {
    const key = readSecret(NAMES.scrapfly);
    if (key) {
      const acc = await api('GET', `https://api.scrapfly.io/account?key=${encodeURIComponent(key)}`, key);
      let used: unknown = null;
      try { const j = JSON.parse(acc.text) as { subscription?: { usage?: { scrape?: { current?: number; limit?: number; remaining?: number } } } }; used = j.subscription?.usage?.scrape ?? null; } catch { /* ignora */ }
      log({ etapa: 'scrapfly/antes', status: acc.status, usoDeScrape: used });
    }
    await readWith('scrapfly-basic', new ScrapflyReader('basic'), NAMES.scrapfly, [NEUTRAL]);
    await readWith('scrapfly-asp', new ScrapflyReader('asp'), NAMES.scrapfly, [BLOCKED]);
    if (key) {
      const acc = await api('GET', `https://api.scrapfly.io/account?key=${encodeURIComponent(key)}`, key);
      let used: unknown = null;
      try { const j = JSON.parse(acc.text) as { subscription?: { usage?: { scrape?: { current?: number; limit?: number; remaining?: number } } } }; used = j.subscription?.usage?.scrape ?? null; } catch { /* ignora */ }
      log({ etapa: 'scrapfly/depois', status: acc.status, usoDeScrape: used });
    }
  },
  async apify() {
    await readWith('apify-rag-web-browser', new ApifyRagBrowserReader(), NAMES.apify, [NEUTRAL, BLOCKED]);
    const key = readSecret(NAMES.apify);
    if (key) {
      const runs = await api('GET', 'https://api.apify.com/v2/actor-runs?limit=3&desc=true', key);
      let resumo: unknown = null;
      try { const j = JSON.parse(runs.text) as { data?: { items?: { status?: string; usageTotalUsd?: number; actId?: string }[] } }; resumo = (j.data?.items ?? []).map((i) => ({ status: i.status, usageTotalUsd: i.usageTotalUsd ?? null })); } catch { /* ignora */ }
      log({ etapa: 'apify/consumo (últimas execuções)', status: runs.status, execucoes: resumo });
    }
  },
  async exa() {
    const key = readSecret(NAMES.exa);
    if (!key) return log({ etapa: 'exa', erro: 'chave ausente' });
    const d = new ExaDiscoverer({ keys: [{ label: 'conta-1', secretRef: 'K', monthlyCreditCap: 10_000 }], resolveSecret: () => key });
    const t0 = Date.now();
    try {
      const links = await d.discover({ host: 'ri.magazineluiza.com.br', limit: 3 });
      log({ etapa: 'exa/descoberta', links: links.length, exemplos: links.slice(0, 3).map((l) => ({ url: l.url, titulo: l.title?.slice(0, 80), publicadoEm: l.publishedAt })), creditosUsadosLocal: d.pool.report()[0]?.usedInMonth ?? null, ms: Date.now() - t0 });
    } catch (e) {
      log({ etapa: 'exa/descoberta', erro: String((e as Error).message) });
    }
    await readWith('exa-contents', new ExaContentsReader(), NAMES.exa, [NEUTRAL]);
  },
  async 'bd-read'() {
    const zone = process.env.LN_BD_ZONE ?? 'ln_unlocker';
    await readWith('brightdata-unlocker', new BrightDataUnlockerReader(zone), NAMES.brightdata, [NEUTRAL, BLOCKED]);
  },
};

const wanted = process.argv.slice(2);
if (wanted.length === 0 || wanted.some((w) => !(w in steps))) {
  console.error(`uso: reader-live-test <${Object.keys(steps).join('|')}> [...]`);
  process.exit(2);
}
for (const w of wanted) {
  try { await steps[w]!(); } catch (e) { log({ etapa: w, erro: scrub(String((e as Error).message)) }); }
}
const file = process.env.LN_LIVE_REPORT;
if (file) writeFileSync(file, scrub(JSON.stringify({ geradoEm: new Date().toISOString(), resultados: out }, null, 2)) + '\n');
