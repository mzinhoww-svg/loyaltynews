import { describe, expect, it, vi } from 'vitest';
import {
  bodyToBlocks,
  createApiSlice,
  mainBody,
  mapArticle,
  mapImage,
  type RawArticle,
} from '../app/(portal)/_lib/api-source';

// Payloads no formato de GET /api/publico/materias/{slug} (apps/web/app/api/_lib/articles.ts).
const CORPO =
  'Primeiro parágrafo da matéria.\n\n## Subtítulo\n\nSegundo parágrafo.\n\n> Uma citação\n\nAvisos:\n- Corrigimos o valor citado no segundo parágrafo.\n  Segunda linha do aviso.\n\nFontes:\n- https://fonte.example/a';

const article = (over: Partial<RawArticle> = {}): RawArticle => ({
  slug: 'materia-teste',
  titulo: 'Título de teste',
  subtitulo: null,
  resumo: 'Resumo de teste.',
  tipoConteudo: 'analise',
  tempoLeituraMin: 3,
  editoria: 'bancos',
  assinatura: 'Redação Loyalty News',
  corpo: CORPO,
  imagem: {
    url: '/api/publico/midia/abc123',
    origem: 'ilustracao_gerada',
    credito: 'Loyalty News',
    textoAlternativo: 'Ilustração conceitual: cena abstrata',
  },
  patrocinado: false,
  publicadoEm: '2026-11-20T10:00:00-03:00',
  fontes: [{ sourceId: 's1', url: 'https://www.fonte.example/a', capturadoEm: '2026-11-19T10:00:00-03:00' }],
  erratas: [{ nota: 'Corrigimos o valor citado no segundo parágrafo.\nSegunda linha do aviso.', em: '2026-11-21T09:00:00-03:00' }],
  ...over,
});

describe('corpo da matéria', () => {
  it('remove os blocos Avisos e Fontes do texto corrido', () => {
    const main = mainBody(CORPO);
    expect(main).not.toContain('Avisos:');
    expect(main).not.toContain('Fontes:');
    expect(main.endsWith('Uma citação')).toBe(true);
  });
  it('vira blocos: parágrafo, subtítulo e citação', () => {
    expect(bodyToBlocks(CORPO).map((b) => b.type)).toEqual(['paragraph', 'heading', 'paragraph', 'quote']);
  });
  it('corpo sem blocos finais continua inteiro', () => {
    expect(bodyToBlocks('Só texto.')).toEqual([{ type: 'paragraph', text: 'Só texto.' }]);
  });
});

describe('imagem pública', () => {
  it('ilustração gerada: URL pública, crédito institucional e rótulo "Ilustração conceitual" sem citar IA', () => {
    const img = mapImage(article().imagem)!;
    expect(img.src).toBe('/api/publico/midia/abc123');
    expect(img.credit).toBe('Loyalty News');
    expect(img.label).toBe('Ilustração conceitual');
    expect(JSON.stringify(img)).not.toMatch(/\bIA\b|gerad|modelo|provider/i);
  });
  it('foto licenciada: sem rótulo, com crédito e link da fonte', () => {
    const img = mapImage({ url: 'https://cdn.example/f.jpg', origem: 'fonte_terceiro', credito: 'Agência X', link: 'https://x.example', textoAlternativo: 'Foto' })!;
    expect(img.label).toBeNull();
    expect(img.credit).toBe('Agência X');
    expect(img.link).toBe('https://x.example');
  });
  it('imagem: null (vencida/sem base) vira ausência de imagem', () => {
    expect(mapImage(null)).toBeUndefined();
    expect(mapArticle(article({ imagem: null })).image).toBeUndefined();
  });
});

describe('imagem na listagem pública', () => {
  const item = (imagem: unknown) => ({ ...article({ slug: 'm1' }), corpo: undefined, imagem });
  it('card com ilustração: url pública, alt, crédito e rótulo vindo do Backend', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [item({ url: '/api/publico/midia/x', textoAlternativo: 'Ilustração conceitual: teste', credito: 'Loyalty News', rotulo: 'Ilustração conceitual' }), item(null)], total: 2 }), { status: 200 }));
    const page = await createApiSlice('http://api.test', f as unknown as typeof fetch).getLatest({ pageSize: 12 });
    expect(page.items[0]!.image).toMatchObject({ src: '/api/publico/midia/x', credit: 'Loyalty News', label: 'Ilustração conceitual' });
    expect(page.items[1]!.image).toBeUndefined();
  });
  it('rotulo null = sem rótulo; o rótulo do Backend prevalece sobre a origem', () => {
    expect(mapImage({ url: '/u', credito: 'Agência', textoAlternativo: 'Foto', rotulo: null })!.label).toBeNull();
    expect(mapImage({ url: '/u', origem: 'propria', credito: 'X', textoAlternativo: 'Y', rotulo: 'Ilustração conceitual' })!.label).toBe('Ilustração conceitual');
  });
});

describe('mapeamento da matéria', () => {
  it('traz errata como correção, fontes com host e assinatura institucional', () => {
    const a = mapArticle(article());
    expect(a.corrections).toHaveLength(1);
    expect(a.corrections[0]!.text).toContain('Corrigimos o valor');
    expect(a.updatedAt).toBe('2026-11-21T09:00:00-03:00');
    expect(a.sources[0]).toMatchObject({ label: 'fonte.example', url: 'https://www.fonte.example/a' });
    expect(a.authorLabel).toBe('Redação Loyalty News');
    expect(a.contentType).toBe('analise');
  });
  it('matéria sem errata não tem aviso; tipo desconhecido cai em notícia', () => {
    const a = mapArticle(article({ erratas: [], tipoConteudo: 'outro' }));
    expect(a.corrections).toEqual([]);
    expect(a.updatedAt).toBeUndefined();
    expect(a.contentType).toBe('noticia');
  });
  it('errata sem nota é ignorada', () => {
    expect(mapArticle(article({ erratas: [{ nota: null, em: '2026-11-21T09:00:00-03:00' }] })).corrections).toEqual([]);
  });
});

describe('cliente da API pública', () => {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

  it('getArticle: 404 vira null; 500 propaga erro; sempre sem cache', async () => {
    const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => (String(url).endsWith('/ausente') ? json({}, 404) : String(url).endsWith('/quebra') ? json({}, 500) : json({ data: article() })));
    const api = createApiSlice('http://api.test/', f as unknown as typeof fetch);
    expect(await api.getArticle('ausente')).toBeNull();
    await expect(api.getArticle('quebra')).rejects.toThrow(/500/);
    expect((await api.getArticle('materia-teste'))!.image?.label).toBe('Ilustração conceitual');
    expect(f.mock.calls[0]![0]).toBe('http://api.test/api/publico/materias/ausente');
    expect(f.mock.calls[0]![1]?.cache).toBe('no-store');
  });

  it('getLatest pagina pela API e filtra por tipo localmente', async () => {
    const items = ['noticia', 'flash', 'flash', 'analise'].map((t, i) => ({ ...article({ slug: `m${i}`, tipoConteudo: t }), corpo: undefined }));
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      const limit = Number(u.searchParams.get('limit'));
      const offset = Number(u.searchParams.get('offset'));
      return json({ data: items.slice(offset, offset + limit), total: items.length, limit, offset });
    });
    const api = createApiSlice('http://api.test', f as unknown as typeof fetch);
    const p2 = await api.getLatest({ page: 2, pageSize: 2 });
    expect(p2.items.map((i) => i.slug)).toEqual(['m2', 'm3']);
    expect(p2.total).toBe(4);
    const flash = await api.getLatest({ contentType: 'flash', pageSize: 12 });
    expect(flash.items.map((i) => i.slug)).toEqual(['m1', 'm2']);
    expect(flash.total).toBe(2);
  });

  it('em alta é vazio (sem ranking real) e busca vazia não chama a API', async () => {
    const f = vi.fn();
    const api = createApiSlice('http://api.test', f as unknown as typeof fetch);
    expect(await api.getTrending('24h')).toEqual([]);
    expect((await api.search('   ')).total).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
});
