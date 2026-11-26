import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MetricStore, createCommercialState, makeCtx, mediaKitPage } from '@ln/commercial';
import { apiCoverageCards, coverageCards, fetchMediaKit, isDemoMarked, parseMediaKit, portalApiBase } from '../app/(portal)/_lib/commercial-source';

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
    expect(kit!.formats.find((f) => f.id === 'banners--banner-topo')).toMatchObject({ name: 'Banner topo', price: 'R$ 1.200/mês', status: 'sob_consulta' });
    for (const m of [...kit!.audience.realtime, ...kit!.audience.historical]) expect(m).toMatchObject({ value: null, state: 'unavailable' });
    expect(kit!.integrityNote).toBeNull();
    expect(kit!.generatedAt).toBe(NOW);
    expect(kit!.coverage.map((m) => m.id)).toEqual(['articles_published_30d', 'articles_published_90d', 'upcoming_events']);
    for (const m of kit!.coverage) expect(m).toMatchObject({ value: null, state: 'unavailable' });
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
    expect(Object.keys(kit).sort()).toEqual(['audience', 'coverage', 'formats', 'generatedAt', 'integrityNote', 'positions']);
    expect(Object.keys(kit.formats[0]!).sort()).toEqual(['id', 'name', 'price', 'ressalva', 'scope', 'section', 'status']);
  });
  it('DP-54: formato disponível com canal desligado traz a ressalva da API; ausente = null', () => {
    const ok = realPayload();
    const p = wire(ok) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    p.blocks.catalogo.formats[0].status = 'disponivel';
    p.blocks.catalogo.formats[0].ressalva = 'Ressalva: a entrega só começa com o canal ativo; hoje não há entrega.';
    const kit = parseMediaKit(p)!;
    expect(kit.formats[0]).toMatchObject({ status: 'disponivel', ressalva: 'Ressalva: a entrega só começa com o canal ativo; hoje não há entrega.' });
    // Sem a ressalva no dado, o campo fica null — o portal não inventa texto.
    const sem = parseMediaKit(wire(realPayload()))!;
    expect(sem.formats.every((f) => f.ressalva === null)).toBe(true);
  });
  it('ressalva vazia, null ou ausente não derruba o kit: o formato sai sem ressalva e a tabela renderiza', () => {
    const comRessalva = (v: unknown) => {
      const p = wire(realPayload()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      p.blocks.catalogo.formats[0].ressalva = v;
      return parseMediaKit(p);
    };
    // P3 do QA 8: campo opcional vazio zerava a tabela inteira. Os três casos mantêm o kit e só ignoram a ressalva.
    for (const v of ['', '   ', null, undefined]) {
      const kit = comRessalva(v);
      expect(kit, `ressalva ${JSON.stringify(v)}`).not.toBeNull();
      expect(kit!.formats).toHaveLength(47);
      expect(kit!.formats[0]!.ressalva).toBeNull();
    }
    // Tipo errado ou texto acima do teto também é ignorado, sem descartar o kit.
    for (const v of [42, 'x'.repeat(301)]) {
      const kit = comRessalva(v);
      expect(kit).not.toBeNull();
      expect(kit!.formats[0]!.ressalva).toBeNull();
    }
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

describe('coverageCards: fontes que não são a API (auditoria V-05)', () => {
  const base = { articles: 20, events: 2, editorias: 10 };
  const by = (cards: ReturnType<typeof coverageCards>, key: string) => cards.find((c) => c.key === key)!;
  it('fonte de demonstração: número com selo MOCK e origem "Demonstração", sem data de coleta', () => {
    const cards = coverageCards({ kind: 'mock', ...base });
    expect(by(cards, 'articles')).toMatchObject({ value: '20', mock: true, origin: 'Demonstração', checkedAt: null });
    expect(by(cards, 'events')).toMatchObject({ value: '2', mock: true, origin: 'Demonstração', checkedAt: null });
  });
  it('fonte vazia (ou api, por engano): nunca mostra a contagem ao vivo, só "—" (em staging ela inclui o seed)', () => {
    for (const kind of ['empty', 'api'] as const) {
      const cards = coverageCards({ kind, ...base });
      for (const k of ['articles', 'events']) expect(by(cards, k)).toMatchObject({ value: null, mock: false, checkedAt: null });
    }
  });
  it('sem dado: "—" e sem selo, também na vitrine', () => {
    const cards = coverageCards({ kind: 'mock', ...base, articles: 0, events: 0 });
    for (const k of ['articles', 'events']) expect(by(cards, k)).toMatchObject({ value: null, mock: false });
  });
  it('editorias é taxonomia do projeto: sempre o número do portal, nunca marcada como mock', () => {
    for (const kind of ['empty', 'mock', 'api'] as const) expect(by(coverageCards({ kind, ...base }), 'editorias')).toMatchObject({ value: '10', mock: false, origin: 'Taxonomia do portal' });
  });
});

describe('demonstração na resposta da API: "—" e "sem dado real"', () => {
  const metric = (over: Record<string, unknown> = {}) => ({ id: 'articles_published_30d', label: 'Matérias publicadas (30 dias)', value: '12', state: 'ok', source: 'CMS', window: '05/11/2026 a 04/12/2026', collectedAt: NOW, ...over });
  const withCoverage = (m: Record<string, unknown>[]) => { const p = wire(realPayload()) as any; p.coverage = m; return p; }; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('detecta a marca em id, rótulo, origem, janela e nos campos booleanos', () => {
    for (const over of [{ id: 'seed-stg-metric' }, { label: '[DEMO · staging] Matérias' }, { source: 'CMS [DEMO · staging]' }, { window: 'seed-stg-2026' }, { label: 'Dados de demonstração' }, { demo: true }, { mock: true }, { isMock: true }, { isDemo: true }]) {
      expect(isDemoMarked(metric(over)), JSON.stringify(over)).toBe(true);
    }
    expect(isDemoMarked(metric())).toBe(false);
    expect(isDemoMarked(metric({ label: 'Matérias publicadas', source: 'CMS' }))).toBe(false);
  });
  it('métrica marcada como demo perde o número, a janela e a data: vira indisponível, e o rótulo sai limpo', () => {
    const kit = parseMediaKit(withCoverage([metric({ label: '[DEMO · staging] Matérias publicadas (30 dias)', value: '20' })]))!;
    expect(kit.coverage).toEqual([{ id: 'articles_published_30d', label: 'Matérias publicadas (30 dias)', value: null, state: 'unavailable', source: 'CMS' }]);
    expect(JSON.stringify(kit)).not.toMatch(/DEMO|seed-stg/);
  });
  it('vale para qualquer marca e também na audiência', () => {
    for (const over of [{ demo: true }, { mock: true }, { id: 'seed-stg-x' }, { source: 'seed-stg-ga4' }]) {
      const kit = parseMediaKit(withCoverage([metric(over)]))!;
      expect(kit.coverage[0]).toMatchObject({ value: null, state: 'unavailable' });
      expect(kit.coverage[0]!.collectedAt).toBeUndefined(); expect(kit.coverage[0]!.window).toBeUndefined();
    }
    const p = withCoverage([]);
    p.audience.historical[0] = { label: 'Sessões (30 dias)', value: '999', state: 'ok', source: 'GA4', window: 'x', collectedAt: NOW, demo: true };
    expect(parseMediaKit(p)!.audience.historical[0]).toMatchObject({ value: null, state: 'unavailable' });
  });
  it('uma métrica real ao lado da demo continua real', () => {
    const kit = parseMediaKit(withCoverage([metric(), metric({ id: 'articles_published_90d', label: 'Matérias publicadas (90 dias)', value: '40', demo: true })]))!;
    expect(kit.coverage[0]).toMatchObject({ value: '12', state: 'ok' });
    expect(kit.coverage[1]).toMatchObject({ value: null, state: 'unavailable' });
  });
  it('métrica demo sem origem/rótulo válidos ainda derruba a leitura (formato inválido)', () => {
    expect(parseMediaKit(withCoverage([{ id: 'x', demo: true }]))).toBeNull();
  });
});

describe('apiCoverageCards: cobertura só da coleta da API', () => {
  const metric = (over: Record<string, unknown> = {}) => ({ id: 'articles_published_30d', label: 'Matérias publicadas (30 dias)', value: '12', state: 'ok', source: 'CMS', window: '05/11/2026 a 04/12/2026', collectedAt: NOW, ...over });
  const kitWith = (m: Record<string, unknown>[]) => { const p = wire(realPayload()) as any; p.coverage = m; return parseMediaKit(p); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const by = (cards: ReturnType<typeof apiCoverageCards>, key: string) => cards.find((c) => c.key === key)!;

  it('métrica coletada: valor com origem, janela e data da coleta, sem selo', () => {
    const c = by(apiCoverageCards(kitWith([metric()]), 10), 'articles');
    expect(c).toMatchObject({ label: 'Matérias publicadas (30 dias)', value: '12', origin: 'CMS', window: '05/11/2026 a 04/12/2026', checkedAt: NOW, mock: false });
    expect(c.stale).toBeUndefined();
  });
  it('desatualizada: aparece marcada como tal', () => {
    expect(by(apiCoverageCards(kitWith([metric({ state: 'stale' })]), 10), 'articles').stale).toBe(true);
  });
  it('sem coleta, sem API (null) ou sem a métrica: "—", sem data e sem janela', () => {
    for (const kit of [null, kitWith([]), kitWith([metric({ value: null, state: 'unavailable', window: undefined, collectedAt: undefined })])]) {
      const cards = apiCoverageCards(kit, 10);
      for (const k of ['articles', 'articles90', 'events']) expect(by(cards, k)).toMatchObject({ value: null, checkedAt: null, mock: false });
      expect(by(cards, 'articles').window).toBeUndefined();
    }
  });
  it('métrica marcada como demo (seed de staging): "—" mesmo que a API mande um número', () => {
    const kit = kitWith([metric({ value: '20', label: '[DEMO · staging] Matérias publicadas (30 dias)' })]);
    expect(by(apiCoverageCards(kit, 10), 'articles')).toMatchObject({ value: null, checkedAt: null, mock: false });
  });
  it('a contagem ao vivo da listagem pública não entra: a função nem a recebe', () => {
    expect(apiCoverageCards.length).toBe(2);
  });
  it('editorias é sempre a taxonomia do portal', () => {
    expect(by(apiCoverageCards(null, 10), 'editorias')).toMatchObject({ value: '10', origin: 'Taxonomia do portal', mock: false });
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
