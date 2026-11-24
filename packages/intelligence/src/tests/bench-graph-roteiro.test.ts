import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// O roteiro da 4ª rodada (BENCH_GRAPH_RODADA4.md) tem de continuar fiel à CLI e ao interpretador: comando que o roteiro cita e a CLI não aceita é erro de operação em staging.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const ROTEIRO = read('../../BENCH_GRAPH_RODADA4.md');
const CLI = read('../../../../apps/workers/src/bench-graph.ts') + read('../../../../apps/workers/src/bench-graph.main.ts');
const INTERPRETADOR = read('../../scripts/interpret-bench-graph.mjs');

describe('roteiro da 4ª rodada do bench-graph', () => {
  it('toda opção --xxx citada nos comandos do bench-graph existe na CLI (e nenhuma opção da CLI some do roteiro)', () => {
    const comandos = ROTEIRO.split('\n').filter((l) => /bench-graph\.js/.test(l)).join('\n');
    const usadas = [...new Set([...comandos.matchAll(/--([a-z][a-z-]+)/g)].map((m) => m[1]!))];
    expect(usadas.sort()).toEqual(['confirm-staging-bench', 'scale', 'with-indexes', 'with-reference']);
    for (const o of ['confirm-staging-bench', 'scale', 'replace', 'schema', 'with-reference', 'with-indexes']) {
      // a CLI lê flags por `argv.includes('--x')` ou valores por `argValue(argv, 'x')`
      expect(CLI, `CLI deve conhecer --${o}`).toMatch(new RegExp(`'--${o}'|argValue\\(argv, '${o}'\\)`));
      expect(ROTEIRO, `roteiro deve citar --${o}`).toContain(`--${o}`);
    }
  });

  it('as opções do interpretador citadas existem, e os códigos de saída 0/1/2/3 do roteiro são os do script', () => {
    for (const o of ['json', 'real-edges', 'max-degree']) {
      expect(ROTEIRO).toContain(`--${o}`);
      expect(INTERPRETADOR).toContain(o);
    }
    expect(INTERPRETADOR).toMatch(/0 = válida.*1 = válida.*2 = JSON inválido.*3 = inconclusivo/s);
    for (const s of ['**0**', '**1**', '**2**', '**3**']) expect(ROTEIRO).toContain(`| ${s} |`);
  });

  it('limites L1–L5, limpeza com --replace e a marca ln-bench: estão no roteiro, e o nome do schema segue o padrão da CLI', () => {
    for (const l of ['L1', 'L2', 'L3', 'L4', 'L5']) expect(ROTEIRO).toContain(`**${l}**`);
    expect(ROTEIRO).toContain('ln-bench:');
    expect(ROTEIRO).toContain("like 'ln_bench_%'");
    expect(ROTEIRO).toMatch(/ln_bench_AAAAMMDD\[_sufixo\]/);
  });

  it('os dois OK (PM e DevOps) estão REGISTRADOS com a origem; a permissão CREATE SCHEMA segue desconhecida; o Data não executa; sem segredo, URL de conexão nem PEM', () => {
    const portoes = ROTEIRO.slice(ROTEIRO.indexOf('## 1.'), ROTEIRO.indexOf('## 2.'));
    expect(portoes).toMatch(/OK para criar o schema[^\n]*\| PM \| \*\*OK registrado\*\*[^\n]*79ff90ec/);
    expect(portoes).toMatch(/OK de capacidade[^\n]*\| DevOps \| \*\*OK registrado\*\*[^\n]*19863c6e/);
    expect(portoes).toMatch(/Permissão `CREATE SCHEMA`[^\n]*\*\*desconhecida\*\*/); // só a fumaça descobre
    expect(ROTEIRO).toMatch(/não sobrepor a um deploy do web/i);
    expect(ROTEIRO).toMatch(/Nada deste arquivo foi executado pelo Data/);
    expect(ROTEIRO).not.toMatch(/postgres(ql)?:\/\/|BEGIN (CERT|PRIVATE)|sk-[A-Za-z0-9]{10,}|password=/i);
  });

  it('a leitura do resultado usa o LOG misturado salvo (get_logs mistura stdout e stderr), com caminho absoluto e extensão .log', () => {
    const secao5 = ROTEIRO.slice(ROTEIRO.indexOf('## 5.'), ROTEIRO.indexOf('## 6.'));
    expect(secao5).toContain('C:\\Users\\mazin\\OpenBot\\Shared\\loyalty-news\\releases\\staging\\bench-graph-relatorio-AAAAMMDD.log');
    expect(secao5).toMatch(/mistura stdout e stderr/);
    expect(secao5).not.toMatch(/AAAAMMDD\.json/);
    expect(/[\x00-\x08\x0b-\x1f]/.test(ROTEIRO)).toBe(false); // sem caracteres de controle (barras invertidas perdidas)
  });
});
