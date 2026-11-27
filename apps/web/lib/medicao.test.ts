import { readFileSync } from 'node:fs';
import { PORTAL_EVENT_NAMES, parsePortalEvent } from '@ln/analytics/portal';
import { EDITORIAS, resolveFlags } from '@ln/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAVE_CONSENTIMENTO, gravarConsentimento } from '../app/(portal)/_consentimento/regras';
import { MedicaoBusca, MedicaoLeitura, MedicaoPagina } from '../app/(portal)/_medicao/Medicao';
import { EVENTO_LOCAL, caminhoSemPessoa, leituraConta, passouDoCorte } from '../app/(portal)/_medicao/emissor';
import { medicaoAtiva } from './portal-medicao';
import { resetRuntimeFlagsForTest } from './runtime-flags';

// Os componentes de emissão rodam de verdade; só o React (efeito e ref) e o navegador são substituídos.
const react = vi.hoisted(() => ({ caminho: '/', ref: null as { current: unknown } | null, limpezas: [] as (() => void)[] }));
vi.mock('react', () => ({
  useEffect: (efeito: () => void | (() => void)) => {
    const limpar = efeito();
    if (limpar) react.limpezas.push(limpar);
  },
  useRef: (inicial: unknown) => (react.ref ??= { current: inicial }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => react.caminho }));

interface Cenario {
  consentimento?: string | null;
  gpc?: boolean;
  dnt?: string;
  robo?: boolean;
  visivel?: boolean;
  referrer?: string;
  /** Posição do texto da matéria; o padrão não chega a 75%. */
  texto?: { top: number; height: number };
}

function navegador(c: Cenario = {}) {
  const eventos: unknown[] = [];
  /** Tudo que sairia da página: rede ou elemento novo (script/pixel). */
  const externas: string[] = [];
  const registrar = (nome: string) => vi.fn(() => void externas.push(nome));
  const estado = { consentimento: c.consentimento === undefined ? gravarConsentimento(true) : c.consentimento, visivel: c.visivel ?? true };
  vi.stubGlobal('fetch', registrar('fetch'));
  vi.stubGlobal('XMLHttpRequest', class { constructor() { externas.push('xhr'); } });
  vi.stubGlobal('WebSocket', class { constructor() { externas.push('websocket'); } });
  vi.stubGlobal('Image', class { constructor() { externas.push('imagem'); } });
  vi.stubGlobal('window', {
    navigator: { globalPrivacyControl: c.gpc, doNotTrack: c.dnt ?? null, webdriver: c.robo ?? false, sendBeacon: registrar('sendBeacon') },
    localStorage: { getItem: (k: string) => (k === CHAVE_CONSENTIMENTO ? estado.consentimento : null) },
    location: { origin: 'https://portal.example', hostname: 'portal.example' },
    innerWidth: 390,
    innerHeight: 800,
    dispatchEvent: (e: CustomEvent) => {
      if (e.type === EVENTO_LOCAL) eventos.push(e.detail);
      return true;
    },
    setInterval: (f: () => void, ms: number) => setInterval(f, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    gtag: registrar('gtag'),
    dataLayer: { push: registrar('dataLayer') },
  });
  vi.stubGlobal('document', {
    referrer: c.referrer ?? '',
    get visibilityState() { return estado.visivel ? 'visible' : 'hidden'; },
    querySelector: () => ({ getBoundingClientRect: () => c.texto ?? { top: 400, height: 4000 } }),
    createElement: registrar('createElement'),
    head: { appendChild: registrar('appendChild') },
    body: { appendChild: registrar('appendChild') },
  });
  return { eventos, externas, estado };
}

/** Deixa o import dinâmico do contrato terminar (e o relógio falso andar `ms`). */
const esperar = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(0);
};

let n = 0;
const slugNovo = () => `materia-de-teste-${++n}`;

/** Percorre os três pontos de emissão. */
async function percorrer(ligada: boolean) {
  react.caminho = '/noticia/materia-curta';
  MedicaoPagina({ ligada });
  MedicaoBusca({ ligada, termo: 'milhas aéreas', total: 7 });
  MedicaoLeitura({ ligada, slug: slugNovo(), editoria: 'mercado' });
  await esperar(31_000);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  react.ref = null;
});
afterEach(() => {
  react.limpezas.splice(0).forEach((f) => f());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('flag desligada', () => {
  it('é o padrão no servidor, e nenhum ambiente liga por variável', () => {
    resetRuntimeFlagsForTest();
    expect(medicaoAtiva()).toBe(false);
    for (const APP_ENV of ['staging', 'production']) expect(() => resolveFlags({ APP_ENV, LN_FLAGS_ON: 'analytics' })).toThrow();
    expect(resolveFlags({ APP_ENV: 'development', LN_FLAGS_ON: 'analytics' }).state.analytics).toBe(false);
  });

  it('com consentimento aceito: 0 chamadas externas, 0 eventos e nenhum relógio de leitura', async () => {
    const nav = navegador();
    await percorrer(false);
    expect(nav.externas).toEqual([]);
    expect(nav.eventos).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('nada antes do consentimento', () => {
  it.each([
    ['sem escolha', { consentimento: null }],
    ['recusado', { consentimento: gravarConsentimento(false) }],
    ['versão antiga da política', { consentimento: JSON.stringify({ versao: '2020-01-01', em: '2020-01-01T00:00:00Z', analiticos: true }) }],
    ['GPC', { gpc: true }],
    ['DNT', { dnt: '1' }],
    ['navegador automatizado', { robo: true }],
  ] as [string, Cenario][])('flag ligada e %s: 0 eventos', async (_nome, cenario) => {
    const nav = navegador(cenario);
    await percorrer(true);
    expect(nav.eventos).toEqual([]);
    expect(nav.externas).toEqual([]);
  });

  it('o tempo anterior ao aceite não conta e nada é reenviado depois', async () => {
    const nav = navegador({ consentimento: null });
    const slug = slugNovo();
    MedicaoLeitura({ ligada: true, slug, editoria: 'mercado' });
    await esperar(60_000);
    nav.estado.consentimento = gravarConsentimento(true);
    await esperar(29_000);
    expect(nav.eventos).toEqual([]);
    await esperar(1_000);
    expect(nav.eventos).toEqual([{ name: 'article_read', slug, editoria: 'mercado', readSeconds: 30 }]);
  });

  it('revogar enquanto o contrato carrega segura o evento', async () => {
    const nav = navegador();
    MedicaoBusca({ ligada: true, termo: 'milhas', total: 1 });
    nav.estado.consentimento = gravarConsentimento(false);
    await esperar();
    expect(nav.eventos).toEqual([]);
  });
});

describe('ligada e com consentimento', () => {
  it('os três eventos do contrato saem, válidos, e só dentro da página (0 chamadas externas)', async () => {
    const nav = navegador();
    await percorrer(true);
    expect(nav.eventos.map((e) => (e as { name: string }).name).sort()).toEqual([...PORTAL_EVENT_NAMES].sort());
    for (const e of nav.eventos) expect(parsePortalEvent(e).ok).toBe(true);
    expect(nav.externas).toEqual([]);
  });

  it('page_view: entrada classifica a origem; navegação seguinte é interna', async () => {
    const nav = navegador({ referrer: 'https://www.google.com/search?q=x' });
    react.caminho = '/';
    MedicaoPagina({ ligada: true });
    await esperar();
    react.caminho = '/noticias';
    MedicaoPagina({ ligada: true });
    await esperar();
    expect(nav.eventos).toEqual([
      { name: 'page_view', path: '/', referrer: 'busca', device: 'mobile' },
      { name: 'page_view', path: '/noticias', referrer: 'interno', device: 'mobile' },
    ]);
  });

  it('article_read: 75% do texto adianta (mínimo 3 s), uma vez por matéria, e aba escondida não conta', async () => {
    const nav = navegador({ texto: { top: -2000, height: 3000 }, visivel: false });
    const slug = slugNovo();
    MedicaoLeitura({ ligada: true, slug, editoria: 'pontos' });
    await esperar(60_000);
    expect(nav.eventos).toEqual([]);
    nav.estado.visivel = true;
    await esperar(3_000);
    MedicaoLeitura({ ligada: true, slug, editoria: 'pontos' });
    await esperar(60_000);
    expect(nav.eventos).toEqual([{ name: 'article_read', slug, editoria: 'pontos', readSeconds: 3 }]);
  });

  it('search: busca de 1 caractere não sai; total acima do teto do contrato vira 1000', async () => {
    const nav = navegador();
    MedicaoBusca({ ligada: true, termo: 'a', total: 3 });
    MedicaoBusca({ ligada: true, termo: 'pontos', total: 4321 });
    await esperar();
    expect(nav.eventos).toEqual([{ name: 'search', query: 'pontos', resultCount: 1000 }]);
  });

  it('as dez editorias do contrato passam em article_read', async () => {
    const nav = navegador();
    for (const e of EDITORIAS) MedicaoLeitura({ ligada: true, slug: slugNovo(), editoria: e.slug });
    await esperar(30_000);
    expect(nav.eventos).toHaveLength(EDITORIAS.length);
  });
});

describe('0 dado pessoal no payload (dados fictícios)', () => {
  const email = 'fulano.teste@exemplo.com';

  it.each([
    ['e-mail', `contato ${email}`],
    ['e-mail cruzando o corte de 100 da página', `${'x'.repeat(90)} ${email}`],
    ['e-mail cruzando o corte de 120 do contrato', `${'x'.repeat(110)} ${email}`],
    ['CPF', 'extrato 123.456.789-01'],
    ['telefone', 'ligar (11) 91234-5678'],
  ])('busca com %s vira :redigido', async (_nome, termo) => {
    const nav = navegador();
    MedicaoBusca({ ligada: true, termo, total: 0 });
    await esperar();
    expect(nav.eventos).toEqual([{ name: 'search', query: ':redigido', resultCount: 0 }]);
  });

  it.each([
    ['/intelligence/pessoas/fulano-de-teste', '/intelligence/pessoas/:id'],
    ['/moves/fulano-de-teste-assume-diretoria', '/moves/:id'],
    [`/conta/${email}`, '/conta/:id'],
    ['/usuario/123.456.789-01/perfil', '/usuario/:id/perfil'],
  ])('caminho %s sai como %s, sem a query de origem', async (caminho, esperado) => {
    const nav = navegador({ referrer: `https://mail.exemplo.com/caixa/${email}?token=segredo-ficticio` });
    react.caminho = caminho;
    MedicaoPagina({ ligada: true });
    await esperar();
    expect(nav.eventos).toEqual([{ name: 'page_view', path: esperado, referrer: 'outro', device: 'mobile' }]);
    expect(JSON.stringify(nav.eventos)).not.toMatch(/fulano|exemplo|123\.456|segredo/);
  });
});

describe('regras puras', () => {
  it('leitura: 30 s, ou 75% do texto com pelo menos 3 s', () => {
    expect([leituraConta(29, false), leituraConta(30, false), leituraConta(2, true), leituraConta(3, true)]).toEqual([false, true, false, true]);
    expect([passouDoCorte({ top: 0, height: 1000 }, 749), passouDoCorte({ top: 0, height: 1000 }, 750), passouDoCorte({ top: 0, height: 0 }, 800), passouDoCorte(null, 800)])
      .toEqual([false, true, false, false]);
  });
  it('listas de pessoas e movimentações continuam com o caminho normal', () => {
    expect([caminhoSemPessoa('/moves'), caminhoSemPessoa('/intelligence/pessoas'), caminhoSemPessoa('/intelligence/empresas/abc')])
      .toEqual(['/moves', '/intelligence/pessoas', '/intelligence/empresas/abc']);
  });
});

describe('fiação nas páginas', () => {
  const ler = (f: string) => readFileSync(new URL(`../app/(portal)/${f}`, import.meta.url), 'utf8');
  it.each([
    ['layout.tsx', 'MedicaoPagina'],
    ['busca/page.tsx', 'MedicaoBusca'],
    ['noticia/[slug]/page.tsx', 'MedicaoLeitura'],
  ])('%s monta %s com a flag do servidor', (arquivo, componente) => {
    expect(ler(arquivo)).toContain(`<${componente} ligada={medicaoAtiva()}`);
  });
});
