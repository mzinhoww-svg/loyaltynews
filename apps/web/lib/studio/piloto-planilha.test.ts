import { describe, expect, it } from 'vitest';
import { PILOT_CSV_COLUMNS, pilotCsv } from '@ln/openbot';
import { COLUNAS, celula, linhasDaAmostra, planilhaCsv, type LinhaPiloto } from './piloto-planilha';
import type { Leitura, MateriaPiloto } from './piloto-view';

const mp = (materia: MateriaPiloto['materia'], articleId: string | null): MateriaPiloto => ({ materia, articleId, fonte: null, leitor2: ['a1', 'a4', 'a6', 'a9'].includes(materia), estado: 'aguardando_leitura', leituras: { leitor1: false, leitor2: false } });
const leit = (leitor: 1 | 2, over: Partial<Leitura> = {}): Leitura => ({
  materia: 'a1', articleId: 'art-1', leitor, por: 'u', em: '2026-11-23T12:00:00Z', achados: [], checklist: { fatosNasEvidencias: true, tom: true, nadaInventado: true }, veredito: 'aprovado',
  unsupportedFacts: 1, altas: 0, medias: 1, baixas: 0, ...over,
});
const linha = (over: Partial<LinhaPiloto> = {}): LinhaPiloto => ({ task_id: 't1', attempt: 1, stage: 'review', article_id: 'art-1', gate_verdict: 'approved', gate_reasons: ['ok'], cross_provider_ok: true, output_valid: true, ...over });
const parse = (csv: string) => {
  const ls = csv.trim().split('\n').map((l) => l.split(','));
  return ls[0]?.[0]?.startsWith('#') ? ls.slice(1) : ls;
};
const col = (csv: string, nome: string, i = 1) => parse(csv)[i]![COLUNAS.indexOf(nome as (typeof COLUNAS)[number])];

describe('planilha do piloto (PM-2026-11-23-F)', () => {
  it('carimba a amostra com o instante do resume antes do cabeçalho (B3)', () => {
    const csv = planilhaCsv([], [], {}, '2026-11-25T19:00:00.000Z');
    expect(csv.split('\n')[0]).toBe('# amostra_desde=2026-11-25T19:00:00.000Z');
  });
  it('as 31 colunas do AgentOps vêm primeiro, na ordem, e as extras no fim', () => {
    const head = parse(planilhaCsv([], [], {}))[0]!;
    expect(head.slice(0, PILOT_CSV_COLUMNS.length)).toEqual([...PILOT_CSV_COLUMNS]);
    expect(head.slice(PILOT_CSV_COLUMNS.length)).toEqual(['materia', 'leitor1_veredito', 'leitor2_veredito', 'leitor2_unsupported_high', 'leitor2_unsupported_medium', 'leitor2_unsupported_low', 'leitor2_origem']);
  });
  it('mesmo escape do pilotCsv (fórmula neutralizada, aspas, lista com " | ")', () => {
    for (const v of ['=HYPERLINK("x")', 'disse "oi", ok', '+1', '@x', 'normal']) {
      // notes é a última das 31 colunas e as outras vêm vazias: a linha do pilotCsv é 30 vírgulas + a célula
      const linhaOficial = pilotCsv([{ notes: v } as never]).split('\n')[1]!;
      expect(linhaOficial).toBe(','.repeat(PILOT_CSV_COLUMNS.length - 1) + celula(v));
    }
    expect(celula(['a', 'b'])).toBe('a | b');
  });
  it('unsupported_* da linha final vêm do leitor 1; linhas não finais e valores já gravados ficam como estão', () => {
    const csv = planilhaCsv([linha(), linha({ task_id: 't0', stage: 'draft' }), linha({ task_id: 't2', unsupported_facts: 5, unsupported_high: 5 })], [mp('a1', 'art-1')], { a1: [leit(1)] });
    expect(col(csv, 'unsupported_facts', 1)).toBe('1');
    expect(col(csv, 'unsupported_medium', 1)).toBe('1');
    expect(col(csv, 'unsupported_facts', 2)).toBe('');
    expect(col(csv, 'unsupported_facts', 3)).toBe('5');
    expect(col(csv, 'materia', 1)).toBe('a1');
    expect(col(csv, 'leitor1_veredito', 1)).toBe('aprovado');
    expect(col(csv, 'gate_reasons', 1)).toBe('ok');
  });
  it('cegueira: leitor 2 só sai quando o leitor 1 já leu a matéria', () => {
    const so2 = planilhaCsv([linha()], [mp('a1', 'art-1')], { a1: [leit(2, { veredito: 'bloqueado', altas: 2, origem: 'importacao' })] });
    expect(col(so2, 'leitor2_veredito')).toBe('');
    expect(col(so2, 'leitor2_unsupported_high')).toBe('');
    expect(col(so2, 'unsupported_facts')).toBe('');
    const ambos = planilhaCsv([linha()], [mp('a1', 'art-1')], { a1: [leit(1), leit(2, { veredito: 'bloqueado', altas: 2, origem: 'importacao' })] });
    expect(col(ambos, 'leitor2_veredito')).toBe('bloqueado');
    expect(col(ambos, 'leitor2_unsupported_high')).toBe('2');
    expect(col(ambos, 'leitor2_origem')).toBe('importacao');
  });
  it('linha sem artigo mapeado sai sem matéria nem leituras', () => {
    const csv = planilhaCsv([linha({ article_id: 'outro' })], [mp('a1', 'art-1')], { a1: [leit(1)] });
    expect(col(csv, 'materia')).toBe('');
    expect(col(csv, 'unsupported_facts')).toBe('');
  });
});

describe('fronteira da amostra medida (último resume + config_invalid)', () => {
  const l = (task_id: string, started_at: string, tratada?: { acao: string }) => ({ ...linha({ task_id, started_at }), ...(tratada ? { tratada } : {}) });
  it('sem resume, tira só as linhas excluídas por configuração', () => {
    const r = linhasDaAmostra([l('a', '2026-11-25T18:00:00Z'), l('b', '2026-11-25T18:10:00Z', { acao: 'config_invalid' }), l('c', '2026-11-25T18:20:00Z')], null);
    expect(r.map((x) => x.task_id)).toEqual(['a', 'c']);
  });
  it('com resume, só o que começou depois dele; config_invalid continua fora mesmo depois da fronteira', () => {
    const r = linhasDaAmostra([l('antes', '2026-11-25T18:00:00Z'), l('novo', '2026-11-25T19:01:00Z'), l('novo-cfg', '2026-11-25T19:02:00Z', { acao: 'config_invalid' })], '2026-11-25T19:00:00Z');
    expect(r.map((x) => x.task_id)).toEqual(['novo']);
  });
});
