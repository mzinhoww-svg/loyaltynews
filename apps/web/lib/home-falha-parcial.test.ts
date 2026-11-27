import type { ReactElement, ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '../app/(portal)/page';
import { ErrorState } from '../app/(portal)/_components/states';

// N5: a home monta várias leituras; quando só parte delas falha, a seção não pode sumir em silêncio.
// A página é chamada como função e a árvore devolvida é percorrida (sem navegador).
const item = (slug: string) => ({
  slug, titulo: `Matéria ${slug}`, resumo: 'Resumo.', editoria: 'mercado', assinatura: 'Redação Loyalty News', publicadoEm: '2026-11-20T10:00:00-03:00',
});
let falha: (url: URL) => boolean = () => false;
let vazio = false;
const responder = async (entrada: string | URL | Request) => {
  const url = new URL(String(entrada));
  if (url.pathname === '/api/publico/site') return new Response('{}', { status: 404 });
  if (falha(url)) return new Response('{}', { status: 503 });
  if (url.pathname === '/api/publico/agenda') return Response.json({ data: [] });
  const marca = [url.searchParams.get('editoria'), url.searchParams.get('tipo'), url.searchParams.get('limit')].join('-');
  const data = vazio ? [] : [item(`m-${marca}`.toLowerCase())];
  return Response.json({ data: url.searchParams.get('tipo') ? data.map((a) => ({ ...a, tipoConteudo: url.searchParams.get('tipo') })) : data, total: data.length });
};

type El = ReactElement<Record<string, unknown>>;
function procurar(no: ReactNode, tipo: unknown, achados: El[] = []): El[] {
  if (Array.isArray(no)) no.forEach((n) => procurar(n, tipo, achados));
  else if (no && typeof no === 'object' && 'props' in no) {
    const el = no as El;
    if (el.type === tipo) achados.push(el);
    procurar(el.props.children as ReactNode, tipo, achados);
  }
  return achados;
}
async function erros(): Promise<string[]> {
  const raiz = HomePage() as unknown as El;
  const arvore = await (raiz.type as (p: unknown) => Promise<ReactNode>)(raiz.props);
  return procurar(arvore, ErrorState).map((e) => String(e.props.title));
}

describe('home com falha parcial (N5)', () => {
  beforeAll(() => {
    vi.stubEnv('PORTAL_SOURCE', 'api');
    vi.stubEnv('PORTAL_API_BASE_URL', 'http://api.test');
    vi.stubGlobal('fetch', responder);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  beforeEach(() => {
    falha = () => false;
    vazio = false;
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('controle negativo: tudo respondendo, nenhum aviso de erro', async () => {
    expect(await erros()).toEqual([]);
  });

  it('controle negativo: acervo vazio sem falha continua "em breve", sem erro', async () => {
    vazio = true;
    expect(await erros()).toEqual([]);
  });

  it.each([
    ['Flash', (u: URL) => u.searchParams.get('tipo') === 'flash'],
    ['uma editoria', (u: URL) => u.searchParams.get('editoria') === 'bancos'],
    ['Destaques', (u: URL) => u.pathname === '/api/publico/materias' && u.searchParams.get('limit') === '6' && !u.searchParams.get('editoria') && !u.searchParams.get('tipo')],
    ['últimas', (u: URL) => u.pathname === '/api/publico/materias' && u.searchParams.get('limit') === '12' && !u.searchParams.get('editoria') && !u.searchParams.get('tipo')],
  ])('falha só em %s: a página avisa que parte não carregou', async (_nome, quando) => {
    falha = quando;
    expect(await erros()).toEqual(['Parte da página não carregou']);
  });

  it('falha só no Flash com o resto vazio: erro, não "em breve"', async () => {
    vazio = true;
    falha = (u) => u.searchParams.get('tipo') === 'flash';
    expect(await erros()).toEqual(['Não conseguimos carregar as matérias agora']);
  });
});
