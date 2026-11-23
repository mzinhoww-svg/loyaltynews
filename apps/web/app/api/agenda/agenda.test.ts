/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp, type Actor } from '../_lib/testkit';
import { MAX_SUGESTOES_PENDENTES } from '../_lib/agenda';
import * as agenda from './route';
import * as agendaUma from './[id]/route';
import * as moderacao from './[id]/moderacao/route';
import * as pubAgenda from '../publico/agenda/route';
import * as pubAgendaUm from '../publico/agenda/[id]/route';
import * as sugestoes from '../publico/agenda/sugestoes/route';

let app: Awaited<ReturnType<typeof makeApp>>;
let editor: Actor;
let chefe: Actor;
let admin: Actor;
let leitor: Actor;

const sug = (over: Record<string, unknown> = {}) => ({
  titulo: 'Seminário de Fidelização 2026', inicio: '2026-12-10', fim: '2026-12-11', local: 'Rio de Janeiro', fonteUrl: 'https://example.org/seminario', ...over,
});
const suggest = (body: unknown) => call(sugestoes.POST, 'POST', { path: '/api/publico/agenda/sugestoes', body });
const publicTitles = async () => (await call(pubAgenda.GET, 'GET', {})).body.data.map((e: { titulo: string }) => e.titulo);
const rows = () => app.db.select().from(schema.agendaEvents);
const decide = (id: string, body: unknown, as: Actor | null) => call(moderacao.POST, 'POST', { params: { id }, body, as });

beforeAll(async () => {
  app = await makeApp();
  [editor, chefe, admin, leitor] = [await app.actor('editor'), await app.actor('editor_chefe'), await app.actor('admin'), await app.actor('leitor')];
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('evento da redação: nasce aprovado e auditável', () => {
  it('criar pela redação ⇒ aprovado, origem interno, com o moderador; aparece na agenda pública sem campos internos', async () => {
    const r = await call(agenda.POST, 'POST', { body: sug({ titulo: 'Evento da redação' }), as: editor });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ moderacao: 'aprovado', origem: 'interno', moderadoPor: editor.id, patrocinado: false });
    const pub = await call(pubAgenda.GET, 'GET', {});
    const e = pub.body.data.find((x: any) => x.titulo === 'Evento da redação');
    expect(e).toBeTruthy();
    for (const k of ['moderacao', 'origem', 'moderadoPor', 'motivoRejeicao', 'chaveDedupe', 'criadoEm']) expect(e[k]).toBeUndefined();
  });
});

describe('sugestão pública moderada', () => {
  it('sugestão entra PENDENTE, resposta 202 sem id, nada de dado pessoal; não aparece no público até a decisão', async () => {
    const r = await suggest(sug());
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ status: 'recebido' });
    const [row] = (await rows()).filter((x) => x.titulo === 'Seminário de Fidelização 2026');
    expect(row).toMatchObject({ moderacao: 'pendente', origem: 'publico', patrocinado: false, moderadoPor: null, motivoRejeicao: null });
    expect(await publicTitles()).not.toContain('Seminário de Fidelização 2026');
    const lista = await call(agenda.GET, 'GET', { query: { moderacao: 'pendente', origem: 'publico' }, as: editor });
    expect(lista.body.data.map((e: any) => e.titulo)).toContain('Seminário de Fidelização 2026');
  });

  it('corpo estrito: não aceita moderação, patrocínio, contato nem campos extras; datas e títulos suspeitos são recusados', async () => {
    for (const bad of [
      { moderacao: 'aprovado' }, { patrocinado: true }, { origem: 'interno' }, { email: 'a@b.c' }, { contato: 'x' }, { titulo: 'ab' }, { fonteUrl: 'javascript:alert(1)' },
      { url: 'ftp://x.example/a' }, { fim: '2026-12-01' }, { titulo: 'Veja em http://spam.example agora' }, { titulo: 'Compre em www.spam.example' },
      { inicio: '2025-01-01', fim: '2025-01-02' }, { inicio: '2030-01-01', fim: '2030-01-02' }, { inicio: '2026-12-01', fim: '2027-03-01' }, { editorias: ['inventada'] },
    ]) {
      const r = await suggest(sug(bad));
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('honeypot: robô recebe 202 e NADA é gravado; sugestão idêntica pendente não duplica', async () => {
    const antes = (await rows()).length;
    const bot = await suggest(sug({ titulo: 'Evento do robô', site: 'http://spam.example' }));
    expect(bot.status).toBe(202);
    expect((await rows()).length).toBe(antes);
    await suggest(sug({ titulo: 'Congresso repetido' }));
    const dup = await suggest(sug({ titulo: 'congresso REPETIDO' })); // mesmo título (caixa) e início
    expect(dup.status).toBe(202);
    expect((await rows()).filter((e) => e.titulo.toLowerCase() === 'congresso repetido')).toHaveLength(1);
    const outroDia = await suggest(sug({ titulo: 'Congresso repetido', inicio: '2026-12-12', fim: '2026-12-12' }));
    expect(outroDia.status).toBe(202);
    expect((await rows()).filter((e) => e.titulo.toLowerCase() === 'congresso repetido')).toHaveLength(2);
  });

  it('limite por IP (com proxy confiável): 5 sugestões por 15 min, depois 429', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    try {
      const statuses = [];
      for (let i = 0; i < 7; i++) statuses.push((await suggest(sug({ titulo: `Limite por IP ${i}`, inicio: `2026-12-${String(14 + i).padStart(2, '0')}`, fim: `2026-12-${String(14 + i).padStart(2, '0')}` }))).status);
      expect(statuses.filter((s) => s === 202)).toHaveLength(5);
      expect(statuses.filter((s) => s === 429)).toHaveLength(2);
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });

  it(`teto de ${MAX_SUGESTOES_PENDENTES} pendentes: fila cheia ⇒ 429 FILA_CHEIA até a redação decidir`, async () => {
    const pend = (await rows()).filter((e) => e.moderacao === 'pendente' && e.origem === 'publico').length;
    const faltam = MAX_SUGESTOES_PENDENTES - pend;
    const base = new Date('2026-12-01T00:00:00Z');
    const vals = Array.from({ length: faltam }, (_, i) => ({
      id: `cheia-${i}`, titulo: `Enchimento ${i}`, inicio: new Date(base.getTime() + i * 86_400_000 * 0).toISOString().slice(0, 10), fim: '2026-12-02', local: 'X',
      fonteUrl: 'https://example.org', moderacao: 'pendente', origem: 'publico', chaveDedupe: `chave-${i}`,
    }));
    for (let i = 0; i < vals.length; i += 100) await app.db.insert(schema.agendaEvents).values(vals.slice(i, i + 100));
    const r = await suggest(sug({ titulo: 'Depois do teto' }));
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('FILA_CHEIA');
    // moderar libera vaga
    const [um] = (await rows()).filter((e) => e.id === 'cheia-0');
    await decide(um!.id, { estado: 'rejeitado', motivo: 'Teste de capacidade' }, chefe);
    expect((await suggest(sug({ titulo: 'Depois do teto' }))).status).toBe(202);
    await app.db.delete(schema.agendaEvents).where(eq(schema.agendaEvents.origem, 'publico')); // limpa para os demais testes
  });
});

describe('moderação (editor-chefe e admin)', () => {
  it('RBAC: sem sessão 401; editor e leitor 403; editor-chefe e admin decidem', async () => {
    await suggest(sug({ titulo: 'Para moderar RBAC' }));
    const id = (await rows()).find((e) => e.titulo === 'Para moderar RBAC')!.id;
    expect((await decide(id, { estado: 'aprovado' }, null)).status).toBe(401);
    expect((await decide(id, { estado: 'aprovado' }, editor)).status).toBe(403);
    expect((await decide(id, { estado: 'aprovado' }, leitor)).status).toBe(403);
    expect((await decide(id, { estado: 'aprovado' }, chefe)).status).toBe(200);
    expect((await decide(id, { estado: 'rejeitado', motivo: 'Retirada depois de checagem' }, admin)).status).toBe(200);
  });

  it('aprovar publica (e registra quem); rejeitar exige motivo, tira do público e audita; repetir a decisão é inofensivo', async () => {
    await suggest(sug({ titulo: 'Aprovar este', inicio: '2026-12-20', fim: '2026-12-20' }));
    await suggest(sug({ titulo: 'Rejeitar este', inicio: '2026-12-21', fim: '2026-12-21' }));
    const all = await rows();
    const a = all.find((e) => e.titulo === 'Aprovar este')!;
    const r = all.find((e) => e.titulo === 'Rejeitar este')!;

    const ok = await decide(a.id, { estado: 'aprovado' }, chefe);
    expect(ok.body.data).toMatchObject({ moderacao: 'aprovado', moderadoPor: chefe.id, motivoRejeicao: null });
    expect(await publicTitles()).toContain('Aprovar este');
    expect((await decide(a.id, { estado: 'aprovado' }, chefe)).status).toBe(200); // idempotente

    const semMotivo = await decide(r.id, { estado: 'rejeitado' }, chefe);
    expect(semMotivo.status).toBe(400);
    const rej = await decide(r.id, { estado: 'rejeitado', motivo: 'Fonte não confirma a data' }, chefe);
    expect(rej.body.data).toMatchObject({ moderacao: 'rejeitado', motivoRejeicao: 'Fonte não confirma a data', moderadoPor: chefe.id });
    expect(await publicTitles()).not.toContain('Rejeitar este');

    // retirar um aprovado: rejeitar depois, com motivo, também tira do público
    await decide(a.id, { estado: 'rejeitado', motivo: 'Evento cancelado pela organização' }, admin);
    expect(await publicTitles()).not.toContain('Aprovar este');

    const au = await app.db.select().from(schema.auditLog).where(eq(schema.auditLog.resource, 'agenda'));
    const acoes = au.map((x) => x.action);
    expect(acoes).toEqual(expect.arrayContaining(['agenda.aprovado', 'agenda.rejeitado']));
    const motivo = au.find((x) => x.action === 'agenda.rejeitado' && x.resourceId === r.id);
    expect(motivo).toMatchObject({ actorId: chefe.id, actorRole: 'editor_chefe' });
    expect((motivo!.detalhe as any).motivo).toBe('Fonte não confirma a data');
  });

  it('entrada inválida e evento inexistente; estados inventados e campos extras são recusados', async () => {
    expect((await decide('nao-existe', { estado: 'aprovado' }, chefe)).status).toBe(404);
    const id = (await rows())[0]!.id;
    for (const bad of [{ estado: 'pendente' }, { estado: 'publicado' }, { estado: 'aprovado', extra: 1 }, {}, { estado: 'rejeitado', motivo: 'ab' }]) {
      expect((await decide(id, bad, chefe)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('a lista do Studio filtra por moderação e origem; a pública mostra só aprovados', async () => {
    await suggest(sug({ titulo: 'Pendente visível só no Studio', inicio: '2026-12-22', fim: '2026-12-22' }));
    const pend = await call(agenda.GET, 'GET', { query: { moderacao: 'pendente' }, as: editor });
    expect(pend.body.data.every((e: any) => e.moderacao === 'pendente')).toBe(true);
    expect(pend.body.data.map((e: any) => e.titulo)).toContain('Pendente visível só no Studio');
    expect((await call(agenda.GET, 'GET', { query: { moderacao: 'inventado' }, as: editor })).status).toBe(400);
    expect(await publicTitles()).not.toContain('Pendente visível só no Studio');
    const id = (await rows()).find((e) => e.titulo === 'Pendente visível só no Studio')!.id;
    // editar uma sugestão pendente (corrigir erro de digitação) não a aprova
    const p = await call(agendaUma.PATCH, 'PATCH', { params: { id }, body: { local: 'Local corrigido' }, as: editor });
    expect(p.body.data).toMatchObject({ local: 'Local corrigido', moderacao: 'pendente' });
  });
});

describe('GET /api/publico/agenda/:id (página do evento)', () => {
  const um = (id: string) => call(pubAgendaUm.GET, 'GET', { path: `/api/publico/agenda/${id}`, params: { id } });
  const ev = (id: string, over: Record<string, unknown> = {}) =>
    app.db.insert(schema.agendaEvents).values({ id, titulo: `Evento ${id}`, inicio: '2099-05-01', fim: '2099-05-02', local: 'São Paulo', fonteUrl: 'https://example.org/e', editorias: ['pontos'], moderacao: 'aprovado', ...over } as any);

  it('aprovado abre com o mesmo formato público da lista (sem campos de moderação), com cache de 300 s', async () => {
    await ev('um-ok', { patrocinado: true, url: 'https://example.org/inscricao' });
    const r = await um('um-ok');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ id: 'um-ok', titulo: 'Evento um-ok', inicio: '2099-05-01', fim: '2099-05-02', local: 'São Paulo', url: 'https://example.org/inscricao', editorias: ['pontos'], patrocinado: true, fonteUrl: 'https://example.org/e' });
    expect(r.headers.get('cache-control')).toBe('public, max-age=300');
    const naLista = (await call(pubAgenda.GET, 'GET', {})).body.data.find((x: any) => x.id === 'um-ok');
    expect(r.body.data).toEqual(naLista); // exatamente o `publicView` da lista
  });

  it('evento já encerrado continua abrindo (a lista não o traz, a página sim)', async () => {
    await ev('um-passado', { inicio: '2020-01-01', fim: '2020-01-02' });
    expect((await um('um-passado')).status).toBe(200);
    expect((await call(pubAgenda.GET, 'GET', {})).body.data.map((x: any) => x.id)).not.toContain('um-passado');
  });

  it('pendente, rejeitado e inexistente dão o MESMO 404 NOT_FOUND (não revela sugestão em moderação)', async () => {
    await ev('um-pendente', { moderacao: 'pendente', origem: 'publico' });
    await ev('um-rejeitado', { moderacao: 'rejeitado', motivoRejeicao: 'duplicado' });
    const respostas = await Promise.all(['um-pendente', 'um-rejeitado', 'nao-existe'].map(um));
    for (const r of respostas) expect([r.status, r.body.error.code]).toEqual([404, 'NOT_FOUND']);
    expect(new Set(respostas.map((r) => r.body.error.message)).size).toBe(1);
    expect(JSON.stringify(respostas.map((r) => r.body))).not.toContain('duplicado');
  });

  it('sem login e sem vazar campo interno: nenhum campo de moderação, autor ou chave', async () => {
    await ev('um-campos', { moderadoPor: 'u-1', chaveDedupe: 'abc', origem: 'interno' });
    const d = (await um('um-campos')).body.data;
    for (const k of ['moderacao', 'origem', 'moderadoPor', 'moderadoEm', 'motivoRejeicao', 'chaveDedupe', 'criadoEm']) expect(d[k], k).toBeUndefined();
  });
});
