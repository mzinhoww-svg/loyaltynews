// Despublicar no CMS: a regra da tela contra as rotas reais (transição, leitura pública), banco PGlite com as migrações e sessões com
// 2º fator por papel. As matérias são criadas pelo próprio teste; nada vai a staging ou produção.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLES, can, type Role } from '@ln/auth';
import { schema } from '@ln/db';
import { call, makeApp, seedEvidence, type Actor } from '../../../app/api/_lib/testkit';
import * as materias from '../../../app/api/materias/route';
import * as transicao from '../../../app/api/materias/[id]/transicao/route';
import * as pubLista from '../../../app/api/publico/materias/route';
import * as pubUma from '../../../app/api/publico/materias/[slug]/route';
import type { RespostaApi } from '../backend';
import { CMS_READ } from './roles';
import {
  DESPUBLICADA, ESTADOS_DESPUBLICAVEIS, NAO_CONFIRMADA, NOTA_INVALIDA, PAPEIS_DESPUBLICAR, SEM_VERSAO,
  executarDespublicacao, interpretarDespublicacao, type TransicaoDespublicar,
} from './despublicar';
import { ARTICLE_TRANSITIONS } from '@ln/contracts';

let app: Awaited<ReturnType<typeof makeApp>>;
const atores = {} as Record<Role, Actor>;
let ev: string[];

beforeAll(async () => {
  app = await makeApp();
  for (const papel of ROLES) atores[papel] = await app.actor(papel);
  ev = await seedEvidence(app.db, 1);
}, 120_000);
afterAll(async () => {
  await app.close();
});

const resposta = (status: number, body: unknown): RespostaApi => ({ status, ok: status < 400, body }) as RespostaApi;
let n = 0;
/** Matéria no estado que o fluxo oficial de publicação deixa (o fluxo em si é testado em editorial/publication.test.ts). */
async function publicada(status: 'publicado' | 'corrigido' = 'publicado') {
  const r = await call(materias.POST, 'POST', {
    path: '/api/materias',
    body: { slug: `despublicar-${++n}`, titulo: `Matéria para despublicar ${n}`, editoria: 'pontos', resumo: 'Resumo curto da matéria.', corpo: 'Texto da matéria de teste.', evidenceIds: [ev[0]] },
    as: atores.editor,
  });
  expect(r.status).toBe(201);
  const m = r.body.data as { id: string; versao: number; slug: string };
  await app.db.update(schema.articles).set({ status, publicadoEm: app.deps.now() }).where(eq(schema.articles.id, m.id));
  return m;
}
const publico = async (slug: string) => (await call(pubUma.GET, 'GET', { path: `/api/publico/materias/${slug}`, params: { slug } })).status;
const naLista = async (slug: string) =>
  ((await call(pubLista.GET, 'GET', { path: '/api/publico/materias', query: { limit: '100' } })).body as { data: { slug: string }[] }).data.some((x) => x.slug === slug);
const linha = async (id: string) => (await app.db.select().from(schema.articles).where(eq(schema.articles.id, id)))[0]!;
const historico = (id: string) => app.db.select().from(schema.articleTransitions).where(eq(schema.articleTransitions.articleId, id));

/** A chamada que a action faz, com a sessão do ator; `envios` guarda o que saiu. */
function rota(id: string, ator: Actor | null) {
  const envios: unknown[] = [];
  const t: TransicaoDespublicar = async (corpo) => {
    envios.push(corpo);
    const x = await call(transicao.POST, 'POST', { params: { id }, body: corpo, as: ator });
    return resposta(x.status, x.body);
  };
  return { t, envios };
}
const pedido = (versao: number) => ({ confirmar: 'sim', nota: 'Pedido da redação: dado incorreto', versao });

describe('quem pode', () => {
  it('os papéis da tela são exatamente os que a rota deixa despublicar, e todos leem o CMS', () => {
    expect([...PAPEIS_DESPUBLICAR]).toEqual(ROLES.filter((p) => can(p, 'materias', 'transition') && can(p, 'materias', 'publish')));
    for (const p of PAPEIS_DESPUBLICAR) expect(CMS_READ).toContain(p);
  });

  it('os estados oferecidos são os que o contrato leva a despublicado', () => {
    const doContrato = Object.entries(ARTICLE_TRANSITIONS).filter(([, para]) => para.includes('despublicado')).map(([de]) => de);
    expect([...ESTADOS_DESPUBLICAVEIS].sort()).toEqual(doContrato.sort());
  });

  it.each(ROLES.filter((p) => !PAPEIS_DESPUBLICAR.includes(p)))('%s: recusado, a matéria segue publicada e na página pública', async (papel) => {
    const m = await publicada();
    const res = await executarDespublicacao(pedido(m.versao), rota(m.id, atores[papel]).t);
    expect(res.ok).toBe(false);
    expect(res.mensagem).toMatch(/^A matéria NÃO foi despublicada: /);
    expect((await linha(m.id)).status).toBe('publicado');
    expect(await historico(m.id)).toEqual([]);
    expect(await publico(m.slug)).toBe(200);
  });

  it('sem sessão e só com senha (sem 2º fator): recusado', async () => {
    const m = await publicada();
    for (const ator of [null, await app.passwordOnly('admin')]) expect((await executarDespublicacao(pedido(m.versao), rota(m.id, ator).t)).ok).toBe(false);
    expect((await linha(m.id)).status).toBe('publicado');
  });
});

describe('sem nota, sem confirmação, sem versão', () => {
  it.each([
    ['sem nota', { nota: '' }, NOTA_INVALIDA],
    ['só espaços', { nota: '     ' }, NOTA_INVALIDA],
    ['nota curta', { nota: 'ok' }, NOTA_INVALIDA],
    ['nota longa demais', { nota: 'a'.repeat(1001) }, NOTA_INVALIDA],
    ['sem confirmação', { confirmar: '' }, NAO_CONFIRMADA],
    ['sem versão', { versao: Number.NaN }, SEM_VERSAO],
  ])('%s: nada é enviado', async (_n, mudanca, mensagem) => {
    const m = await publicada();
    const { t, envios } = rota(m.id, atores.admin);
    expect(await executarDespublicacao({ ...pedido(m.versao), ...mudanca }, t)).toEqual({ ok: false, mensagem });
    expect(envios).toEqual([]);
    expect((await linha(m.id)).status).toBe('publicado');
    expect(await publico(m.slug)).toBe(200);
  });

  it('a rota também recusa sem nota, mesmo chamada direto', async () => {
    const m = await publicada();
    const x = await call(transicao.POST, 'POST', { params: { id: m.id }, body: { para: 'despublicado' }, as: atores.admin });
    expect(x.status).toBe(422);
    expect(x.body.error.code).toBe('NOTE_REQUIRED');
    expect((await linha(m.id)).status).toBe('publicado');
  });
});

describe('despublicar', () => {
  it.each([
    ['admin', 'publicado'],
    ['editor_chefe', 'publicado'],
    ['editor_chefe', 'corrigido'],
  ] as const)('%s sobre matéria %s: some da página e da lista públicas; a nota e o autor ficam no histórico', async (papel, status) => {
    const m = await publicada(status);
    expect(await publico(m.slug)).toBe(200);
    expect(await naLista(m.slug)).toBe(true);
    const { t, envios } = rota(m.id, atores[papel]);
    expect(await executarDespublicacao({ ...pedido(m.versao), nota: '  Pedido da redação: dado incorreto  ' }, t)).toEqual({ ok: true, mensagem: DESPUBLICADA });
    expect(envios).toEqual([{ para: 'despublicado', nota: 'Pedido da redação: dado incorreto', versaoEsperada: m.versao }]);
    expect((await linha(m.id)).status).toBe('despublicado');
    expect(await publico(m.slug)).toBe(404);
    expect(await naLista(m.slug)).toBe(false);
    expect(await historico(m.id)).toMatchObject([{ de: status, para: 'despublicado', actorId: atores[papel].id, nota: 'Pedido da redação: dado incorreto' }]);
  });

  it('a matéria mudou desde a confirmação: recusado', async () => {
    const m = await publicada();
    const res = await executarDespublicacao(pedido(m.versao + 1), rota(m.id, atores.admin).t);
    expect(res).toEqual({ ok: false, mensagem: expect.stringMatching(/^A matéria NÃO foi despublicada: A matéria mudou/) });
    expect((await linha(m.id)).status).toBe('publicado');
  });

  it('segundo envio (clique repetido): recusado, um só registro no histórico', async () => {
    const m = await publicada();
    expect((await executarDespublicacao(pedido(m.versao), rota(m.id, atores.admin).t)).ok).toBe(true);
    const res = await executarDespublicacao(pedido(m.versao), rota(m.id, atores.admin).t);
    expect(res.ok).toBe(false);
    expect(res.mensagem).toMatch(/^A matéria NÃO foi despublicada: /);
    expect(await historico(m.id)).toHaveLength(1);
  });

  it.each([
    ['500', resposta(500, { error: { code: 'INTERNAL_ERROR', message: 'Erro interno.' } })],
    ['503', resposta(503, { error: { code: 'NOT_CONFIGURED', message: 'Banco não configurado neste ambiente.' } })],
    ['200 sem a matéria', resposta(200, {})],
    ['200 ainda publicada', resposta(200, { data: { status: 'publicado' } })],
  ])('%s: não afirma que despublicou nem que não', (_n, r) => {
    const res = interpretarDespublicacao(r);
    expect(res.ok).toBe(false);
    expect(res.mensagem).toMatch(/^Não foi possível confirmar se a matéria foi despublicada: .*Confira o estado/);
  });
});
