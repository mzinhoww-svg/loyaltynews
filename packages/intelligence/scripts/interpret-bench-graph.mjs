#!/usr/bin/env node
/**
 * Interpreta o JSON do `bench-graph` (ADR-009) e aplica o critério de decisão de GRAPH_PERF.md: sai um veredito em minutos, sem refazer conta à mão.
 * Só LÊ o JSON (arquivo ou stdin); não abre rede, não toca em banco, não grava nada.
 *
 *   node scripts/interpret-bench-graph.mjs <resultado.json> [--json] [--rtt-max 20] [--real-edges N] [--max-degree N]
 *   node apps/workers/dist/bench-graph.js ... | node scripts/interpret-bench-graph.mjs -        (stdin; aceita log com linhas antes/depois do JSON)
 *
 * Regras (todas de GRAPH_PERF.md; nada novo é decidido aqui):
 *  1. MEDIÇÃO VÁLIDA: dados sintéticos, schema apagado, ≥ 100 mil arestas, três séries presentes. Senão, "inválida" (saída 2).
 *  2. DE DENTRO DA REDE: `origem` diz "dentro da rede" e o p50 do SELECT 1 é ≤ --rtt-max (padrão 20 ms). Senão o p95 medido inclui a rede de fora e vale só a
 *     ESTIMATIVA (`estimate_colocated_p95_ms`): veredito "inconclusivo" (saída 3), nunca "cumpre" por estimativa.
 *  3. CRITÉRIO ADR-009: pior p95 das 3 séries da consulta única (`results`) ≤ 300 ms (mesma comparação do `meets_criterion` do bench-pg).
 *  4. ESCOLHA ÚNICA × LOTE (só com `reference_batched`): o lote só substitui a consulta única se (a) cumpre o critério e (b) o pior p95 dele é pelo menos 10 %
 *     menor (histerese: não troca o que já está no produto por diferença de ruído); se a única não cumpre e o lote cumpre, vale o lote.
 *  5. GATILHO DA ADJACÊNCIA MATERIALIZADA (GRAPH_PERF.md): (a) p95 de organização medido na mesma rede > 250 ms; (b) ≥ 500 mil arestas REAIS (--real-edges);
 *     (c) grau de algum nó > 2 mil (--max-degree); (d) EXPLAIN com a visão `graph_edge` dominando: NÃO é decidido aqui, fica listado para olhar o `explain`.
 *  6. ÍNDICES (`with_indexes`, proposta 0030 descartada): só reabrir se o pior p95 com índices for ≥ 20 % menor E nenhuma série piorar mais de 10 %.
 *
 * Saída: 0 = válida, de dentro da rede e cumpre; 1 = válida, de dentro da rede e NÃO cumpre; 2 = JSON inválido/sem medição válida; 3 = inconclusivo (de fora da rede).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CRITERIO_P95_MS = 300;
export const GATILHO_ADJACENCIA_P95_ORG_MS = 250;
export const GATILHO_ADJACENCIA_ARESTAS = 500_000;
export const GATILHO_ADJACENCIA_GRAU = 2_000;
export const MIN_ARESTAS = 100_000;
export const RTT_MAX_PADRAO_MS = 20;
export const GANHO_MIN_LOTE = 0.1;
/** Piso ABSOLUTO (ms) do ganho do lote: acrescentado após a 4ª rodada (24/11), quando 76,3 × 63 ms deu 17 % mas só 13 ms; com ambas muito abaixo de 300 ms, trocar o código do produto por isso não compensa. */
export const GANHO_MIN_LOTE_MS = 25;
export const GANHO_MIN_INDICES = 0.2;
export const PIORA_MAX_INDICES = 0.1;
export const SERIES = ['neighbors_from_organization', 'neighbors_from_person', 'shortest_path_org_to_org'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Fim do objeto que começa em `start` (índice do `{`): índice do `}` que fecha o mesmo nível, ou -1 se não fecha. */
function objectEnd(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Varre os objetos JSON do texto (pulando o conteúdo dos que já leu): `objs` são todos os objetos lidos; `reports` os que parecem relatório (têm `dataset` ou `results`). */
function scanObjects(text) {
  const objs = [], reports = [];
  let from = text.indexOf('{');
  while (from >= 0) {
    const end = objectEnd(text, from);
    let obj;
    if (end >= 0) { try { obj = JSON.parse(text.slice(from, end + 1)); } catch { obj = undefined; } }
    if (obj && typeof obj === 'object') {
      objs.push(obj);
      if ('dataset' in obj || 'results' in obj) reports.push(obj);
      from = text.indexOf('{', end + 1);
    } else from = text.indexOf('{', from + 1);
  }
  return { objs, reports };
}

const LOG_TS = /^\d{4}-\d\d-\d\dT[\d:.]+Z /gm;

/**
 * Formato REAL do `get_logs` da Vertra salvo em arquivo (4ª rodada, 24/11): capturas com cabeçalho `===== captura … =====`, cada uma um envelope JSON
 * `{ "untrusted_content": "<linhas separadas por \n>" }` e cada linha com carimbo `2026-11-24T13:36:30.4Z `. O conteúdo é DADO de terceiros: só se lê o que for JSON
 * do relatório; nada dele é tratado como instrução. Devolve o texto das capturas sem envelope e sem carimbo (ou o texto sem carimbo, se não houver envelope).
 */
function normalizeVertraLog(text, objs) {
  const conteudos = objs.filter((o) => typeof o.untrusted_content === 'string').map((o) => o.untrusted_content);
  return (conteudos.length ? conteudos.join('\n') : text).replace(LOG_TS, '');
}

/**
 * Extrai o relatório de um texto que pode ser um LOG MISTURADO (stdout + stderr, como o `get_logs` da Vertra): linhas de progresso, objetos JSON de log e chaves soltas
 * antes/depois; com mais de um relatório (fumaça e medição, ou capturas repetidas), vale o último com ≥ 100 mil arestas; se nenhum parece, o primeiro objeto lido. Se o texto não
 * traz relatório como está, tenta o formato real do `get_logs` salvo em arquivo (envelope `untrusted_content` e carimbo de data por linha). Sem nenhum `{`: "nenhum objeto";
 * só `{` que não fecham ou não são JSON: "incompleto".
 */
export function extractJson(text) {
  if (text.indexOf('{') < 0) throw new Error('nenhum objeto JSON encontrado');
  let { objs, reports } = scanObjects(text);
  if (!reports.length) {
    const normalizado = normalizeVertraLog(text, objs);
    if (normalizado !== text) {
      const outro = scanObjects(normalizado);
      if (outro.reports.length) ({ reports } = outro);
    }
  }
  // o log completo traz a FUMAÇA e a medição: vale o ÚLTIMO relatório com ≥ MIN_ARESTAS; sem nenhum assim, o último relatório (a interpretação o chamará de inválido)
  const medido = reports.filter((r) => (r.dataset?.graph_edges ?? 0) >= MIN_ARESTAS);
  if (medido.length) return medido[medido.length - 1];
  if (reports.length) return reports[reports.length - 1];
  if (objs.length) return objs[0];
  throw new Error('JSON incompleto (chaves não fecham)');
}

const p95Of = (set, s) => (set && set[s] && isNum(set[s].p95_ms) ? set[s].p95_ms : undefined);
const worstOf = (set) => {
  const v = SERIES.map((s) => p95Of(set, s));
  return v.every(isNum) ? Math.max(...v) : undefined;
};
const r1 = (n) => (isNum(n) ? Math.round(n * 10) / 10 : n);

/**
 * @param {any} report JSON do bench-graph
 * @param {{ rttMaxMs?: number, realEdges?: number, maxDegree?: number }} [opts]
 */
export function interpret(report, opts = {}) {
  const rttMax = opts.rttMaxMs ?? RTT_MAX_PADRAO_MS;
  const problemas = [];
  const avisos = [];
  const r = report ?? {};

  // 1. medição válida
  if (r.env !== 'staging') problemas.push(`env=${JSON.stringify(r.env)}: esperado "staging"`);
  if (r.dataset?.synthetic !== true) problemas.push('dataset.synthetic não é true (só vale dado sintético)');
  if (r.schema_dropped !== true) problemas.push('schema_dropped não é true: o schema ln_bench_* pode ter sobrado; rode de novo com --replace e confira em pg_namespace');
  const arestas = r.dataset?.graph_edges;
  if (!isNum(arestas)) problemas.push('dataset.graph_edges ausente');
  else if (arestas < MIN_ARESTAS) problemas.push(`só ${arestas} arestas (< ${MIN_ARESTAS}): é fumaça (--scale), não vale como medição do critério`);
  for (const s of SERIES) if (!isNum(p95Of(r.results, s))) problemas.push(`results.${s}.p95_ms ausente`);

  const base = {
    valida: problemas.length === 0,
    problemas,
    origem: r.origem ?? null,
    versao: r.version ?? null,
    gerado_em: r.generated_at ?? null,
    arestas: isNum(arestas) ? arestas : null,
    criterio: { p95_ms: CRITERIO_P95_MS, arestas_min: MIN_ARESTAS },
  };
  if (problemas.length) return { ...base, veredito: 'invalida', saida: 2, resumo: `Medição inválida: ${problemas.join('; ')}.` };

  // 2. de dentro da rede?
  const rtt = r.network?.select1_roundtrip?.p50_ms;
  const declaraDentro = typeof r.origem === 'string' && /dentro da rede/i.test(r.origem);
  const rttOk = isNum(rtt) && rtt <= rttMax;
  const dentro = declaraDentro && rttOk;
  if (!declaraDentro) avisos.push('`origem` não diz "dentro da rede": tratado como medição de fora.');
  if (!isNum(rtt)) avisos.push('network.select1_roundtrip.p50_ms ausente: não dá para saber o custo de cada ida ao banco.');
  else if (!rttOk) avisos.push(`SELECT 1 p50 = ${r1(rtt)} ms (> ${rttMax} ms): o p95 medido inclui rede de fora; vale só a estimativa.`);

  // 3. critério
  const unica = SERIES.map((s) => ({ serie: s, p95: r1(p95Of(r.results, s)), estimativa_mesma_rede: r1(r.results[s]?.estimate_colocated_p95_ms), idas: r.results[s]?.db_roundtrips_median ?? null }));
  const piorUnica = Math.max(...unica.map((x) => x.p95));
  const cumpre = piorUnica <= CRITERIO_P95_MS;

  // 4. única × lote
  let lote = null;
  if (r.reference_batched && worstOf(r.reference_batched) !== undefined) {
    const piorLote = worstOf(r.reference_batched);
    const cumpreLote = piorLote <= CRITERIO_P95_MS;
    const ganho = (piorUnica - piorLote) / piorUnica;
    let usar = 'unica';
    let motivo;
    if (!dentro) {
      const est = (set) => Math.max(...SERIES.map((x) => set[x]?.estimate_colocated_p95_ms ?? 0));
      usar = 'indefinido';
      motivo = `medição de fora da rede: o p95 inclui a rede e não decide; só por ESTIMATIVA na mesma rede (única ${r1(est(r.results))} ms × lote ${r1(est(r.reference_batched))} ms)`;
    } else if (!cumpre && cumpreLote) { usar = 'lote'; motivo = 'a consulta única não cumpre o critério e o lote cumpre'; }
    else if (cumpreLote && ganho >= GANHO_MIN_LOTE && piorUnica - piorLote >= GANHO_MIN_LOTE_MS) { usar = 'lote'; motivo = `o lote tem pior p95 ${r1(ganho * 100)} % menor (≥ ${GANHO_MIN_LOTE * 100} % e ≥ ${GANHO_MIN_LOTE_MS} ms de ganho)`; }
    else if (!cumpre && !cumpreLote) { usar = 'nenhuma'; motivo = 'nenhuma das duas cumpre o critério'; }
    else motivo = ganho > 0 && cumpreLote ? `o lote é só ${r1(ganho * 100)} % (${r1(piorUnica - piorLote)} ms) melhor, abaixo do mínimo de ${GANHO_MIN_LOTE * 100} % e ${GANHO_MIN_LOTE_MS} ms: mantém a consulta única, que já está no produto (1 ida ao banco, não depende da rede)` : 'a consulta única é igual ou melhor';
    lote = {
      pior_p95_lote: r1(piorLote), cumpre_lote: cumpreLote, ganho_do_lote_sobre_unica_pct: r1(ganho * 100), usar, motivo,
      por_serie: SERIES.map((s) => ({ serie: s, unica: r1(p95Of(r.results, s)), lote: r1(p95Of(r.reference_batched, s)), idas_lote: r.reference_batched[s]?.db_roundtrips_median ?? null })),
    };
  } else avisos.push('sem `reference_batched` (rode com --with-reference): a escolha única × lote não foi avaliada.');

  // 5. gatilho da adjacência materializada
  const p95Org = p95Of(r.results, 'neighbors_from_organization');
  const gatilhos = [];
  if (dentro && p95Org > GATILHO_ADJACENCIA_P95_ORG_MS) gatilhos.push(`(a) p95 de organização na mesma rede = ${r1(p95Org)} ms > ${GATILHO_ADJACENCIA_P95_ORG_MS} ms`);
  if (isNum(opts.realEdges) && opts.realEdges >= GATILHO_ADJACENCIA_ARESTAS) gatilhos.push(`(b) ${opts.realEdges} arestas reais ≥ ${GATILHO_ADJACENCIA_ARESTAS}`);
  if (isNum(opts.maxDegree) && opts.maxDegree > GATILHO_ADJACENCIA_GRAU) gatilhos.push(`(c) grau máximo ${opts.maxDegree} > ${GATILHO_ADJACENCIA_GRAU}`);
  const naoAvaliados = ['(d) EXPLAIN com a visão `graph_edge` dominando: ler `explain.neighbors_org` (não é decidido por este script)'];
  if (!isNum(opts.realEdges)) naoAvaliados.push('(b) arestas reais: passe --real-edges N (hoje o dado real tem dezenas de arestas)');
  if (!isNum(opts.maxDegree)) naoAvaliados.push('(c) grau máximo: passe --max-degree N');
  if (!dentro) naoAvaliados.push('(a) p95 na mesma rede: só avaliável com medição de dentro da rede');

  // 6. índices
  let indices = null;
  if (r.with_indexes?.results && worstOf(r.with_indexes.results) !== undefined) {
    const piorInd = worstOf(r.with_indexes.results);
    const ganho = (piorUnica - piorInd) / piorUnica;
    const piorou = SERIES.filter((s) => (p95Of(r.with_indexes.results, s) - p95Of(r.results, s)) / p95Of(r.results, s) > PIORA_MAX_INDICES);
    const reabrir = ganho >= GANHO_MIN_INDICES && piorou.length === 0;
    indices = {
      pior_p95_com_indices: r1(piorInd), ganho_pct: r1(ganho * 100), series_que_pioraram_mais_de_10_pct: piorou, reabrir_0030: reabrir,
      motivo: reabrir ? 'pior p95 ≥ 20 % menor e nenhuma série piorou: reabrir a 0030 com nova medição' : piorou.length ? `índices pioraram ${piorou.join(', ')}: a 0030 segue DESCARTADA` : 'ganho abaixo de 20 % no pior caso: a 0030 segue DESCARTADA',
    };
  }

  // veredito
  let veredito, saida, resumo;
  if (!dentro) {
    veredito = 'inconclusivo'; saida = 3;
    resumo = `INCONCLUSIVO: medição de fora da rede (pior p95 medido ${r1(piorUnica)} ms; estimativa na mesma rede ${r1(Math.max(...unica.map((x) => x.estimativa_mesma_rede ?? 0)))} ms, que é só estimativa). Rodar o bench-graph de dentro da rede do staging.`;
  } else if (cumpre) {
    veredito = 'cumpre'; saida = 0;
    resumo = `CUMPRE a ADR-009: pior p95 ${r1(piorUnica)} ms ≤ ${CRITERIO_P95_MS} ms, medido de dentro da rede (SELECT 1 p50 ${r1(rtt)} ms) com ${arestas} arestas.`;
  } else {
    veredito = 'nao_cumpre'; saida = 1;
    resumo = `NÃO CUMPRE a ADR-009: pior p95 ${r1(piorUnica)} ms > ${CRITERIO_P95_MS} ms de dentro da rede. ${lote?.cumpre_lote ? 'O lote cumpre: trocar o produto para `neighborsBatched`/`shortestPathBatched`.' : 'Ver o `explain` e a adjacência materializada (não a 0030).'}`;
  }
  const recomendacao = {
    implementacao_do_produto: !dentro ? 'indefinida: medir de dentro da rede (a consulta única segue no produto até lá)' : lote ? (lote.usar === 'lote' ? 'neighborsBatched/shortestPathBatched' : lote.usar === 'unica' ? 'neighbors/shortestPath (consulta única, como está)' : 'nenhuma cumpre') : veredito === 'cumpre' ? 'neighbors/shortestPath (consulta única, como está)' : 'indefinida (sem reference_batched)',
    adjacencia_materializada: gatilhos.length ? `GATILHO ACIONADO: ${gatilhos.join('; ')}` : dentro ? 'sem gatilho acionado nos itens avaliados' : 'não avaliada',
    reabrir_0030: indices ? indices.reabrir_0030 : null,
  };

  return {
    ...base, veredito, saida, resumo, de_dentro_da_rede: dentro,
    rede: { select1_p50_ms: isNum(rtt) ? r1(rtt) : null, limite_ms: rttMax }, avisos,
    consulta_unica: { pior_p95: r1(piorUnica), cumpre, por_serie: unica }, lote, indices, gatilhos_adjacencia: gatilhos, gatilhos_nao_avaliados: naoAvaliados, recomendacao,
  };
}

/** Texto curto para colar no parecer/relatório. */
export function formatMarkdown(v) {
  const L = [`## Interpretação do bench-graph (ADR-009)`, '', `**${v.resumo}**`, ''];
  if (v.problemas?.length) return [...L, ...v.problemas.map((p) => `- ${p}`)].join('\n');
  L.push(`Origem: ${v.origem ?? '—'} · ${v.versao ?? '—'} · ${v.arestas} arestas · gerado em ${v.gerado_em ?? '—'}`);
  for (const a of v.avisos) L.push(`- AVISO: ${a}`);
  L.push('', '| Série | Única p95 (ms) | Estimativa mesma rede | Idas |' + (v.lote ? ' Lote p95 (ms) | Idas lote |' : ''), '|---|---|---|---|' + (v.lote ? '---|---|' : ''));
  for (const s of v.consulta_unica.por_serie) {
    const l = v.lote?.por_serie.find((x) => x.serie === s.serie);
    L.push(`| ${s.serie} | ${s.p95} | ${s.estimativa_mesma_rede ?? '—'} | ${s.idas ?? '—'} |${l ? ` ${l.lote} | ${l.idas_lote ?? '—'} |` : ''}`);
  }
  L.push('', `- Critério: pior p95 ≤ ${CRITERIO_P95_MS} ms → ${v.de_dentro_da_rede ? (v.consulta_unica.cumpre ? 'sim' : 'NÃO') : 'não avaliável (de fora da rede)'} (${v.consulta_unica.pior_p95} ms medido).`);
  if (v.lote) L.push(`- Única × lote: usar **${v.lote.usar}** — ${v.lote.motivo}.`);
  if (v.indices) L.push(`- Índices (0030): ${v.indices.motivo} (pior p95 com índices ${v.indices.pior_p95_com_indices} ms).`);
  L.push(`- Implementação no produto: ${v.recomendacao.implementacao_do_produto}.`, `- Adjacência materializada: ${v.recomendacao.adjacencia_materializada}.`);
  if (v.gatilhos_nao_avaliados?.length) L.push('- Não avaliado aqui:', ...v.gatilhos_nao_avaliados.map((g) => `  - ${g}`));
  return L.join('\n');
}

// Só executa quando o PRÓPRIO arquivo é o ponto de entrada.
const isMain = Boolean(process.argv[1]) && /interpret-bench-graph\.mjs$/.test(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const val = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : undefined; };
  const file = args.find((a, i) => (a === '-' || !a.startsWith('--')) && !(i > 0 && /^--(rtt-max|real-edges|max-degree)$/.test(args[i - 1])));
  if (!file) { console.error('uso: node scripts/interpret-bench-graph.mjs <resultado.json | -> [--json] [--rtt-max 20] [--real-edges N] [--max-degree N]'); process.exit(2); }
  let v;
  try {
    const texto = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
    v = interpret(extractJson(texto), { rttMaxMs: val('rtt-max'), realEdges: val('real-edges'), maxDegree: val('max-degree') });
  } catch (e) {
    console.error(`entrada ilegível: ${e instanceof Error ? e.message : 'erro'}`);
    process.exit(2);
  }
  console.log(args.includes('--json') ? JSON.stringify(v, null, 2) : formatMarkdown(v));
  process.exit(v.saida);
}
