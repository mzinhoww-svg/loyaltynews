import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EDITORIAS } from '../types';
import { SEED_SOURCES } from '../sources/seed';
import { sourceTier } from '../types';

// Pauta das 10 primeiras matérias do piloto (24/11/2026): cada item é um título REAL de feed de uma fonte do banco, e a âncora primária é declarada com honestidade.
interface Base { fonte: string; nome: string; kind: string; titulo: string; link: string; data: string }
interface Materia { n: number; editoria: string; formato: 'noticia' | 'flash'; tema: string; angulo: string; base: Base[]; pistas: Base[]; ancora: 'sim' | 'parcial' | 'nao'; ancoraNota: string; risco: string }
const doc = (n: string) => readFileSync(new URL(`../../docs/${n}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const data = JSON.parse(doc('pauta-primeiras-10-materias.data.json')) as { geradoEm: string; materias: Materia[] };
const md = doc('pauta-primeiras-10-materias.md');
const seed = new Map(SEED_SOURCES.map((s) => [s.id, s]));

describe('pauta das 10 primeiras matérias', () => {
  it('são 10, numeradas, com editoria válida, formato, ângulo, risco e fonte-base; nenhuma é texto de matéria', () => {
    expect(data.materias.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const m of data.materias) {
      expect(EDITORIAS as readonly string[], `#${m.n}`).toContain(m.editoria);
      expect(['noticia', 'flash']).toContain(m.formato);
      expect(m.tema.length, `#${m.n}`).toBeGreaterThan(20); expect(m.angulo.length).toBeGreaterThan(30); expect(m.risco.length).toBeGreaterThan(15);
      expect(m.base.length, `#${m.n}: fonte-base`).toBeGreaterThanOrEqual(1);
      expect(m.tema, `#${m.n}: pauta, não texto`).not.toMatch(/SIMULADO/);
    }
  });

  it('cada fonte-base e pista é de uma fonte do banco com feed direto, com link https e data de 18 a 24/11/2026', () => {
    for (const m of data.materias) for (const b of [...m.base, ...m.pistas]) {
      const s = seed.get(b.fonte);
      expect(s, `${b.fonte} está no seed`).toBeTruthy();
      expect(s!.feedUrl, `${b.fonte}: lida pelo feed`).toBeTruthy(); expect(s!.acesso ?? 'padrao').toBe('padrao');
      expect(b.link, `${b.fonte}`).toMatch(/^https:\/\//); expect(b.titulo.length).toBeGreaterThan(10);
      expect(b.data >= '2026-11-18' && b.data <= '2026-11-24', `${b.fonte}: ${b.data}`).toBe(true);
      expect(b.kind).toBe(s!.kind);
    }
  });

  it('âncora honesta: fonte-base secundária (blog, imprensa de nicho) NUNCA conta como "sim"; "sim" exige fonte primária do banco; "não" diz o que falta', () => {
    for (const m of data.materias) {
      const secundaria = m.base.every((b) => sourceTier(seed.get(b.fonte)!.kind) === 'secondary');
      if (secundaria) expect(m.ancora, `#${m.n}: base só secundária`).not.toBe('sim');
      if (m.ancora === 'sim') expect(m.base.some((b) => sourceTier(seed.get(b.fonte)!.kind) === 'primary'), `#${m.n}`).toBe(true);
      expect(m.ancoraNota.length, `#${m.n}`).toBeGreaterThan(30);
      if (m.ancora === 'nao') expect(m.risco + m.ancoraNota, `#${m.n}`).toMatch(/sem âncora|Sem âncora|não publicar|Não publicar|coletar|Âncora a coletar/i);
    }
    expect(data.materias.filter((m) => m.ancora === 'sim').length).toBeGreaterThanOrEqual(3);
  });

  it('o documento lista as 10 pautas com link e data, a conta de âncoras e as limitações (93 habilitadas fora do alcance, perecibilidade)', () => {
    for (const m of data.materias) { expect(md, `#${m.n}`).toContain(m.tema); for (const b of m.base) expect(md).toContain(b.link); }
    for (const a of ['sim', 'parcial', 'nao'] as const) { const ns = data.materias.filter((m) => m.ancora === a).map((m) => m.n).join(', '); expect(md, a).toContain(`(${ns})`); }
    expect(md).toMatch(/lista das 93 fontes habilitadas no staging não estava ao meu alcance/);
    expect(md).toMatch(/expira em horas ou dias/); expect(md).toMatch(/sem abrir matéria nenhuma/);
  });
});
