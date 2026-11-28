/**
 * Analisa data/runs/<runId>/attempts.jsonl: métricas por provedor, ranking global/por categoria, matriz por domínio,
 * pipeline combinado (melhor provedor por URL, em ordem de custo), projeções mensais. Saída: report.json e report.md.
 * Uso: npx tsx packages/scraping-benchmark/scripts/analyze.ts <runId>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeMetrics, rank, projectMonthly, type ProviderMetrics } from '../src/metrics.ts';
import { AdaptiveRouter } from '../src/router.ts';
import { rejudgeRecord } from '../src/quality.ts';
const CRITERION = (process.argv[3] ?? 'v2') as 'v1' | 'v2'; // v1 = vereditos gravados (histórico); v2 = regra estrita reaplicada
import type { AttemptRecord, DatasetEntry } from '../src/types.ts';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2] ?? 'run-20261123-01';
const dir = join(PKG, 'data', 'runs', runId);
const recs: AttemptRecord[] = readFileSync(join(dir, 'attempts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ds: DatasetEntry[] = JSON.parse(readFileSync(join(PKG, 'data', 'dataset.json'), 'utf8'));
const byId = new Map(ds.map((d) => [d.id, d]));
const PRICE: Record<string, number> = { 'firecrawl-scrape': 19 / 5000 };
// só URLs do dataset vigente (v1.1 substituiu 6 entradas; as tentativas antigas ficam no JSONL, fora da análise)
const real = recs
  .filter((r) => !r.mock && byId.has(r.urlId) && r.errorClass !== 'budget_blocked' && r.errorClass !== 'billing_unconfirmed' && r.errorClass !== 'disabled' && r.errorClass !== 'source_refused')
  // registros anteriores à classe 'title_mismatch' (texto longo, título divergente) foram gravados como 'empty_content'
  // custo recalculado pelo preço de referência vigente (o Firecrawl foi gravado com 16/3000; oficial Hobby mensal = 19/5000)
  // registros gravados antes da correção marcavam fonte correta sem URL final: sem URL final = não verificável
  .map((r) => (r.finalUrl ? r : { ...r, sourceMatch: undefined }))
  .map((r) => (PRICE[r.provider] !== undefined ? { ...r, costEstimatedUsd: +(r.creditsUsed * PRICE[r.provider]!).toFixed(6) } : r))
  .map((r) => (CRITERION === 'v2' ? rejudgeRecord(r, byId.get(r.urlId)!.referenceTitle) : r))
  .map((r) => (r.errorClass === 'empty_content' && r.technicalSuccess && r.textLength >= 600 && (r.titleMatch ?? 0) < 0.5 ? { ...r, errorClass: 'title_mismatch' as const } : r));
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);

const refDates = new Map(ds.map((d) => [d.id, d.publishedAt] as [string, string | null]));
const metrics = computeMetrics(real, { referenceDates: refDates });
const ranking = rank(metrics);

// por categoria e por recência
const groups = (key: (d: DatasetEntry) => string) => {
  const out: Record<string, ProviderMetrics[]> = {};
  const keys = [...new Set(ds.map(key))];
  for (const k of keys) out[k] = computeMetrics(real.filter((r) => key(byId.get(r.urlId)!) === k), { referenceDates: refDates });
  return out;
};
const byCategory = groups((d) => d.category);
const byRecency = groups((d) => d.recency);

// matriz por domínio: taxa editorial por provedor
const domains = [...new Set(ds.map((d) => d.domain))].sort();
const providers = [...new Set(real.map((r) => r.provider))].sort();
const domainMatrix = domains.map((dom) => {
  const row: Record<string, string> = { domain: dom };
  for (const p of providers) {
    const rs = real.filter((r) => r.domain === dom && r.provider === p && r.errorClass !== 'budget_blocked' && r.errorClass !== 'disabled' && r.errorClass !== 'source_refused');
    row[p] = rs.length ? `${rs.filter((r) => r.editorialSuccess).length}/${rs.length}` : '—';
  }
  return row;
});

// roteador semeado com a estatística real → ordem recomendada por domínio
const usd = Object.fromEntries(metrics.map((m) => [m.provider, m.creditsUsed ? m.costEstimatedUsd / m.creditsUsed : 0]));
const router = new AdaptiveRouter(providers.map((p) => ({ name: p, reader: { provider: p, read: async () => ({ ok: false, url: '', provider: p }) }, worstCaseCredits: 1, usdPerCredit: usd[p] ?? 0 })));
for (const dom of domains)
  for (const p of providers) {
    const rs = real.filter((r) => r.domain === dom && r.provider === p && r.errorClass !== 'budget_blocked' && r.errorClass !== 'disabled' && r.errorClass !== 'source_refused');
    if (rs.length) router.seed(dom, p, { attempts: rs.length, valid: rs.filter((r) => r.editorialSuccess).length, credits: rs.reduce((a, r) => a + r.creditsUsed, 0) });
  }
const routingMatrix = router.matrix(domains).map((m) => ({ domain: m.domain, order: m.order.slice(0, 3) }));

// pipeline combinado: para cada URL, há algum provedor com sucesso técnico/editorial? (elegível = sem paywall)
const eligible = ds.filter((d) => !d.paywall);
const combined = {
  eligibleUrls: eligible.length,
  technical: eligible.filter((d) => real.some((r) => r.urlId === d.id && r.technicalSuccess)).length,
  editorial: eligible.filter((d) => real.some((r) => r.urlId === d.id && r.editorialSuccess)).length,
  allUrls: ds.length,
  editorialAll: ds.filter((d) => real.some((r) => r.urlId === d.id && r.editorialSuccess)).length,
  titleOk: 0,
  titleBase: 0,
  dateVerifiable: 0,
  dateOk: 0,
};
for (const d of eligible) {
  // título NÃO circular: extrator mais barato com TEXTO (sucesso técnico), aprovado ou não no critério editorial
  const cheapestTech = real.filter((r) => r.urlId === d.id && r.technicalSuccess).sort((a, b) => a.costEstimatedUsd - b.costEstimatedUsd || a.durationMs - b.durationMs)[0];
  if (cheapestTech) {
    combined.titleBase++;
    if ((cheapestTech.titleMatch ?? 0) >= 0.5) combined.titleOk++;
  }
  const best = real.filter((r) => r.urlId === d.id && r.editorialSuccess).sort((a, b) => a.costEstimatedUsd - b.costEstimatedUsd)[0];
  if (!best) continue;
  if (best.dateMatch !== null && best.dateMatch !== undefined) {
    combined.dateVerifiable++;
    if (best.dateMatch) combined.dateOk++;
  }
}
const failedUrls = eligible.filter((d) => !real.some((r) => r.urlId === d.id && r.editorialSuccess)).map((d) => ({ id: d.id, domain: d.domain, category: d.category, errors: [...new Set(real.filter((r) => r.urlId === d.id).map((r) => `${r.provider}:${r.errorClass}${r.httpStatus ? `/${r.httpStatus}` : ''}`))] }));

const projections = Object.fromEntries(metrics.map((m) => [m.provider, projectMonthly(m.costPerValidArticleUsd)]));
const report = { runId, generatedAt: new Date().toISOString(), attempts: recs.length, realAttempts: real.length, excludedReplaced: recs.filter((r) => !byId.has(r.urlId)).length, mockAttempts: recs.filter((r) => r.mock).length, metrics, ranking, byCategory, byRecency, domainMatrix, routingMatrix, combined, failedUrls, projections };
writeFileSync(join(dir, CRITERION === 'v2' ? 'report.json' : 'report-v1-historico.json'), JSON.stringify(report, null, 2));

// markdown
const L: string[] = [];
L.push(`# Resultados — ${runId} — critério ${CRITERION === 'v2' ? 'v2 (estrito, reaplicado aos campos gravados; estimativa)' : 'v1 (vereditos gravados na rodada; HISTÓRICO)'}`, '', `Tentativas reais (com chamada) no dataset vigente: ${real.length} — ${new Set(real.map((r) => r.urlId + '|' + r.provider)).size} pares URL × provedor (fora do dataset v1.2, de URLs trocadas: ${recs.filter((r) => !byId.has(r.urlId)).length}; bloqueios por teto sem chamada, depois refeitos: ${recs.filter((r) => byId.has(r.urlId) && r.errorClass === 'budget_blocked').length}; mock: ${recs.filter((r) => r.mock).length}). Gerado em ${report.generatedAt}.`, '');
L.push('## Métricas por provedor', '', '| Provedor | n | Técnico | Editorial | Título | Data (verif.) | p50 ms | p95 ms | p99 ms | 403 | 429 | Timeout | Créditos | US$ equiv. | US$/artigo válido |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const m of [...metrics].sort((a, b) => b.editorialSuccessRate - a.editorialSuccessRate))
  L.push(`| ${m.provider} | ${m.n} | ${pct(m.technicalSuccessRate)} | ${pct(m.editorialSuccessRate)} | ${pct(m.titleAccuracy)} | ${pct(m.dateAccuracy)} (${m.dateVerifiable}) | ${m.p50 ?? '—'} | ${m.p95 ?? '—'} | ${m.p99 ?? '—'} | ${pct(m.rate403)} | ${pct(m.rate429)} | ${pct(m.timeoutRate)} | ${+m.creditsUsed.toFixed(2)} | ${m.costEstimatedUsd.toFixed(4)} | ${m.costPerValidArticleUsd?.toFixed(5) ?? '—'} |`);
L.push('', '## Ranking ponderado (qualidade 35, sucesso 25, custo 20, latência 15, frescor 5)', '', '| # | Provedor | Score | Qualidade | Sucesso | Custo | Latência | Frescor | n |', '|---:|---|---:|---:|---:|---:|---:|---:|---:|');
ranking.forEach((r, i) => L.push(`| ${i + 1} | ${r.provider} | ${r.score.toFixed(3)} | ${r.parts.quality.toFixed(2)} | ${r.parts.success.toFixed(2)} | ${r.parts.cost.toFixed(2)} | ${r.parts.latency.toFixed(2)} | ${r.parts.freshness.toFixed(2)} | ${r.n}${r.lowSample ? ' (amostra baixa)' : ''} |`));
L.push('', '## Sucesso editorial por categoria', '', `| Categoria | ${providers.join(' | ')} |`, `|---|${providers.map(() => '---:').join('|')}|`);
for (const [k, ms] of Object.entries(byCategory)) L.push(`| ${k} | ${providers.map((p) => { const m = ms.find((x) => x.provider === p); return m ? `${pct(m.editorialSuccessRate)} (${m.n})` : '—'; }).join(' | ')} |`);
L.push('', '## Sucesso editorial por recência', '', `| Recência | ${providers.join(' | ')} |`, `|---|${providers.map(() => '---:').join('|')}|`);
for (const [k, ms] of Object.entries(byRecency)) L.push(`| ${k} | ${providers.map((p) => { const m = ms.find((x) => x.provider === p); return m ? `${pct(m.editorialSuccessRate)} (${m.n})` : '—'; }).join(' | ')} |`);
L.push('', '## Pipeline combinado (URLs elegíveis = sem paywall)', '', `- Elegíveis: ${combined.eligibleUrls}; sucesso técnico combinado: ${combined.technical} (${pct(combined.technical / combined.eligibleUrls)}); editorial válido: ${combined.editorial} (${pct(combined.editorial / combined.eligibleUrls)}).`, `- Título (extrator mais barato com texto, sem filtro de título): ${combined.titleOk}/${combined.titleBase} (${pct(combined.titleOk / Math.max(1, combined.titleBase))}). Medida automática contra o título do feed/busca; precisão rotulada pendente.`, `- Data: cobertura ${combined.dateVerifiable}/${combined.editorial} com data comparável; correta ${combined.dateOk}/${combined.dateVerifiable} (${pct(combined.dateOk / Math.max(1, combined.dateVerifiable))}).`, `- Deduplicação: só repetição de hash por provedor; precisão ≥ 99 % exige pares rotulados (pendente).`, `- Incluindo paywall: ${combined.editorialAll}/${combined.allUrls}.`, '');
L.push('### URLs elegíveis sem extração válida', '', ...failedUrls.map((f) => `- ${f.id} ${f.domain} (${f.category}): ${f.errors.join(', ')}`), '');
L.push('## Matriz por domínio (válidos/tentativas)', '', `| Domínio | ${providers.join(' | ')} |`, `|---|${providers.map(() => '---:').join('|')}|`, ...domainMatrix.map((r) => `| ${r.domain} | ${providers.map((p) => r[p]).join(' | ')} |`));
L.push('', '## Matriz de roteamento recomendada (menor custo esperado por artigo válido)', '', '| Domínio | 1º | 2º | 3º |', '|---|---|---|---|', ...routingMatrix.map((m) => `| ${m.domain} | ${m.order.map((o) => `${o.provider} (${o.expectedUsdPerValid})`).join(' | ')} |`));
L.push('', '## Projeção mensal (US$ equivalentes, preço de lista; hoje só cota gratuita)', '', '| Provedor | 1.000 | 10.000 | 50.000 | 100.000 |', '|---|---:|---:|---:|---:|', ...Object.entries(projections).map(([p, v]) => `| ${p} | ${v['1000'] ?? '—'} | ${v['10000'] ?? '—'} | ${v['50000'] ?? '—'} | ${v['100000'] ?? '—'} |`));
writeFileSync(join(dir, CRITERION === 'v2' ? 'report.md' : 'report-v1-historico.md'), L.join('\n') + '\n');
console.log(L.slice(0, 40).join('\n'));
