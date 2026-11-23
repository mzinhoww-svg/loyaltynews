import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MetricStore, createCommercialState, makeCtx, mediaKitPage } from '@ln/commercial';
import { coverageCards, fetchMediaKit, parseMediaKit, portalApiBase } from '../app/(portal)/_lib/commercial-source';

const NOW = '2026-12-05T12:00:00-03:00';
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** Resposta REAL de GET /api/commercial/mediakit (handler do @ln/commercial), passando por JSON como na rede. */
const realPayload = (store?: MetricStore) => {
  const state = createCommercialState();
  if (store) state.metrics = store;
  return wire(mediaKitPage(makeCtx(state, { now: NOW })));
};

describe('parseMediaKit: contrato com a API comercial', () => {
  it('lê a resposta real: 47 formatos, status válidos, audiência toda indisponível sem coleta', () => {
    const kit = parseMediaKit(realPayload());
    expect(kit).not.toBeNull();
    expect(kit!.formats).toHaveLength(47);
    expect(kit!.formats.find((f) => f.id === 'banners--banner-topo')).toMatchObject({ name: 'Banner topo', price: 'R$ 3.000/mês', status: 'sob_consulta' });
    for (const m of [...kit!.audience.realtime, ...kit!.audience.historical]) expect(m).toMatchObject({ value: null, state: 'unavailable' });
    expect(kit!.integrityNote).toBeNull();
    expect(kit!.generatedAt).toBe(NOW);
  });
  it('métrica real chega com valor, origem, janela e data da coleta', () => {
    const store = new MetricStore();
    store.ingest({ source: 'ga4_report', metric: 'sessions_30d', value: 1234, period_start: '2026-11-05T00:00:00-03:00', period_end: '2026-12-04T23:59:59-03:00', fetched_at: '2026-12-05T08:00:00-03:00' });
    const m = parseMediaKit(realPayload(store))!.audience.historical.find((x) => x.label.startsWith('Sessões'))!;
    expect(m).toEqual({ label: 'Sessões (30 dias)', value: '1.234', state: 'ok', source: 'GA4', window: '05/11/2026 a 04/12/2026', collectedAt: '2026-12-05T08:00:00-03:00' });
  });
  it('lacuna de auditabilidade da entrega vira o aviso do mídia kit', () => {
    const state = createCommercialState();
    state.ads.audit.reportLoss({ detectedAtMs: Date.parse(NOW), reason: 'dedupe_perdido' });
    expect(parseMediaKit(wire(mediaKitPage(makeCtx(state, { now: NOW }))))!.integrityNote).toMatch(/não auditáve/);
  });
  it('payload fora do formato derruba a leitura inteira (null), nunca um número solto', () => {
    const ok = realPayload();
    const mutate = (fn: (p: any) => void) => { const p = wire(ok) as any; fn(p); return parseMediaKit(p); }; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(parseMediaKit(null)).toBeNull();
    expect(parseMediaKit('x')).toBeNull();
    expect(parseMediaKit([])).toBeNull();
    expect(parseMediaKit({})).toBeNull();
    expect(mutate((p) => { delete p.audience; })).toBeNull();
    expect(mutate((p) => { p.audience.realtime[0].state = 'ok'; })).toBeNull();                       // "ok" sem valor
    expect(mutate((p) => { p.audience.historical[0].value = '99'; })).toBeNull();                     // valor com estado "unavailable"
    expect(mutate((p) => { p.audience.historical[0].value = '99'; p.audience.historical[0].state = 'ok'; })).toBeNull(); // valor sem data de coleta
    expect(mutate((p) => { p.audience.historical[0].state = 'inventado'; })).toBeNull();
    expect(mutate((p) => { p.audience.historical[0].value = 99; p.audience.historical[0].state = 'ok'; p.audience.historical[0].collectedAt = NOW; })).toBeNull(); // número cru, não texto
    expect(mutate((p) => { p.blocks.catalogo.formats[0].status = 'ativo'; })).toBeNull();
    expect(mutate((p) => { p.blocks.catalogo.formats[0].price = ''; })).toBeNull();
    expect(mutate((p) => { p.blocks.catalogo.formats = new Array(201).fill(p.blocks.catalogo.formats[0]); })).toBeNull();
    expect(mutate((p) => { delete p.generatedAt; })).toBeNull();
  });
  it('não repassa campos internos da API (motivo de status, capacidade, posições)', () => {
    const kit = parseMediaKit(realPayload())!;
    expect(Object.keys(kit).sort()).toEqual(['audience', 'formats', 'generatedAt', 'integrityNote']);
    expect(Object.keys(kit.formats[0]!).sort()).toEqual(['id', 'name', 'price', 'scope', 'section', 'status']);
  });
});

describe('fetchMediaKit', () => {
  const okFetch = (body: unknown, init: Partial<Response> = {}) => vi.fn(async () => ({ ok: true, status: 200, json: async () => body, ...init }) as Response);
  it('busca na rota pública do Backend, sem credenciais, e devolve o mídia kit', async () => {
    const f = okFetch(realPayload());
    const kit = await fetchMediaKit('http://127.0.0.1:3000/', f as unknown as typeof fetch);
    expect(kit!.formats).toHaveLength(47);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3000/api/commercial/mediakit');
    expect(init.credentials).toBeUndefined(); expect(init.method).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('falhas viram null: status não-2xx, rede, JSON inválido, formato inválido', async () => {
    expect(await fetchMediaKit('http://x', okFetch({}, { ok: false, status: 503 }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchMediaKit('http://x', vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchMediaKit('http://x', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) as unknown as Response) as unknown as typeof fetch)).toBeNull();
    expect(await fetchMediaKit('http://x', okFetch({ audience: 1 }) as unknown as typeof fetch)).toBeNull();
  });
});

describe('coverageCards (auditoria V-05)', () => {
  const base = { articles: 20, events: 2, editorias: 10, now: NOW };
  const by = (cards: ReturnType<typeof coverageCards>, key: string) => cards.find((c) => c.key === key)!;
  it('fonte de demonstração: número com selo MOCK e origem "Demonstração", sem data de consulta', () => {
    const cards = coverageCards({ kind: 'mock', ...base });
    expect(by(cards, 'articles')).toMatchObject({ value: '20', mock: true, origin: 'Demonstração', checkedAt: null });
    expect(by(cards, 'events')).toMatchObject({ value: '2', mock: true, origin: 'Demonstração', checkedAt: null });
  });
  it('fonte real com contagem: número com origem e horário da consulta, sem selo MOCK', () => {
    const cards = coverageCards({ kind: 'api', ...base });
    expect(by(cards, 'articles')).toMatchObject({ value: '20', mock: false, origin: 'CMS', checkedAt: NOW });
    expect(by(cards, 'events')).toMatchObject({ value: '2', mock: false, origin: 'Agenda', checkedAt: NOW });
  });
  it('sem dado real: "—" (value null), sem data, sem selo (estado vazio honesto)', () => {
    for (const kind of ['empty', 'api', 'mock'] as const) {
      const cards = coverageCards({ kind, ...base, articles: 0, events: 0 });
      for (const k of ['articles', 'events']) expect(by(cards, k)).toMatchObject({ value: null, mock: false, checkedAt: null });
    }
  });
  it('editorias é taxonomia do projeto: sempre o número do portal, nunca marcada como mock', () => {
    for (const kind of ['empty', 'mock', 'api'] as const) expect(by(coverageCards({ kind, ...base }), 'editorias')).toMatchObject({ value: '10', mock: false, origin: 'Taxonomia do portal' });
  });
  it('nenhum cartão mostra número de demonstração sem selo, em nenhuma combinação', () => {
    for (const kind of ['empty', 'mock', 'api'] as const) for (const n of [0, 1, 20]) {
      for (const c of coverageCards({ kind, articles: n, events: n, editorias: 10, now: NOW })) {
        if (kind === 'mock' && c.value !== null && c.key !== 'editorias') expect(c.mock).toBe(true);
        if (kind !== 'mock') expect(c.mock).toBe(false);
      }
    }
  });
});

describe('portalApiBase', () => {
  it('usa PORTAL_API_BASE_URL ou o próprio servidor', () => {
    expect(portalApiBase({ PORTAL_API_BASE_URL: 'https://api.example' })).toBe('https://api.example');
    expect(portalApiBase({ PORT: '3100' })).toBe('http://127.0.0.1:3100');
    expect(portalApiBase({})).toBe('http://127.0.0.1:3000');
  });
});

// ---------- V-04: contraste dos botões do bloco escuro ----------
const hex = (css: string, name: string): string => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)![1]!;
const lum = (h: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe('botões sobre o bloco escuro do mídia kit (auditoria V-04)', () => {
  const tokens = readFileSync(new URL('../../../packages/ui/src/tokens/tokens.css', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/(portal)/portal.css', import.meta.url), 'utf8');
  const primary = hex(tokens, 'ln-color-primary'); const white = hex(tokens, 'ln-color-white'); const mint = hex(tokens, 'ln-color-mint');
  const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  it('o fundo do bloco é a cor primária (o motivo do bug: botões herdavam a mesma cor)', () => {
    expect(rule('.pt-hero-band')).toContain('background: var(--ln-color-primary)');
  });
  it('primário: fundo claro com texto escuro, contraste ≥ 4,5:1 e distinto do fundo do bloco', () => {
    const body = /\.pt-hero-band a\.ln-btn--primary, \.ln-root \.pt-hero-band a\.ln-btn--primary \{([^}]*)\}/.exec(css)![1]!;
    expect(body).toContain('background: var(--ln-color-white)'); expect(body).toContain('color: var(--ln-color-primary)');
    expect(ratio(white, primary)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(primary, primary)).toBe(1); // o bug: botão e bloco com a mesma cor = contraste 1:1
  });
  it('secundário: transparente com texto e contorno brancos (≥ 4,5:1 sobre o bloco)', () => {
    const body = /\.pt-hero-band a\.ln-btn--ghost, \.ln-root \.pt-hero-band a\.ln-btn--ghost \{([^}]*)\}/.exec(css)![1]!;
    expect(body).toContain('background: transparent'); expect(body).toContain('color: var(--ln-color-white)'); expect(body).toContain('border-color: var(--ln-color-white)');
    expect(ratio(white, primary)).toBeGreaterThanOrEqual(4.5);
  });
  it('hover mantém contraste (primário em menta; secundário sobre o bloco) e o foco é visível em branco', () => {
    expect(ratio(primary, mint)).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/\.pt-hero-band a\.ln-btn:focus-visible[^{]*\{[^}]*outline: 3px solid var\(--ln-color-white\)/);
  });
  it('as regras valem com a especificidade do tema (.ln-root a.ln-btn--*), para não serem anuladas', () => {
    expect(css).toContain('.ln-root .pt-hero-band a.ln-btn--primary');
    expect(css).toContain('.ln-root .pt-hero-band a.ln-btn--ghost');
  });
});
