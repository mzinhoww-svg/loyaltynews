import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AD_FORMATS,
  AdFormat,
  AgentProfile,
  Article,
  ASSINATURA,
  BUDGET_ALLOCATION_MICROUSD,
  BudgetReservation,
  EDITORIAS,
  FLAG_DEFAULTS,
  HARD_MONTHLY_CAP_MICROUSD,
  Person,
  Ritual,
  Workflow,
  apiError,
  expectedQuorum,
  isEnabled,
} from './index';

const repo = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ev = { sourceId: 'src-1', url: 'https://example.org/a', capturadoEm: '2026-11-22T10:00:00-03:00', sha256: 'a'.repeat(64) };
const baseArticle = {
  id: 'a1',
  slug: 'teste-de-materia',
  titulo: 'Título',
  editoria: 'pontos',
  status: 'rascunho',
  assinatura: ASSINATURA,
  corpo: 'Corpo.',
  fontes: [ev],
  versao: 1,
};

describe('editorias', () => {
  it('são as 10 do Blueprint, com slugs únicos', () => {
    expect(EDITORIAS).toHaveLength(10);
    expect(new Set(EDITORIAS.map((e) => e.slug)).size).toBe(10);
  });
});

describe('formatos comerciais', () => {
  it('são 47, válidos, únicos e indisponíveis por padrão', () => {
    expect(AD_FORMATS).toHaveLength(47);
    for (const f of AD_FORMATS) AdFormat.parse(f);
    expect(new Set(AD_FORMATS.map((f) => f.id)).size).toBe(47);
    expect(AD_FORMATS.every((f) => f.disponibilidade === 'indisponivel')).toBe(true);
    const porSecao = AD_FORMATS.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.secao]: (acc[f.secao] ?? 0) + 1 }), {});
    expect(porSecao['Banners']).toBe(8);
    expect(porSecao['Eventos']).toBe(7);
  });
});

describe('matéria', () => {
  it('aceita a assinatura institucional e recusa outra', () => {
    expect(Article.safeParse(baseArticle).success).toBe(true);
    expect(Article.safeParse({ ...baseArticle, assinatura: 'Fulano de Tal' }).success).toBe(false);
  });
  it('exige ao menos uma fonte', () => {
    expect(Article.safeParse({ ...baseArticle, fontes: [] }).success).toBe(false);
  });
  it('conteúdo patrocinado exige rótulo', () => {
    expect(Article.safeParse({ ...baseArticle, patrocinado: true }).success).toBe(false);
    expect(Article.safeParse({ ...baseArticle, patrocinado: true, rotuloPublieditorial: 'Conteúdo patrocinado' }).success).toBe(true);
  });
  it('não publica imagem sem base de direito', () => {
    const img = {
      url: 'https://example.org/i.jpg',
      origem: 'fonte_terceiro',
      credito: 'Fonte X',
      link: 'https://example.org',
      baseDeDireito: 'pendente',
      textoAlternativo: 'descrição',
    };
    expect(Article.safeParse({ ...baseArticle, status: 'publicado', imagem: img }).success).toBe(false);
    expect(Article.safeParse({ ...baseArticle, status: 'rascunho', imagem: img }).success).toBe(true);
    expect(Article.safeParse({ ...baseArticle, status: 'rascunho', imagem: { ...img, link: undefined } }).success).toBe(false);
  });
});

describe('pessoa (P4)', () => {
  it('aceita só nome, cargo, empresa e fonte', () => {
    const p = { id: 'p1', nome: 'Nome', cargo: 'CEO', empresaId: 'c1', fonte: ev };
    expect(Person.safeParse(p).success).toBe(true);
    expect(Person.safeParse({ ...p, email: 'x@y.com' }).success).toBe(false);
    expect(Person.safeParse({ ...p, telefone: '11999999999' }).success).toBe(false);
  });
});

describe('registros oficiais da organização', () => {
  const load = (f: string) => JSON.parse(readFileSync(repo(`contracts/${f}`), 'utf-8'));
  it('64 perfis de agente validam', () => {
    const agents = load('agents.registry.json').agents;
    expect(agents).toHaveLength(64);
    for (const a of agents) AgentProfile.parse(a);
  });
  it('19 workflows validam', () => {
    const wfs = load('workflows.registry.json').workflows;
    expect(wfs).toHaveLength(19);
    for (const w of wfs) Workflow.parse(w);
  });
  it('28 rituais validam, com quórum máx(2, ⌈2n/3⌉)', () => {
    const ms = load('meetings.registry.json').meetings;
    expect(ms).toHaveLength(28);
    for (const m of ms) Ritual.parse(m);
    expect(expectedQuorum(2)).toBe(2);
    expect(expectedQuorum(12)).toBe(8);
  });
});

describe('orçamento', () => {
  it('teto de US$ 50 e divisão somando 50', () => {
    expect(HARD_MONTHLY_CAP_MICROUSD).toBe(50_000_000);
    const a = BUDGET_ALLOCATION_MICROUSD;
    expect(a.openai + a.anthropic + a.images + a.deepseek + a.auditErrataReserve).toBe(HARD_MONTHLY_CAP_MICROUSD);
  });
  it('reserva conciliada exige custo real e generation id', () => {
    const r = {
      id: 'r1',
      taskId: 't1',
      idempotencyKey: 'chave-0001',
      monthKey: '2026-11',
      route: 'review',
      provider: 'openai',
      model: 'openai/gpt-6.1-terra',
      maxEstimatedMicrousd: 30_000,
      state: 'conciliada',
      reservedAt: '2026-11-22T10:00:00-03:00',
    };
    expect(BudgetReservation.safeParse(r).success).toBe(false);
    expect(BudgetReservation.safeParse({ ...r, actualMicrousd: 21_000, generationId: 'gen-1' }).success).toBe(true);
  });
});

describe('flags', () => {
  it('todas desligadas por padrão', () => {
    expect(Object.values(FLAG_DEFAULTS).every((v) => v === false)).toBe(true);
    expect(isEnabled('instagram')).toBe(false);
    expect(isEnabled('theLoyal', { theLoyal: true })).toBe(true);
  });
});

describe('envelope de erro', () => {
  it('valida o código', () => {
    expect(apiError('NOT_FOUND', 'não encontrado').error.code).toBe('NOT_FOUND');
    expect(() => apiError('minusculo', 'x')).toThrow();
  });
});
