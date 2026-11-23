import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiSlice } from '../app/(portal)/_lib/api-source';

// Itens no formato de GET /api/publico/materias (cartão público).
const item = (slug: string, tipo: string, over: Record<string, unknown> = {}) => ({
  slug, titulo: `Título ${slug}`, subtitulo: null, resumo: 'Resumo.', tipoConteudo: tipo, tempoLeituraMin: 1, editoria: 'bancos',
  assinatura: 'Redação', patrocinado: false, rotuloPublieditorial: null, publicadoEm: '2026-11-20T10:00:00-03:00', corrigida: false, imagem: null, ...over,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => new URL(String(c[0]), 'http://x').searchParams);

describe('tipos de matéria lidos da API (`tipo`)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('API que respeita `tipo`: usa a página e o total do servidor (sem limite de 100)', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => json({ data: [item('f1', 'flash'), item('f2', 'flash')], total: 250, limit: 12, offset: 24 }));
    const r = await createApiSlice('http://api.test', f as unknown as typeof fetch).getLatest({ contentType: 'flash', page: 3, pageSize: 12 });
    expect(r).toMatchObject({ page: 3, pageSize: 12, total: 250 });
    expect(r.items.map((a) => a.slug)).toEqual(['f1', 'f2']);
    expect(f).toHaveBeenCalledTimes(1);
    const q = calls(f)[0]!;
    expect(q.get('tipo')).toBe('flash');
    expect(q.get('limit')).toBe('12');
    expect(q.get('offset')).toBe('24');
  });

  it('combina com a editoria', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => json({ data: [], total: 0 }));
    await createApiSlice('http://api.test', f as unknown as typeof fetch).getLatest({ contentType: 'analise', editoriaSlug: 'bancos' });
    const q = calls(f)[0]!;
    expect([q.get('tipo'), q.get('editoria')]).toEqual(['analise', 'bancos']);
  });

  it('tipo sem matérias é vazio legítimo, não erro', async () => {
    const f = vi.fn(async () => json({ data: [], total: 0 }));
    const r = await createApiSlice('http://api.test', f as unknown as typeof fetch).getLatest({ contentType: 'opiniao' });
    expect(r).toEqual({ items: [], page: 1, pageSize: 12, total: 0 });
    expect(r.unavailable).toBeUndefined();
  });

  it('API antiga que IGNORA `tipo` (itens de outros tipos): cai no filtro local das 100 mais recentes, sem listar tipo errado', async () => {
    const all = [item('n1', 'noticia'), item('f1', 'flash'), item('a1', 'analise'), item('f2', 'flash')];
    const f = vi.fn(async (u: string | URL | Request, _i?: RequestInit) => {
      const p = new URL(String(u), 'http://x').searchParams;
      return p.get('limit') === '100' ? json({ data: all, total: 4 }) : json({ data: all.slice(0, 2), total: 4 }); // ignora `tipo`
    });
    const r = await createApiSlice('http://api.test', f as unknown as typeof fetch).getLatest({ contentType: 'flash' });
    expect(r.items.map((a) => a.slug)).toEqual(['f1', 'f2']);
    expect(r.total).toBe(2);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('falha da API em qualquer tipo = indisponível (erro), nunca vazio', async () => {
    for (const make of [
      () => vi.fn(async () => json({}, 503)),
      () => vi.fn(async () => { throw new TypeError('fetch failed'); }),
      () => vi.fn(async () => new Response('<html>', { status: 200 })),
    ]) {
      const r = await createApiSlice('http://api.test', make() as unknown as typeof fetch).getLatest({ contentType: 'entrevista' });
      expect(r).toMatchObject({ items: [], total: 0, unavailable: true });
    }
  });

  it('422 (tipo recusado pelo servidor) = indisponível, sem lançar', async () => {
    const f = vi.fn(async () => json({ error: { code: 'VALIDATION_ERROR' } }, 422));
    expect(await createApiSlice('http://api.test', f as unknown as typeof fetch).getLatest({ contentType: 'flash' })).toMatchObject({ unavailable: true });
  });
});

describe('busca real', () => {
  it('manda o termo à API (até 100 caracteres), com paginação do servidor', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => json({ data: [item('a', 'noticia')], total: 31 }));
    const api = createApiSlice('http://api.test', f as unknown as typeof fetch);
    const r = await api.search(`  ${'x'.repeat(150)}  `, 2);
    expect(r).toMatchObject({ page: 2, total: 31 });
    const q = calls(f)[0]!;
    expect(q.get('q')).toBe('x'.repeat(100));
    expect(q.get('offset')).toBe('12');
    expect(q.get('limit')).toBe('12');
  });

  it('termo vazio não chama a API', async () => {
    const f = vi.fn(async () => json({ data: [], total: 0 }));
    const r = await createApiSlice('http://api.test', f as unknown as typeof fetch).search('   ');
    expect(r).toMatchObject({ items: [], total: 0 });
    expect(f).not.toHaveBeenCalled();
  });

  it('falha = indisponível; sem resultado = vazio legítimo', async () => {
    const down = createApiSlice('http://api.test', (async () => json({}, 500)) as unknown as typeof fetch);
    expect((await down.search('pix')).unavailable).toBe(true);
    const empty = createApiSlice('http://api.test', (async () => json({ data: [], total: 0 })) as unknown as typeof fetch);
    expect(await empty.search('pix')).toMatchObject({ items: [], total: 0 });
    expect((await empty.search('pix')).unavailable).toBeUndefined();
  });

  it('termo com caracteres especiais vai codificado na URL (sem injetar parâmetros)', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => json({ data: [], total: 0 }));
    await createApiSlice('http://api.test', f as unknown as typeof fetch).search('a&tipo=flash#x 100%');
    const q = calls(f)[0]!;
    expect(q.get('q')).toBe('a&tipo=flash#x 100%');
    expect(q.get('tipo')).toBeNull();
  });
});
