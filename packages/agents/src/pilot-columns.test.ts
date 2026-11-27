import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import consumers from '../fixtures/pilot-csv-consumers.json';
import { PATCHABLE_ROW_FIELDS, PILOT_ROW_FIELDS, PILOT_SHEET_COLUMNS, sheetCsvHeader, type PilotRow } from './pilot';

// Prontidão do piloto: as colunas da planilha (CSV) que o AgentOps entrega, o `PilotRow` do avaliador e as colunas que Integration e
// Studio 2 consomem têm de ser a MESMA lista, na mesma ordem. Se qualquer um dos quatro divergir, este arquivo falha.

type Col = (typeof PILOT_SHEET_COLUMNS)[number];
// compilação: toda coluna é campo do PilotRow e todo campo do PilotRow é coluna (tsc falha se divergir)
const _colunasSaoCampos: Col extends keyof PilotRow ? true : never = true;
const _camposSaoColunas: Exclude<keyof PilotRow, Col> extends never ? true : never = true;
void _colunasSaoCampos;
void _camposSaoColunas;

const cols = [...PILOT_SHEET_COLUMNS] as string[];

describe('colunas da planilha do piloto × PilotRow × consumidores (Integration e Studio 2)', () => {
  it('a planilha tem 32 colunas e elas são exatamente os campos do PilotRow, sem repetição', () => {
    expect(cols).toHaveLength(32);
    expect(new Set(cols).size).toBe(32);
    expect([...cols].sort()).toEqual(Object.keys(PILOT_ROW_FIELDS).sort());
  });

  it('o cabeçalho do CSV entregue (fast-track/piloto e artefato) é a lista de colunas, na ordem', () => {
    expect(sheetCsvHeader().trim()).toBe(cols.join(','));
    const artefato = readFileSync(new URL('../artifacts/pilot-measurement-sheet.csv', import.meta.url), 'utf8').trim();
    expect(artefato).toBe(cols.join(','));
  });

  it('a gravidade dos fatos não suportados está na planilha e é a que o patch aceita', () => {
    for (const c of ['unsupported_facts', 'unsupported_high', 'unsupported_medium', 'unsupported_low']) expect(cols).toContain(c);
    for (const f of PATCHABLE_ROW_FIELDS) expect(cols, `campo de patch ${f}`).toContain(f);
    expect(cols.indexOf('unsupported_high')).toBe(cols.indexOf('unsupported_facts') + 1); // ordem que os consumidores esperam
  });

  for (const c of consumers.consumers) {
    it(`${c.id} (${c.owner}, ${c.ref} ${c.commit}) tem as mesmas colunas, na mesma ordem`, () => {
      expect(c.columns).toEqual(cols);
    });
  }

  it('as colunas extras do Studio 2 vêm só no FIM e não colidem com campo do PilotRow', () => {
    const extras = consumers.studio_extras.columns;
    expect(extras.length).toBeGreaterThan(0);
    for (const e of extras) expect(cols, `extra ${e}`).not.toContain(e);
    const todas = [...cols, ...extras];
    expect(new Set(todas).size).toBe(todas.length);
    expect(extras).toContain('leitor2_unsupported_high');
  });

  it('a lista dos consumidores é detectada como divergente quando uma coluna muda (o teste falha de verdade)', () => {
    const trocada = [...consumers.consumers[0]!.columns];
    [trocada[22], trocada[23]] = [trocada[23]!, trocada[22]!]; // unsupported_facts ↔ unsupported_high
    expect(trocada).not.toEqual(cols);
    expect(consumers.consumers[0]!.columns.filter((x) => x !== 'unsupported_low')).not.toEqual(cols);
  });
});

// Conferência contra o código VIVO dos consumidores (git show), opt-in: LN_PILOT_COLUMNS_LIVE=1. Sem a variável, o teste fica "skipped" (não vira verde falso).
const live = process.env.LN_PILOT_COLUMNS_LIVE === '1';
const gitShow = (ref: string, path: string) => execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', maxBuffer: 10_000_000 });
const arrayAfter = (text: string, name: string) => {
  const m = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(text);
  return m ? [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!) : [];
};

describe.skipIf(!live)('conferência ao vivo (LN_PILOT_COLUMNS_LIVE=1)', () => {
  it('PILOT_CSV_COLUMNS da Integration (origem) = colunas da planilha', () => {
    const ref = process.env.LN_PILOT_COLUMNS_OPENBOT_REF ?? 'origin/main';
    expect(arrayAfter(gitShow(ref, 'packages/openbot/src/pilot.ts'), 'PILOT_CSV_COLUMNS')).toEqual(cols);
  });
  it('COLUNAS_AGENTOPS do e2e do Studio 2 e COLUNAS_EXTRAS = colunas da planilha + extras no fim', () => {
    const ref = process.env.LN_PILOT_COLUMNS_STUDIO_REF ?? 'ft/studio-2';
    expect(arrayAfter(gitShow(ref, 'apps/web/e2e/studio-y3-piloto-planilha.spec.ts'), 'COLUNAS_AGENTOPS')).toEqual(cols);
    const extras = arrayAfter(gitShow(ref, 'apps/web/lib/studio/piloto-planilha.ts'), 'COLUNAS_EXTRAS');
    expect(extras).toEqual(consumers.studio_extras.columns);
    for (const e of extras) expect(cols).not.toContain(e);
  });
});
