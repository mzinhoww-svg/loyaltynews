import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PILOT_SHEET_COLUMNS } from './pilot';

// Comando de linha `avaliar-piloto.mjs --csv <arquivo>`: lê o CSV exportado do Studio e roda o evaluatePilot. Dados SIMULADOS (fixtures/pilot-csv).
const BIN = new URL('../bin/avaliar-piloto.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FIX = (n: string) => new URL(`../fixtures/pilot-csv/${n}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const tmp = mkdtempSync(join(tmpdir(), 'avaliar-piloto-'));
const escreve = (nome: string, conteudo: string) => {
  const p = join(tmp, nome);
  writeFileSync(p, conteudo, 'utf8');
  return p;
};
const fixText = () => readFileSync(FIX('simulado-aprovado-so-31-colunas.csv'), 'utf8').replace(/^\uFEFF/, '');

describe('avaliar-piloto: veredito e código de saída sobre o CSV exportado', () => {
  it('CSV aprovado (31 colunas do AgentOps + 7 do Studio ignoradas): APROVADO, saída 0, com limite medido e output_valid em destaque', () => {
    const r = run('--csv', FIX('simulado-aprovado.csv'));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/VEREDITO: APROVADO/);
    expect(r.out).toMatch(/qualidade: pass; altas 0, médias 1, baixas 3/);
    expect(r.out).toMatch(/independência: pass \(20 de 20/);
    expect(r.out).toMatch(/custo tarifado: 0 chamada/);
    expect(r.out).toMatch(/janelas de limite: measured; 1 limite/);
    expect(r.out).toMatch(/DESTAQUE output_valid: 100\.0% \(40 de 40\); limiar de 95% é INFORMATIVO/);
    expect(r.err).toBe('');
  });

  it('o mesmo CSV só com as 31 colunas também é aprovado; o BOM e as aspas, vírgulas e fórmula neutralizada do notes são lidos', () => {
    const r = run('--csv', FIX('simulado-aprovado-so-31-colunas.csv'));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/VEREDITO: APROVADO/);
    expect(readFileSync(FIX('simulado-aprovado-so-31-colunas.csv'), 'utf8').startsWith('\uFEFF')).toBe(true); // o BOM do Studio está no fixture
    expect(readFileSync(FIX('simulado-aprovado-so-31-colunas.csv'), 'utf8')).toContain(`"'=1+1, com vírgula e ""aspas"""`);
  });

  it('CSV reprovado (1 alta e 2 médias): REPROVADO, saída 1, com o motivo e as contagens', () => {
    const r = run('--csv', FIX('simulado-reprovado.csv'));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/VEREDITO: REPROVADO/);
    expect(r.out).toMatch(/qualidade: 1 alta\(s\) \(máximo 0\) e 2 média\(s\) \(máximo 1\)/);
    expect(r.out).toMatch(/Motivos:/);
  });

  it('CSV inválido (approved com motivo bloqueante tone_lint): INVÁLIDO, saída 1, nomeia a tarefa', () => {
    const r = run('--csv', FIX('simulado-invalido.csv'));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/VEREDITO: INVÁLIDO/);
    expect(r.out).toMatch(/linha inválida a2-review: veredito approved com motivo bloqueante \(tone_lint\)/);
  });

  it('violação conta: uma linha com publicação tentada para o piloto (PARADO, saída 1) mesmo com o resto aprovado', () => {
    const t = fixText().split('\n');
    const cab = t[0]!.split(',');
    const i = cab.indexOf('published_attempt');
    const cols = t[1]!.split(',');
    cols[i] = 'true';
    t[1] = cols.join(',');
    const r = run('--csv', escreve('violacao.csv', t.join('\n')));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/VEREDITO: PARADO/);
    expect(r.out).toMatch(/parada imediata/);
    expect(r.out).toMatch(/continuam contando mesmo depois de resolvidas/);
  });

  it('uma checagem no mesmo provedor do redator reprova a independência', () => {
    const t = fixText().split('\n');
    const cab = t[0]!.split(',');
    const iAcc = cab.indexOf('account');
    const iMod = cab.indexOf('declared_model');
    const k = t.findIndex((l) => l.startsWith('a1-factcheck,'));
    const cols = t[k]!.split(',');
    cols[iAcc] = 'claude';
    cols[iMod] = 'claude-opus-5-5';
    t[k] = cols.join(',');
    const r = run('--csv', escreve('mesmo-provedor.csv', t.join('\n')));
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/VEREDITO: APROVADO/);
  });
});

describe('avaliar-piloto: CSV malformado e erros de uso falham fechado (saída 1, mensagem clara, sem tocar em nada)', () => {
  const comCabecalho = (mudar: (cab: string[]) => string[]) => {
    const t = fixText().split('\n');
    t[0] = mudar(t[0]!.split(',')).join(',');
    return t.join('\n');
  };

  it('sem --csv, arquivo inexistente e CSV vazio', () => {
    expect(run().code).toBe(1);
    expect(run().err).toMatch(/uso: node packages\/agents\/bin\/avaliar-piloto\.mjs --csv/);
    const r = run('--csv', join(tmp, 'nao-existe.csv'));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/não consegui ler o arquivo nao-existe\.csv/);
    expect(run('--csv', escreve('vazio.csv', '')).err).toMatch(/CSV vazio/);
  });

  it('cabeçalho: coluna trocada de lugar, coluna faltando e coluna extra desconhecida', () => {
    const trocada = run('--csv', escreve('trocada.csv', comCabecalho((c) => { [c[22], c[23]] = [c[23]!, c[22]!]; return c; })));
    expect(trocada.code).toBe(1);
    expect(trocada.err).toMatch(/cabeçalho inválido: a coluna 23 deveria ser "unsupported_facts"/);
    const faltando = run('--csv', escreve('faltando.csv', comCabecalho((c) => c.filter((x) => x !== 'unsupported_low'))));
    expect(faltando.code).toBe(1);
    expect(faltando.err).toMatch(/cabeçalho inválido/);
    const extra = run('--csv', escreve('extra.csv', comCabecalho((c) => [...c, 'coluna_inventada'])));
    expect(extra.code).toBe(1);
    expect(extra.err).toMatch(/depois das 31 colunas só podem vir/);
  });

  it('célula obrigatória vazia, booleano inválido, inteiro inválido e linha com colunas a mais', () => {
    const t = fixText().split('\n');
    const cab = t[0]!.split(',');
    const troca = (col: string, valor: string) => {
      const c = t[1]!.split(',');
      c[cab.indexOf(col)] = valor;
      return [t[0], c.join(','), ...t.slice(2)].join('\n');
    };
    const vazio = run('--csv', escreve('vazio-obrig.csv', troca('published_attempt', '')));
    expect(vazio.code).toBe(1);
    expect(vazio.err).toMatch(/coluna obrigatória "published_attempt" vazia \(campo ausente nunca vale como "não houve violação"\)/);
    expect(run('--csv', escreve('bool.csv', troca('tarifada_api_call', 'talvez'))).err).toMatch(/"tarifada_api_call" = "talvez" \(esperado true ou false\)/);
    expect(run('--csv', escreve('int.csv', troca('attempt', '1.5'))).err).toMatch(/"attempt" = "1\.5" \(esperado inteiro ≥ 0\)/);
    expect(run('--csv', escreve('colunas.csv', [t[0], `${t[1]},sobra`, ...t.slice(2)].join('\n'))).err).toMatch(/a linha 2 tem \d+ colunas e o cabeçalho tem \d+/);
    expect(run('--csv', escreve('aspas.csv', `${t[0]}\n"aberta`)).err).toMatch(/aspas sem fechar/);
    expect(run('--csv', escreve('so-cabecalho.csv', t[0]!)).err).toMatch(/sem linhas de dados/);
  });

  it('o cabeçalho esperado é exatamente o do avaliador (31 colunas)', () => {
    const cab = fixText().split('\n')[0]!.split(',');
    expect(cab.slice(0, 31)).toEqual([...PILOT_SHEET_COLUMNS]);
  });
});

describe('avaliar-piloto: sem rede, sem banco e sem segredo', () => {
  it('o código do comando não importa rede, processo filho nem lê variável de ambiente', () => {
    const src = readFileSync(BIN, 'utf8');
    expect(src).not.toMatch(/node:(http|https|net|dns|tls|child_process|worker_threads)|\bfetch\(|process\.env|XMLHttpRequest|WebSocket/);
    expect([...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort()).toEqual(['node:fs', 'node:path']);
    expect(src).toMatch(/--json/);
  });

  it('--json devolve um resumo sem conteúdo de célula além dos motivos e mantém o mesmo código de saída', () => {
    const ok = run('--csv', FIX('simulado-aprovado.csv'), '--json');
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.out)).toMatchObject({ veredito: 'APROVADO', overall: 'pass', linhas: 41 });
    const ruim = run('--csv', FIX('simulado-reprovado.csv'), '--json');
    expect(ruim.code).toBe(1);
    expect(JSON.parse(ruim.out)).toMatchObject({ veredito: 'REPROVADO', overall: 'fail' });
  });
});
