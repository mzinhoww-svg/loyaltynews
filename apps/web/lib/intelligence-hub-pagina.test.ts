import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IntelligenceHub from '../app/(portal)/intelligence/page';
import { emptySource } from '../app/(portal)/_lib/empty-source';
import { createIntelligenceSlice } from '../app/(portal)/_lib/intelligence-source';
import type { PortalSource } from '../app/(portal)/_lib/types';

/** A tela do hub renderizada no servidor, com o adaptador real sobre uma API falsa: cobre o que `page.tsx` escreve. */
const fonte = vi.hoisted(() => ({ atual: undefined as unknown }));
vi.mock('../app/(portal)/_lib/source', () => ({ getSource: () => fonte.atual as PortalSource }));

type Resposta = { status?: number; corpo: unknown };
const api = (pessoasEMoves: Resposta, empresas: Resposta = { corpo: { data: [], total: 0, tipos: [] } }) =>
  createIntelligenceSlice('http://api.invalid', async (url) => {
    const r = String(url).includes('/empresas') ? empresas : pessoasEMoves;
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });

async function tiles(src: unknown) {
  fonte.atual = src;
  const html = renderToStaticMarkup(await IntelligenceHub());
  return Object.fromEntries(
    ['empresas', 'pessoas', 'moves'].map((nome) => {
      const m = html.match(new RegExp(`<p([^>]*data-testid="count-${nome}"[^>]*)>([^<]*)</p>`));
      if (!m) throw new Error(`tile ${nome} ausente`);
      return [nome, { texto: m[2], contagem: m[1]!.match(/data-count="(\d+)"/)?.[1] ?? null }];
    }),
  );
}

const INDISPONIVEL = { texto: 'Indisponível no momento', contagem: null };

describe('página do hub /intelligence', () => {
  let erro: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    erro = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => erro.mockRestore());

  // P2-1 (QA1, 96e477dd): a API se diz disponível, mas nada passa no mapa. Isso é falha de formato, não "0 publicados".
  it.each([true, false])('itens todos fora do formato (disponivel=%s) = indisponível, sem data-count', async (disponivel) => {
    const lixo = { corpo: { data: [{ lixo: 1 }, { lixo: 2 }], total: 2, disponivel } };
    const t = await tiles(api(lixo, { corpo: { data: [{ lixo: 1 }], total: 1, tipos: [] } }));
    expect(t).toEqual({ empresas: INDISPONIVEL, pessoas: INDISPONIVEL, moves: INDISPONIVEL });
  });

  it('total maior que zero com lista vazia (pessoas e Moves) = indisponível', async () => {
    const t = await tiles(api({ corpo: { data: [], total: 3, disponivel: true } }));
    expect([t.pessoas, t.moves]).toEqual([INDISPONIVEL, INDISPONIVEL]);
  });

  it('falha da API = indisponível nos três, sem data-count', async () => {
    const falha = { status: 503, corpo: {} };
    expect(await tiles(api(falha, falha))).toEqual({ empresas: INDISPONIVEL, pessoas: INDISPONIVEL, moves: INDISPONIVEL });
  });

  it('publicado vazio tem zero real; não publicado não tem data-count', async () => {
    const t = await tiles(api({ corpo: { data: [], total: 0, disponivel: false } }));
    expect(t.empresas).toEqual({ texto: 'Nenhum registro publicado ainda', contagem: '0' });
    expect(t.pessoas).toEqual({ texto: 'Ainda não publicado nesta versão', contagem: null });
    expect(t.moves).toEqual(t.pessoas);
  });

  it('fonte vazia (nada foi lido): nenhum tile afirma 0', async () => {
    const naoPublicado = { texto: 'Ainda não publicado nesta versão', contagem: null };
    expect(await tiles(emptySource)).toEqual({ empresas: naoPublicado, pessoas: naoPublicado, moves: naoPublicado });
  });
});
