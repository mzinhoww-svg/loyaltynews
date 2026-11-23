import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiSlice, isRawEvent, mapEvent } from '../app/(portal)/_lib/api-source';
import { eventWhen, eventWhere, isUpcoming, noon } from '../app/(portal)/_lib/events';

// Formato de GET /api/publico/agenda (apps/web/app/api/_lib/agenda.ts, publicView): só o que o Studio publica.
const raw = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  titulo: 'Congresso de teste',
  inicio: '2026-12-04',
  fim: '2026-12-05',
  local: 'São Paulo',
  url: 'https://evento.example/a',
  editorias: ['bancos'],
  patrocinado: false,
  fonteUrl: 'https://fonte.example/evento',
  ...over,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('agenda pública: formato e mapeamento', () => {
  it('mapeia só o que o Studio publica e NÃO inventa organizador, modalidade, fuso nem preço', () => {
    const ev = mapEvent(raw() as never);
    expect(ev).toMatchObject({ slug: 'ev-1', title: 'Congresso de teste', startsAt: '2026-12-04', endsAt: '2026-12-05', place: 'São Paulo', status: 'validado', sponsored: false, dateOnly: true });
    expect(ev.officialUrl).toBe('https://evento.example/a');
    expect(ev.sourceUrl).toBe('https://fonte.example/evento');
    expect(ev.organizer).toBeUndefined();
    expect(ev.online).toBeUndefined();
    expect(ev.timezone).toBeUndefined();
    expect(ev.priceNote).toBeUndefined();
    expect(ev.mock).toBeUndefined();
  });

  it('link fora de http(s) ou ausente é descartado; patrocínio só se for true', () => {
    expect(mapEvent(raw({ url: 'javascript:alert(1)', fonteUrl: 'ftp://x' }) as never)).toMatchObject({ officialUrl: undefined, sourceUrl: undefined });
    expect(mapEvent(raw({ url: null, fonteUrl: null, patrocinado: 'sim' }) as never)).toMatchObject({ officialUrl: undefined, sponsored: false });
    expect(mapEvent(raw({ patrocinado: true }) as never).sponsored).toBe(true);
  });

  it('valida itens: id, título, local e datas obrigatórios', () => {
    expect(isRawEvent(raw())).toBe(true);
    for (const bad of [null, 'x', raw({ id: '' }), raw({ titulo: 3 }), raw({ local: '' }), raw({ inicio: 'ontem' }), raw({ fim: '2026-13-45' }), raw({ inicio: undefined })]) {
      expect(isRawEvent(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('agenda pública: leitura da API', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('listEvents: devolve os eventos válidos e descarta os malformados', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ data: [raw(), null, raw({ id: 'ev-2', inicio: 'x' }), raw({ id: 'ev-3', titulo: 'Outro' })] }));
    const r = await createApiSlice('http://api.test/', f as unknown as typeof fetch).listEvents();
    expect(r.unavailable).toBeUndefined();
    expect(r.items.map((e) => e.slug)).toEqual(['ev-1', 'ev-3']);
    expect(String(f.mock.calls[0]![0])).toBe('http://api.test/api/publico/agenda');
    expect(f.mock.calls[0]![1]).toMatchObject({ cache: 'no-store' });
  });

  it('agenda legitimamente vazia NÃO é indisponível', async () => {
    const r = await createApiSlice('http://api.test', (async () => json({ data: [] })) as unknown as typeof fetch).listEvents();
    expect(r).toEqual({ items: [] });
  });

  it('falhas (rede, 503, JSON inválido, formato) = indisponível, sem lançar e sem vazar detalhes no log', async () => {
    const casos: typeof fetch[] = [
      (async () => { throw new TypeError('fetch failed http://segredo.interno:9/x'); }) as never,
      (async () => json({ error: { message: 'detalhe interno' } }, 503)) as never,
      (async () => new Response('<html>', { status: 200 })) as never,
      (async () => json({ data: 'não é lista' })) as never,
    ];
    for (const f of casos) {
      const api = createApiSlice('http://api.test', f);
      expect(await api.listEvents()).toEqual({ items: [], unavailable: true });
    }
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/segredo|detalhe interno|api\.test/);
  });

  it('getEvent: usa a rota por id quando existe (evento já encerrado também)', async () => {
    const f = vi.fn(async (url: string | URL | Request) => (String(url).endsWith('/api/publico/agenda/ev-9') ? json({ data: raw({ id: 'ev-9', inicio: '2026-01-10', fim: '2026-01-11' }) }) : json({ data: [] })));
    const r = await createApiSlice('http://api.test', f as unknown as typeof fetch).getEvent('ev-9');
    expect(r.event?.slug).toBe('ev-9');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('getEvent: sem a rota por id (404), procura na lista pública', async () => {
    const f = vi.fn(async (url: string | URL | Request) => (String(url).endsWith('/agenda') ? json({ data: [raw()] }) : json({ error: { code: 'NOT_FOUND' } }, 404)));
    const api = createApiSlice('http://api.test', f as unknown as typeof fetch);
    expect((await api.getEvent('ev-1')).event?.title).toBe('Congresso de teste');
    expect(await api.getEvent('nao-existe')).toEqual({ event: null, unavailable: undefined });
  });

  it('getEvent: resposta da rota por id com id diferente é ignorada; id da URL é codificado', async () => {
    const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => (String(url).includes('/agenda/') ? json({ data: raw({ id: 'outro' }) }) : json({ data: [] })));
    const r = await createApiSlice('http://api.test', f as unknown as typeof fetch).getEvent('a/b?c');
    expect(r.event).toBeNull();
    expect(String(f.mock.calls[0]![0])).toBe('http://api.test/api/publico/agenda/a%2Fb%3Fc');
  });

  it('getEvent com a API fora: indisponível (não é 404)', async () => {
    const api = createApiSlice('http://api.test', (async () => json({}, 500)) as unknown as typeof fetch);
    expect(await api.getEvent('ev-1')).toEqual({ event: null, unavailable: true });
  });
});

describe('formatação de eventos só com data', () => {
  const ev = (over = {}) => mapEvent(raw(over) as never);

  it('meio-dia de Brasília: a data não vira o dia anterior', () => {
    expect(noon('2026-12-04')).toBe('2026-12-04T12:00:00-03:00');
    expect(noon('2026-12-04T09:00:00-03:00')).toBe('2026-12-04T09:00:00-03:00');
    expect(eventWhen(ev({ fim: '2026-12-04' }))).toBe('04 de dez. de 2026');
  });

  it('intervalo mostra início e fim; sem hora inventada', () => {
    const t = eventWhen(ev());
    expect(t).toMatch(/04/);
    expect(t).toMatch(/ a 05/);
    expect(t).not.toMatch(/\d{2}:\d{2}/);
  });

  it('onde: só o que a fonte informa', () => {
    expect(eventWhere(ev())).toBe('São Paulo');
    expect(eventWhere({ ...ev(), place: undefined })).toBe('Local a confirmar');
    expect(eventWhere({ ...ev(), online: true })).toBe('Online');
  });

  it('próximo: evento de hoje (só data) ainda conta até o fim do dia; encerrado não', () => {
    const e = ev({ inicio: '2026-12-04', fim: '2026-12-04' });
    expect(isUpcoming(e, new Date('2026-12-04T22:00:00-03:00'))).toBe(true);
    expect(isUpcoming(e, new Date('2026-12-05T00:30:00-03:00'))).toBe(false);
    expect(isUpcoming(ev({ inicio: '2026-12-04', fim: '2026-12-06' }), new Date('2026-12-05T10:00:00-03:00'))).toBe(true);
  });
});
