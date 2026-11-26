import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createIntelligenceSlice } from '../app/(portal)/_lib/intelligence-source';
import type { PortalSource } from '../app/(portal)/_lib/types';
import EmpresasPage from '../app/(portal)/intelligence/empresas/(lista)/page';

/** Vazio do diretório de empresas: diretório vazio, filtro sem resultado e página fora do intervalo são coisas diferentes. */
const fonte = vi.hoisted(() => ({ atual: undefined as unknown }));
vi.mock('../app/(portal)/_lib/source', () => ({ getSource: () => fonte.atual as PortalSource }));

async function tela(resposta: object, busca: { q?: string; tipo?: string; pagina?: string } = {}) {
  fonte.atual = createIntelligenceSlice('http://api.invalid', async () => new Response(JSON.stringify(resposta), { status: 200 }));
  return renderToStaticMarkup(await EmpresasPage({ searchParams: Promise.resolve(busca) }));
}
const VAZIO = 'Ainda não há perfis publicados';
const FILTRO = 'Nenhuma empresa com esse filtro';
const FORA = 'Esta página não existe mais';
const so = (html: string, titulo: string) => {
  for (const t of [VAZIO, FILTRO, FORA]) expect(html.includes(t), t).toBe(t === titulo);
  expect(html).not.toMatch(/em breve/i);
};

describe('diretório de empresas sem itens', () => {
  it('sem busca e nenhum tipo contado = diretório vazio', async () => {
    so(await tela({ data: [], total: 0, tipos: [] }), VAZIO);
    so(await tela({ data: [], total: 0, tipos: [] }, { tipo: 'company' }), VAZIO);
  });

  // `tipos` é contado sobre a busca: soma zero com `q` não prova que o diretório esteja vazio.
  it('busca sem resultado = filtro, nunca "ainda não há perfis"', async () => {
    so(await tela({ data: [], total: 0, tipos: [] }, { q: 'zzz' }), FILTRO);
  });

  it('tipo sem resultado com diretório preenchido = filtro', async () => {
    so(await tela({ data: [], total: 0, tipos: [{ tipo: 'program', total: 3 }] }, { tipo: 'company' }), FILTRO);
  });

  it('página além do fim = página que não existe mais', async () => {
    so(await tela({ data: [], total: 29, tipos: [{ tipo: 'company', total: 29 }] }, { pagina: '9' }), FORA);
  });
});
