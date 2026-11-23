import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareHome } from '../app/(portal)/_lib/home';
import { jsonLdString } from '../app/(portal)/_lib/jsonld';
import { createSiteSlice, linkTerms, parseSiteConfig, safeDestino } from '../app/(portal)/_lib/site-config';
import type { Article, HomeBlock } from '../app/(portal)/_lib/types';

// Formato de GET /api/publico/site (apps/web/app/api/_lib/site/index.ts).
const card = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  titulo: `Título ${slug}`,
  subtitulo: null,
  resumo: 'Resumo',
  tipoConteudo: 'noticia',
  tempoLeituraMin: 2,
  editoria: 'bancos',
  assinatura: 'Redação Loyalty News',
  patrocinado: false,
  rotuloPublieditorial: null,
  publicadoEm: '2026-11-20T10:00:00-03:00',
  corrigida: false,
  imagem: null,
  ...over,
});
const FULL = {
  data: {
    home: {
      versao: 3,
      blocos: [
        { tipo: 'destaque', id: 'topo', titulo: 'Em foco', materiaSlugs: ['a', 'b'], materias: [card('a'), card('b')] },
        { tipo: 'lista_editoria', id: 'bancos', editoria: 'bancos', limite: 6, materias: [card('b'), card('c')] },
        { tipo: 'ultimas', id: 'ult', limite: 10, materias: [card('a'), card('c'), card('d')] },
        {
          tipo: 'agenda',
          id: 'ag',
          limite: 5,
          eventos: [{ id: 'e1', titulo: 'Congresso', inicio: '2026-12-04', fim: '2026-12-05', local: 'São Paulo', url: 'https://evento.example/x', editorias: [], patrocinado: false, fonteUrl: null }],
        },
        { tipo: 'publicidade', id: 'pub', posicao: 'TOP', dimensao: { largura: 1280, altura: 150 } },
      ],
    },
    menus: {
      principal: { itens: [{ rotulo: 'Agenda', destino: '/agenda', filhos: [] }, { rotulo: 'Parceiro', destino: 'https://parceiro.example/', filhos: [] }] },
      rodape: {
        itens: [
          { rotulo: 'Institucional', destino: '/sobre', filhos: [{ rotulo: 'Metodologia', destino: '/metodologia' }] },
          { rotulo: 'Contato', destino: '/contato', filhos: [] },
        ],
      },
    },
    seo: {
      tituloPadrao: 'Loyalty News — título publicado',
      descricaoPadrao: 'Descrição publicada',
      imagemOgUrl: 'https://cdn.example/og.png',
      indexacao: 'indexar',
      jsonLd: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Loyalty News', url: 'https://loyaltynews.example', sameAs: ['https://linkedin.example/ln'] },
    },
    linksInternos: [{ termo: 'programa de fidelidade', destino: '/editoria/programas' }],
  },
};

describe('parseSiteConfig (payload não confiável)', () => {
  it('lê home, menus, SEO e links internos no formato do Backend', () => {
    const c = parseSiteConfig(FULL)!;
    expect(c.home?.version).toBe(3);
    expect(c.home?.blocks.map((b) => b.type)).toEqual(['destaque', 'lista_editoria', 'ultimas', 'agenda', 'publicidade']);
    expect(c.menus.main?.map((i) => i.label)).toEqual(['Agenda', 'Parceiro']);
    expect(c.menus.footer?.[0]?.children).toEqual([{ label: 'Metodologia', href: '/metodologia' }]);
    expect(c.seo).toMatchObject({ title: 'Loyalty News — título publicado', noindex: false, ogImage: 'https://cdn.example/og.png' });
    expect(c.seo?.organization?.sameAs).toEqual(['https://linkedin.example/ln']);
    expect(c.internalLinks).toEqual([{ term: 'programa de fidelidade', href: '/editoria/programas' }]);
  });

  it('tudo null = nada publicado: partes null e lista vazia (padrão do portal, sem inventar)', () => {
    const c = parseSiteConfig({ data: { home: null, menus: { principal: null, rodape: null }, seo: null, linksInternos: [] } });
    expect(c).toEqual({ home: null, menus: { main: null, footer: null }, seo: null, internalLinks: [] });
  });

  it('formato inesperado devolve null sem lançar', () => {
    for (const raw of [null, 'x', 42, [], {}, { data: null }, { data: 'x' }, { data: [] }]) expect(parseSiteConfig(raw)).toBeNull();
  });

  it('seo.indexacao diferente de "indexar" conta como noindex (fail-safe)', () => {
    for (const indexacao of ['noindex', 'talvez', '', null, 1]) {
      const c = parseSiteConfig({ data: { seo: { ...FULL.data.seo, indexacao } } });
      expect(c?.seo?.noindex, String(indexacao)).toBe(true);
    }
  });

  it('descarta destinos perigosos e itens malformados nos menus', () => {
    const bad = ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/api/x', '/studio/cms', '/_next/x', 'ftp://x.example', '', 3, null];
    const c = parseSiteConfig({
      data: {
        menus: {
          principal: {
            itens: [
              { rotulo: 'Bom', destino: '/ok', filhos: [{ rotulo: 'Ruim', destino: 'javascript:1' }, { rotulo: 'Filho', destino: '/f' }, null] },
              ...bad.map((destino) => ({ rotulo: 'X', destino })),
              null,
              'x',
              { rotulo: '', destino: '/ok' },
            ],
          },
        },
      },
    });
    expect(c?.menus.main).toEqual([{ label: 'Bom', href: '/ok', children: [{ label: 'Filho', href: '/f' }] }]);
  });

  it('menu sem itens válidos vira null; home sem blocos válidos vira null', () => {
    const menus = parseSiteConfig({ data: { menus: { principal: { itens: [{ rotulo: 'X', destino: 'javascript:1' }] }, rodape: { itens: [] } } } })?.menus;
    expect(menus).toEqual({ main: null, footer: null });
    expect(parseSiteConfig({ data: { home: { versao: 1, blocos: [null, { tipo: 'desconhecido', id: 'x' }, { tipo: 'destaque' }] } } })?.home).toBeNull();
  });

  it('cartões malformados e eventos inválidos são descartados; link do evento só http(s)', () => {
    const c = parseSiteConfig({
      data: {
        home: {
          versao: 1,
          blocos: [
            { tipo: 'destaque', id: 'a', materias: [null, {}, card('ok'), card('data-ruim', { publicadoEm: 'x' })] },
            {
              tipo: 'agenda',
              id: 'b',
              eventos: [null, { id: 'e', titulo: 'T', inicio: 'x' }, { id: 'e2', titulo: 'Bom', inicio: '2026-12-01', url: 'javascript:1' }],
            },
          ],
        },
      },
    });
    const [dest, ag] = c!.home!.blocks;
    expect(dest?.type === 'destaque' && dest.articles.map((a) => a.slug)).toEqual(['ok']);
    expect(ag?.type === 'agenda' && ag.events).toEqual([{ id: 'e2', title: 'Bom', startsAt: '2026-12-01', endsAt: undefined, place: undefined, url: undefined, sponsored: false }]);
  });

  it('JSON-LD: só URLs http(s) em sameAs/logo; organização sem nome/url válidos é ignorada', () => {
    const ld = { name: 'N', url: 'https://n.example', logo: 'javascript:1', sameAs: ['javascript:1', 'https://ok.example', '/interno'] };
    const c = parseSiteConfig({ data: { seo: { ...FULL.data.seo, jsonLd: ld } } });
    expect(c?.seo?.organization).toEqual({ name: 'N', url: 'https://n.example/', logo: undefined, sameAs: ['https://ok.example/'] });
    const sem = parseSiteConfig({ data: { seo: { ...FULL.data.seo, jsonLd: { name: 'N', url: 'javascript:1' } } } });
    expect(sem?.seo?.organization).toBeUndefined();
  });
});

describe('safeDestino', () => {
  it('aceita caminho interno e URL http(s); recusa o resto', () => {
    expect(safeDestino('/editoria/bancos?x=1#a')).toBe('/editoria/bancos?x=1#a');
    expect(safeDestino('https://a.example/p')).toBe('https://a.example/p');
    for (const v of ['/api', '/api/x', '/STUDIO', '//a.example', 'mailto:a@b', 'javascript:1', ' ', 'sem-barra']) expect(safeDestino(v), v).toBeNull();
  });

  it('dot-segments são resolvidos ANTES do teste das rotas reservadas (achado do QA 4)', () => {
    for (const v of ['/../studio/x', '/%2e%2e/api/x', '/%2E%2E/studio', '/a/../../api/x', '/a/%2e%2e/%2e%2e/_next/x', '/./api/x', '/%61pi/x', '/%73tudio']) {
      expect(safeDestino(v), v).toBeNull();
    }
    // Caminhos legítimos com ponto continuam valendo e saem normalizados.
    expect(safeDestino('/a/./b/../c')).toBe('/a/c');
    expect(safeDestino('/metodologia')).toBe('/metodologia');
    expect(safeDestino('/%zz')).toBeNull();
  });

  it('URL externa sai normalizada pelo parser (nunca o texto cru): < e > viram %3C e %3E', () => {
    const out = safeDestino('https://x.example/p?q=</script><script>window.__xss=1</script>#</script>');
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain('%3C/script%3E');
    expect(safeDestino('https://n.example')).toBe('https://n.example/');
  });
});

describe('jsonLdString', () => {
  it('escapa <, > e & (não fecha o <script>) e preserva o valor ao ser lido de volta', () => {
    const v = { name: '</script><script>window.__xss=1</script> & "ok" \u2028 \u2029', n: 1 };
    const out = jsonLdString(v);
    expect(out).not.toMatch(/[<>&]/);
    expect(out).not.toContain('</script');
    expect(out).toContain('\\u003c/script\\u003e');
    expect(JSON.parse(out)).toEqual(v);
  });
});

describe('linkTerms (links internos)', () => {
  const rules = [
    { term: 'programa de fidelidade', href: '/editoria/programas' },
    { term: 'fidelidade', href: '/sobre' },
  ];
  it('linka só a primeira ocorrência de cada termo, sem diferenciar maiúsculas, com palavra inteira', () => {
    const used = new Set<string>();
    const parts = linkTerms('O Programa de Fidelidade cresce; outro programa de fidelidade também.', rules, used);
    // O termo mais longo vence na 1ª ocorrência; o termo curto linka a sua própria 1ª ocorrência fora do link longo.
    expect(parts.filter((p) => typeof p !== 'string')).toEqual([
      { text: 'Programa de Fidelidade', href: '/editoria/programas' },
      { text: 'fidelidade', href: '/sobre' },
    ]);
    expect(parts.map((p) => (typeof p === 'string' ? p : p.text)).join('')).toBe('O Programa de Fidelidade cresce; outro programa de fidelidade também.');
    // 2º parágrafo da mesma matéria: o termo já foi usado
    expect(linkTerms('Mais um programa de fidelidade.', rules, used).every((p) => typeof p === 'string')).toBe(true);
  });
  it('não linka dentro de outra palavra', () => {
    const parts = linkTerms('Infidelidade e fidelidades.', [{ term: 'fidelidade', href: '/x' }], new Set());
    expect(parts.every((p) => typeof p === 'string')).toBe(true);
  });
  it('escapa caracteres especiais do termo', () => {
    const parts = linkTerms('Veja C++ (guia) aqui.', [{ term: 'C++ (guia)', href: '/g' }], new Set());
    expect(parts).toEqual(['Veja ', { text: 'C++ (guia)', href: '/g' }, ' aqui.']);
  });
});

describe('prepareHome', () => {
  const art = (slug: string): Article => ({
    slug,
    title: slug,
    summary: '',
    editoriaSlug: 'bancos',
    contentType: 'noticia',
    authorLabel: 'x',
    publishedAt: '2026-11-20T10:00:00-03:00',
    readingMinutes: 1,
    body: [],
    sources: [],
    corrections: [],
    tags: [],
  });
  const blocks: HomeBlock[] = [
    { type: 'destaque', id: 'd', title: 'Em foco', articles: ['a', 'b'].map(art) },
    { type: 'lista_editoria', id: 'l', editoriaSlug: 'bancos', articles: ['b', 'c'].map(art) },
    { type: 'ultimas', id: 'u', articles: ['a', 'c', 'd'].map(art) },
    { type: 'lista_editoria', id: 'vazio', editoriaSlug: 'pontos', articles: ['a', 'b'].map(art) },
    { type: 'agenda', id: 'ag', events: [{ id: 'e', title: 'T', startsAt: '2026-12-01', sponsored: false }] },
    { type: 'publicidade', id: 'p', position: 'TOP' },
  ];
  it('mantém a ordem do editor, deduplica matérias entre blocos e esconde bloco que ficou vazio', () => {
    const h = prepareHome(blocks);
    expect(h.hero?.title).toBe('Em foco');
    expect(h.hero?.articles.map((a) => a.slug)).toEqual(['a', 'b']);
    expect(h.sections.map((s) => [s.id, s.articles.map((a) => a.slug)])).toEqual([
      ['l', ['c']],
      ['u', ['d']],
    ]);
    expect(h.agenda?.events).toHaveLength(1);
    expect(h.adPositions).toEqual(['TOP']);
    expect(h.hasContent).toBe(true);
  });
  it('blocos sem conteúdo = sem conteúdo (estado vazio honesto)', () => {
    expect(prepareHome([{ type: 'destaque', id: 'd', articles: [] }, { type: 'agenda', id: 'a', events: [] }]).hasContent).toBe(false);
    expect(prepareHome([]).hasContent).toBe(false);
  });
});

describe('createSiteSlice (cliente de /api/publico/site)', () => {
  const ok = () => new Response(JSON.stringify(FULL), { status: 200 });
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    errorSpy.mockRestore();
  });

  it('cacheia 60 s e refaz depois', async () => {
    const f = vi.fn(async (_u: string | URL | Request) => ok());
    const s = createSiteSlice('http://api.test', f as unknown as typeof fetch);
    expect((await s.getSiteConfig())?.seo?.title).toContain('publicado');
    await s.getSiteConfig();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe('http://api.test/api/publico/site');
    vi.setSystemTime(new Date('2026-11-23T12:01:01Z'));
    await s.getSiteConfig();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('API fora do ar, 503 ou JSON inválido: null (padrão do portal), cache curto da falha e log sem URL', async () => {
    const falhas: Array<() => Promise<Response>> = [
      () => Promise.reject(new TypeError('connect ECONNREFUSED http://127.0.0.1:1/x?token=segredo')),
      async () => new Response('{}', { status: 503 }),
      async () => new Response('<html>', { status: 200 }),
      async () => new Response('{"data":"x"}', { status: 200 }),
    ];
    for (const make of falhas) {
      const f = vi.fn(make);
      const s = createSiteSlice('http://api.test', f as unknown as typeof fetch);
      expect(await s.getSiteConfig()).toBeNull();
      await s.getSiteConfig();
      expect(f).toHaveBeenCalledTimes(1); // a falha também fica em cache por 15 s
      vi.setSystemTime(new Date(Date.now() + 16_000));
      await s.getSiteConfig();
      expect(f).toHaveBeenCalledTimes(2);
    }
    for (const call of errorSpy.mock.calls) expect(String(call[0])).not.toMatch(/http|segredo|ECONNREFUSED/);
  });
});
