import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SERIES, extractJson, formatMarkdown, interpret } from '../../scripts/interpret-bench-graph.mjs';

// Interpretação do JSON do bench-graph (ADR-009). Fixture = o resultado REAL de fora da rede (pg-staging-single.json), mutada para cada cenário.
const RESULT = fileURLToPath(new URL('../../bench/results/pg-staging-single.json', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../scripts/interpret-bench-graph.mjs', import.meta.url));
// JSON de fixture mutável por cenário (formato do relatório do bench-graph): tipagem solta de propósito
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const real = (): Record<string, any> => JSON.parse(readFileSync(RESULT, 'utf8'));

type Set = Record<string, { p95_ms: number; p50_ms?: number; db_roundtrips_median?: number; estimate_colocated_p95_ms?: number }>;
const setP95 = (set: Set, p95: [number, number, number], idas = 1): Set => Object.fromEntries(SERIES.map((s, i) => [s, { ...set[s], p95_ms: p95[i]!, p50_ms: p95[i]! * 0.6, db_roundtrips_median: idas, estimate_colocated_p95_ms: p95[i] }]));

/** Medição de DENTRO da rede: SELECT 1 em poucos ms, origem declarada, p95s dados. */
function dentro(unica: [number, number, number], lote?: [number, number, number], indices?: [number, number, number]) {
  const r = real();
  r.origem = 'dentro da rede (worker de staging)';
  r.network.select1_roundtrip.p50_ms = 2.1;
  r.results = setP95(r.results, unica);
  r.reference_batched = lote ? setP95(r.reference_batched, lote, 3) : undefined;
  r.with_indexes = indices ? { results: setP95(r.results, indices), server_side: {}, indexes: [] } : undefined;
  delete r.reference_recursive;
  return r;
}

describe('interpretação do bench-graph (ADR-009)', () => {
  it('o resultado REAL de fora da rede é INCONCLUSIVO (saída 3): o p95 inclui 125 ms de rede e não decide; só estimativas', () => {
    const v = interpret(real());
    expect(v.valida).toBe(true);
    expect(v.veredito).toBe('inconclusivo');
    expect(v.saida).toBe(3);
    expect(v.de_dentro_da_rede).toBe(false);
    expect(v.lote?.usar).toBe('indefinido');
    expect(v.lote?.motivo).toMatch(/estimativa/i);
    expect(v.recomendacao?.implementacao_do_produto).toMatch(/medir de dentro/);
    expect(v.indices?.reabrir_0030).toBe(false); // índices pioraram a organização: 0030 segue descartada
    expect(v.resumo).toMatch(/INCONCLUSIVO/);
  });

  it('de dentro da rede e todos os p95 ≤ 300: CUMPRE (saída 0); o lote só vence com ≥ 10 % de ganho no pior p95', () => {
    const v = interpret(dentro([180, 120, 60], [175, 115, 58]));
    expect(v.veredito).toBe('cumpre');
    expect(v.saida).toBe(0);
    expect(v.de_dentro_da_rede).toBe(true);
    expect(v.consulta_unica?.pior_p95).toBe(180);
    expect(v.lote?.usar).toBe('unica'); // ganho de ~3 %: ruído, mantém o que já está no produto
    expect(v.recomendacao?.implementacao_do_produto).toMatch(/neighbors\/shortestPath/);
    const melhor = interpret(dentro([180, 120, 60], [120, 100, 90]));
    expect(melhor.lote?.usar).toBe('lote'); // pior p95 do lote 120 contra 180: 33 % menor
    expect(melhor.recomendacao?.implementacao_do_produto).toMatch(/Batched/);
  });

  it('exatamente 300 ms ainda cumpre (≤, como o meets_criterion do bench-pg); 300,1 não', () => {
    expect(interpret(dentro([300, 100, 50])).saida).toBe(0);
    expect(interpret(dentro([300.1, 100, 50])).saida).toBe(1);
  });

  it('de dentro da rede e acima de 300: NÃO CUMPRE (saída 1); se o lote cumpre, vale o lote; se nenhum cumpre, adjacência (não a 0030)', () => {
    const loteCumpre = interpret(dentro([340, 200, 100], [280, 270, 260]));
    expect(loteCumpre.veredito).toBe('nao_cumpre');
    expect(loteCumpre.saida).toBe(1);
    expect(loteCumpre.lote?.usar).toBe('lote');
    expect(loteCumpre.resumo).toMatch(/neighborsBatched/);
    const nenhum = interpret(dentro([340, 200, 100], [420, 410, 400]));
    expect(nenhum.lote?.usar).toBe('nenhuma');
    expect(nenhum.resumo).toMatch(/adjacência materializada/);
    expect(nenhum.resumo).toMatch(/não a 0030/);
    expect(interpret(dentro([340, 200, 100])).avisos?.join(' ')).toMatch(/--with-reference/); // sem lote: avisa
  });

  it('gatilho (a) da adjacência: p95 de organização > 250 ms na mesma rede (mesmo cumprindo o critério); (b) e (c) só com --real-edges/--max-degree', () => {
    const a = interpret(dentro([260, 100, 50]));
    expect(a.saida).toBe(0);
    expect(a.gatilhos_adjacencia?.join(' ')).toMatch(/\(a\).*260/);
    expect(a.recomendacao?.adjacencia_materializada).toMatch(/GATILHO ACIONADO/);
    const sem = interpret(dentro([200, 100, 50]));
    expect(sem.gatilhos_adjacencia).toEqual([]);
    expect(sem.gatilhos_nao_avaliados?.join(' ')).toMatch(/--real-edges/);
    expect(sem.gatilhos_nao_avaliados?.join(' ')).toMatch(/\(d\)/); // EXPLAIN fica para leitura humana
    const bc = interpret(dentro([200, 100, 50]), { realEdges: 600_000, maxDegree: 2_500 });
    expect(bc.gatilhos_adjacencia?.join(' ')).toMatch(/\(b\).*\(c\)/);
    expect(interpret(dentro([200, 100, 50]), { realEdges: 499_999, maxDegree: 2_000 }).gatilhos_adjacencia).toEqual([]);
  });

  it('SELECT 1 acima do limite (padrão 20 ms) mesmo com origem "dentro da rede": inconclusivo; --rtt-max ajusta', () => {
    const r = dentro([180, 120, 60]);
    r.network.select1_roundtrip.p50_ms = 35;
    expect(interpret(r).saida).toBe(3);
    expect(interpret(r, { rttMaxMs: 50 }).saida).toBe(0);
    const semOrigem = dentro([180, 120, 60]);
    delete semOrigem.origem;
    expect(interpret(semOrigem).saida).toBe(3);
  });

  it('medição INVÁLIDA (saída 2): fumaça (< 100 mil arestas), schema não apagado, dado não sintético, série ausente, env errado', () => {
    const fumaca = dentro([100, 100, 100]);
    fumaca.dataset.graph_edges = 2300;
    expect(interpret(fumaca)).toMatchObject({ veredito: 'invalida', saida: 2 });
    expect(interpret(fumaca).resumo).toMatch(/fumaça/);
    const sobrou = dentro([100, 100, 100]);
    sobrou.schema_dropped = false;
    expect(interpret(sobrou).resumo).toMatch(/--replace/);
    const real1 = dentro([100, 100, 100]);
    real1.dataset.synthetic = false;
    expect(interpret(real1).saida).toBe(2);
    const semSerie = dentro([100, 100, 100]);
    delete semSerie.results.neighbors_from_person;
    expect(interpret(semSerie).problemas.join(' ')).toMatch(/neighbors_from_person/);
    const prod = dentro([100, 100, 100]);
    prod.env = 'production';
    expect(interpret(prod).saida).toBe(2);
    expect(interpret(null).saida).toBe(2);
    expect(interpret({}).saida).toBe(2);
  });

  it('índices (0030): só reabre com pior p95 ≥ 20 % menor E nenhuma série pior que 10 %; piorou → segue descartada', () => {
    const reabre = interpret(dentro([200, 100, 50], undefined, [150, 90, 48]));
    expect(reabre.indices?.reabrir_0030).toBe(true);
    const piora = interpret(dentro([200, 100, 50], undefined, [150, 120, 48]));
    expect(piora.indices?.reabrir_0030).toBe(false);
    expect(piora.indices?.series_que_pioraram_mais_de_10_pct).toEqual(['neighbors_from_person']);
    const pouco = interpret(dentro([200, 100, 50], undefined, [190, 95, 50]));
    expect(pouco.indices?.reabrir_0030).toBe(false);
    expect(pouco.indices?.motivo).toMatch(/DESCARTADA/);
  });

  it('extractJson: aceita log antes/depois do JSON, chaves e aspas dentro de strings; recusa texto sem JSON ou JSON truncado', () => {
    const json = { a: 1, b: 'texto com } e { e "aspas\\"', c: { d: [1, 2, { e: 3 }] } };
    const log = `[bench] carregando...\n${JSON.stringify(json, null, 2)}\n[bench] fim { não é json`;
    expect(extractJson(log)).toEqual(json);
    expect(() => extractJson('só log, sem json')).toThrow(/nenhum objeto/);
    expect(() => extractJson('{ "a": 1, ')).toThrow(/incompleto/);
  });

  it('extractJson em LOG MISTURADO (stdout + stderr do get_logs): ignora linhas de progresso, objetos JSON de log e chaves soltas; devolve o relatório', () => {
    const rel = dentro([180, 120, 60], [120, 100, 90]);
    const log = [
      '[bench] criando schema ln_bench_20261124',
      JSON.stringify({ level: 'info', msg: 'start', pid: 7 }), // objeto JSON de log ANTES do relatório (reparo do QA 3)
      '[bench] erro { sem fechar',
      JSON.stringify(rel, null, 2),
      '[bench] fim',
      JSON.stringify({ level: 'info', msg: 'depois' }),
    ].join('\n');
    expect(extractJson(log)).toEqual(rel);
    expect(interpret(extractJson(log)).saida).toBe(0);
    // log completo com DOIS relatórios (fumaça e medição): vale o último com ≥ 100 mil arestas; só a fumaça no log = inválida (saída 2)
    const fumaca = real();
    fumaca.dataset.graph_edges = 2300;
    const dois = `${JSON.stringify(fumaca, null, 2)}\n[bench] 2º passo\n${JSON.stringify(rel, null, 2)}`;
    expect(interpret(extractJson(dois)).saida).toBe(0);
    expect(extractJson(dois)).toEqual(rel);
    expect(interpret(extractJson(`${JSON.stringify(fumaca, null, 2)}\n[bench] fim`)).saida).toBe(2);
    // sem nenhum relatório, devolve o primeiro objeto (comportamento anterior) e a interpretação diz que é inválida
    expect(interpret(extractJson(`${JSON.stringify({ msg: 'só log' })}\n[bench] x`)).saida).toBe(2);
  });

  it('formatMarkdown: tabela com as três séries, veredito e itens não avaliados; inválida lista os problemas', () => {
    const md = formatMarkdown(interpret(dentro([180, 120, 60], [120, 100, 90])));
    expect(md).toMatch(/CUMPRE a ADR-009/);
    for (const s of SERIES) expect(md).toContain(s);
    expect(md).toMatch(/Única × lote: usar \*\*lote\*\*/);
    expect(md).toMatch(/Não avaliado aqui/);
    const bad = dentro([1, 1, 1]);
    bad.schema_dropped = false;
    expect(formatMarkdown(interpret(bad))).toMatch(/inválida/i);
  });

  it('linha de comando: código de saída (3 = de fora, 0 = cumpre, 2 = ilegível), --json e leitura de stdin com log antes do JSON', () => {
    const run = (args: string[], input?: string) => spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8' });
    const fora = run([RESULT]);
    expect(fora.status).toBe(3);
    expect(fora.stdout).toMatch(/INCONCLUSIVO/);
    const json = run([RESULT, '--json']);
    expect(JSON.parse(json.stdout).veredito).toBe('inconclusivo');
    const ok = run(['-', '--json'], `[bench] log antes\n${JSON.stringify(dentro([180, 120, 60], [120, 100, 90]))}\n`);
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout).recomendacao.implementacao_do_produto).toMatch(/Batched/);
    expect(run(['-'], 'isto não é json').status).toBe(2);
    expect(run([]).status).toBe(2);
  });
});
