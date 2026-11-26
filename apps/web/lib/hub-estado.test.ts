import { describe, expect, it } from 'vitest';
import { rotuloContagem, totalPublicado } from '../app/(portal)/intelligence/_lib/hub-estado';
import { createIntelligenceSlice } from '../app/(portal)/_lib/intelligence-source';

/** Mapeamento anterior ao QA 6: falha de leitura contava como 0 e o tile dizia que nada estava cadastrado. */
const mapeamentoAntigo = (d: { status: string; total?: number }) => (d.status === 'ok' ? (d.total ?? 0) : 0);

describe('hub do Intelligence: indisponível, retido e publicado vazio são distintos', () => {
  it('falha de leitura aparece como indisponível, sem 0 inventado', () => {
    const falha = { status: 'unavailable' as const };
    expect(rotuloContagem(falha)).toBe('Indisponível no momento');
    expect(totalPublicado(falha)).toBeNull(); // data-count ausente, não 0
    // Controle negativo: o mapeamento antigo faria a falha parecer um módulo vazio.
    expect(rotuloContagem({ status: 'ok', total: mapeamentoAntigo(falha) })).toBe('Nenhum registro publicado ainda');
    expect(rotuloContagem(falha)).not.toBe(rotuloContagem({ status: 'ok', total: mapeamentoAntigo(falha) }));
  });

  it('conteúdo retido pela flag não é apresentado como vazio', () => {
    expect(rotuloContagem({ status: 'ok', available: false, withheld: 2 })).toBe('Existe conteúdo, ainda não publicado nesta versão');
    expect(rotuloContagem({ status: 'ok', available: false, withheld: 2 })).not.toBe('Nenhum registro publicado ainda');
    expect(totalPublicado({ status: 'ok', total: 0, available: false, withheld: 2 })).toBeNull();
  });

  it('módulo não publicado nesta versão tem rótulo próprio, sem promessa de data', () => {
    const rotulo = rotuloContagem({ status: 'ok', available: false });
    expect(rotulo).toBe('Ainda não publicado nesta versão');
    expect(rotulo).not.toMatch(/em breve|go-live|fase/i);
    expect(totalPublicado({ status: 'ok', total: 0, available: false })).toBeNull();
  });

  it('publicado e vazio: zero real, com data-count 0 e sem promessa', () => {
    expect(rotuloContagem({ status: 'ok', total: 0, available: true })).toBe('Nenhum registro publicado ainda');
    expect(totalPublicado({ status: 'ok', total: 0 })).toBe(0);
  });

  it('com dado: mostra a contagem real', () => {
    expect(rotuloContagem({ status: 'ok', total: 29, available: true })).toBe('29 cadastrado(s) e verificado(s)');
    expect(totalPublicado({ status: 'ok', total: 29 })).toBe(29);
  });
});

describe('hub a partir das respostas da API (adaptador real)', () => {
  const tile = async (status: number, body: unknown) => {
    const src = createIntelligenceSlice('http://api.invalid', async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    const d = await src.getPeopleDirectory();
    return [rotuloContagem(d), totalPublicado(d)] as const;
  };

  it('HTTP 503 = indisponível', async () => {
    expect(await tile(503, {})).toEqual(['Indisponível no momento', null]);
  });

  it('disponivel:false com itens = retido; sem itens = ainda não publicado', async () => {
    const pessoa = { id: '20000000-0000-4000-8000-000000000001', nome: 'Pessoa MOCK', cargos: [], mock: true };
    expect(await tile(200, { data: [pessoa], total: 1, disponivel: false })).toEqual(['Existe conteúdo, ainda não publicado nesta versão', null]);
    expect(await tile(200, { data: [], total: 0, disponivel: false })).toEqual(['Ainda não publicado nesta versão', null]);
  });

  it('empresas: resposta ok com total 0 = publicado vazio, com zero real', async () => {
    const src = createIntelligenceSlice('http://api.invalid', async () => new Response(JSON.stringify({ data: [], total: 0, tipos: [] }), { status: 200 }));
    const d = await src.getCompanyDirectory();
    expect([rotuloContagem(d), totalPublicado(d)]).toEqual(['Nenhum registro publicado ainda', 0]);
  });
});