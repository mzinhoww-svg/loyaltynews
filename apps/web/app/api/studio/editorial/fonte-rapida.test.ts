/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import { call, makeApp, type Actor } from '../../_lib/testkit';
import * as fonteRapida from './fontes/rapida/route';
import * as evidencias from './evidencias/route';
import * as fonte from '../../fontes/[id]/route';

// P2-05: fonte rápida e evidência dentro da Nova matéria. Sem rede, só o trecho, idempotente por chave, só papel de escrita, auditado.
let app: Awaited<ReturnType<typeof makeApp>>;
let editor: Actor, chefe: Actor, revisor: Actor, leitor: Actor, comercial: Actor;
const fonteIn = (over: Record<string, unknown> = {}) => ({ chave: 'fr-0001-abc', url: 'https://www.Exemplo-Banco.com.br/imprensa', nome: 'Sala de imprensa do Banco Exemplo', tipo: 'comunicado', licenca: 'termos_do_site', editoria: 'bancos', ...over });
const evIn = (over: Record<string, unknown> = {}) => ({ chave: 'ev-0001-abc', articleId: 'rasc-1', url: 'https://www.exemplo-banco.com.br/imprensa/nota-1', trecho: 'O banco anunciou a mudança na regra de acúmulo a partir de 1º de dezembro.', ...over });
const postFonte = (body: unknown, as: Actor | null = editor) => call(fonteRapida.POST, 'POST', { body, as });
const postEv = (body: unknown, as: Actor | null = editor) => call(evidencias.POST, 'POST', { body, as });
const fetchSpy = vi.spyOn(globalThis, 'fetch');

beforeAll(async () => {
  app = await makeApp();
  const art = (id: string, status: string) => ({ id, slug: id, titulo: `T ${id}`, resumo: 'r', corpo: 'x', editoria: 'bancos', status, publicadoEm: status === 'publicado' ? new Date() : null, classeDeDado: 'public' }) as any;
  await app.db.insert(schema.articles).values([art('rasc-1', 'rascunho'), art('pub-1', 'publicado')]);
  [editor, chefe, revisor, leitor, comercial] = await Promise.all([app.actor('editor'), app.actor('editor_chefe'), app.actor('revisor'), app.actor('leitor'), app.actor('comercial')]);
  fetchSpy.mockClear();
}, 180_000);
afterAll(async () => {
  expect(fetchSpy).not.toHaveBeenCalled(); // nenhuma rota buscou a URL
  fetchSpy.mockRestore();
  await app.close();
});

describe('POST /api/studio/editorial/fontes/rapida', () => {
  it('cria fonte pública mínima "a confirmar", inativa, sem termos revisados, com licença e editoria; URL normalizada; auditada', async () => {
    const r = await postFonte(fonteIn());
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ url: 'https://www.exemplo-banco.com.br/imprensa', revisao: 'a_confirmar', ativo: false, termosRevisados: false, acesso: 'publico', licenca: 'termos_do_site', tipo: 'comunicado' });
    expect(r.body.data.id).toMatch(/^rapida-[0-9a-f]{8}$/);
    const [row] = await app.db.select().from(schema.sources).where(eq(schema.sources.id, r.body.data.id));
    expect([row!.criadoPor, row!.origem]).toEqual([editor.id, 'cms']);
    const eds = await app.db.select().from(schema.sourceEditorias).where(eq(schema.sourceEditorias.sourceId, r.body.data.id));
    expect(eds.map((e) => e.editoria)).toEqual(['bancos']);
    const aud = await app.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'fonte.rapida_criada'));
    expect(aud.map((a) => a.actorId)).toEqual([editor.id]);
  });

  it('idempotente: mesma chave e mesmos dados → 200 com a mesma fonte (uma linha); mesma chave com outros dados → 409; mesma URL com outra chave → 409 SOURCE_EXISTS com o id', async () => {
    const again = await postFonte(fonteIn());
    expect([again.status, again.body.existente]).toEqual([200, true]);
    expect(await app.db.$count(schema.sources, eq(schema.sources.chaveIdem, 'fr-0001-abc'))).toBe(1);
    expect((await postFonte(fonteIn({ nome: 'Outro nome' }))).body.error.code).toBe('IDEMPOTENCY_MISMATCH');
    const dup = await postFonte(fonteIn({ chave: 'fr-0002-abc' }));
    expect([dup.status, dup.body.error.code, dup.body.error.details.id]).toEqual([409, 'SOURCE_EXISTS', again.body.data.id]);
    const par = await Promise.all(Array.from({ length: 4 }, () => postFonte(fonteIn({ chave: 'fr-par-0001', url: 'https://paralelo.example/x' }))));
    expect(new Set(par.map((p) => p.body.data.id)).size).toBe(1);
    expect(await app.db.$count(schema.sources, eq(schema.sources.chaveIdem, 'fr-par-0001'))).toBe(1);
  });

  it('validação: só https, sem credencial na URL, tipo/licença/editoria do catálogo, campos extras recusados (ativo, termosRevisados, id)', async () => {
    for (const bad of [
      fonteIn({ chave: 'fr-v-0001', url: 'http://inseguro.example/' }),
      fonteIn({ chave: 'fr-v-0002', url: 'https://user:senha@site.example/' }),
      fonteIn({ chave: 'fr-v-0003', url: 'javascript:alert(1)' }),
      fonteIn({ chave: 'fr-v-0004', tipo: 'pdf' }),
      fonteIn({ chave: 'fr-v-0005', licenca: 'livre' }),
      fonteIn({ chave: 'fr-v-0006', editoria: 'inexistente' }),
      fonteIn({ chave: 'fr-v-0007', ativo: true }),
      fonteIn({ chave: 'fr-v-0008', termosRevisados: true }),
      fonteIn({ chave: 'fr-v-0009', id: 'minha-fonte' }),
      fonteIn({ chave: 'curta' }),
      fonteIn({ chave: 'fr-v-0010', nome: '   ' }),
    ]) {
      const r = await postFonte(bad);
      expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    }
  });

  it('RBAC: sem sessão 401; revisor, leitor e comercial 403 (sem escrita de fontes); editor-chefe cria', async () => {
    expect((await postFonte(fonteIn({ chave: 'fr-r-0001', url: 'https://r1.example/' }), null)).status).toBe(401);
    for (const a of [revisor, leitor, comercial]) expect((await postFonte(fonteIn({ chave: 'fr-r-0002', url: 'https://r2.example/' }), a)).status).toBe(403);
    expect((await postFonte(fonteIn({ chave: 'fr-r-0003', url: 'https://r3.example/' }), chefe)).status).toBe(201);
  });

  it('nunca habilitada para coleta: ativar a fonte "a confirmar" sem revisar os termos é recusado (API 409 e CHECK do banco); revisar os termos a confirma', async () => {
    const r = await postFonte(fonteIn({ chave: 'fr-c-0001', url: 'https://confirmar.example/' }));
    const id = r.body.data.id as string;
    const ativa = await call(fonte.PATCH, 'PATCH', { params: { id }, body: { ativo: true }, as: chefe });
    expect([ativa.status, ativa.body.error.code]).toEqual([409, 'TERMS_NOT_REVIEWED']);
    await expect(app.db.update(schema.sources).set({ ativo: true, termosRevisados: true }).where(eq(schema.sources.id, id))).rejects.toThrow(); // CHECK sources_a_confirmar_inativa
    const rev = await call(fonte.PATCH, 'PATCH', { params: { id }, body: { termosRevisados: true }, as: chefe });
    expect(rev.status).toBe(200);
    const [row] = await app.db.select().from(schema.sources).where(eq(schema.sources.id, id));
    expect([row!.revisao, row!.ativo]).toEqual(['confirmada', false]); // confirmada, mas ativar continua sendo um ato separado
  });
});

describe('POST /api/studio/editorial/evidencias', () => {
  it('liga URL + trecho a matéria em rascunho: 201, "a confirmar", só o trecho guardado; não vira evidence capturada (gates intactos); auditada', async () => {
    const r = await postEv(evIn());
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ articleId: 'rasc-1', estado: 'a_confirmar', sourceId: null, criadoPor: editor.id, trecho: evIn().trecho });
    const [row] = await app.db.select().from(schema.editorialEvidencias).where(eq(schema.editorialEvidencias.id, r.body.data.id));
    expect(Object.keys(row!).sort()).toEqual(['articleId', 'chaveIdem', 'criadoEm', 'criadoPor', 'estado', 'id', 'sourceId', 'trecho', 'trechoSha256', 'url']); // nada além do trecho
    expect(await app.db.$count(schema.evidences)).toBe(0);
    expect(await app.db.$count(schema.articleSources)).toBe(0);
    expect(await app.db.$count(schema.auditLog, eq(schema.auditLog.action, 'evidencia.rapida_criada'))).toBe(1);
  });

  it('com a fonte rápida: sourceId existente aceito; inexistente 404; a lista da matéria traz as evidências', async () => {
    const [s] = await app.db.select({ id: schema.sources.id }).from(schema.sources).where(eq(schema.sources.chaveIdem, 'fr-0001-abc'));
    const r = await postEv(evIn({ chave: 'ev-0002-abc', sourceId: s!.id, trecho: 'Outro trecho da mesma nota.' }));
    expect([r.status, r.body.data.sourceId]).toEqual([201, s!.id]);
    expect((await postEv(evIn({ chave: 'ev-0003-abc', sourceId: 'nao-existe' }))).body.error.code).toBe('SOURCE_NOT_FOUND');
    const l = await call(evidencias.GET, 'GET', { query: { articleId: 'rasc-1' }, as: revisor });
    expect([l.status, l.body.total]).toEqual([200, 2]);
    expect((await call(evidencias.GET, 'GET', { as: revisor })).status).toBe(400);
  });

  it('idempotente por chave (200 / 409), inclusive em paralelo', async () => {
    const again = await postEv(evIn());
    expect([again.status, again.body.existente]).toEqual([200, true]);
    expect((await postEv(evIn({ trecho: 'Trecho diferente.' }))).body.error.code).toBe('IDEMPOTENCY_MISMATCH');
    const par = await Promise.all(Array.from({ length: 4 }, () => postEv(evIn({ chave: 'ev-par-0001', trecho: 'Paralelo.' }))));
    expect(new Set(par.map((p) => p.body.data.id)).size).toBe(1);
    expect(await app.db.$count(schema.editorialEvidencias, eq(schema.editorialEvidencias.chaveIdem, 'ev-par-0001'))).toBe(1);
  });

  it('matéria publicada 409 ARTICLE_NOT_DRAFT; inexistente 404; trecho > 500, vazio, URL http e campo extra 400', async () => {
    expect((await postEv(evIn({ chave: 'ev-p-0001', articleId: 'pub-1' }))).body.error.code).toBe('ARTICLE_NOT_DRAFT');
    expect((await postEv(evIn({ chave: 'ev-p-0002', articleId: 'nao-existe' }))).status).toBe(404);
    expect((await postEv(evIn({ chave: 'ev-p-0003', trecho: 'x'.repeat(500) }))).status).toBe(201); // 500 é o teto aceito
    for (const bad of [evIn({ chave: 'ev-p-0004', trecho: 'x'.repeat(501) }), evIn({ chave: 'ev-p-0005', trecho: '  ' }), evIn({ chave: 'ev-p-0006', url: 'http://x.example/' }), evIn({ chave: 'ev-p-0007', corpo: 'página inteira' })]) {
      expect((await postEv(bad)).status).toBe(400);
    }
  });

  it('RBAC: sem sessão 401; revisor, leitor e comercial 403 (sem materias:update); editor-chefe grava', async () => {
    expect((await postEv(evIn({ chave: 'ev-r-0001' }), null)).status).toBe(401);
    for (const a of [revisor, leitor, comercial]) expect((await postEv(evIn({ chave: 'ev-r-0002' }), a)).status).toBe(403);
    expect((await postEv(evIn({ chave: 'ev-r-0003', trecho: 'Do editor-chefe.' }), chefe)).status).toBe(201);
    expect(await app.db.$count(schema.editorialEvidencias, and(eq(schema.editorialEvidencias.chaveIdem, 'ev-r-0002')))).toBe(0);
  });
});

describe('migração fonte_rapida_evidencias', () => {
  const DIR = fileURLToPath(new URL('../../../../../../packages/db/drizzle/', import.meta.url));
  const TAG = readdirSync(DIR).find((f) => /^\d{4}_fonte_rapida_evidencias\.sql$/.test(f))!.replace(/\.sql$/, '');
  const UP = readFileSync(`${DIR}${TAG}.sql`, 'utf8');
  const DOWN = readFileSync(`${DIR}down/${TAG}.down.sql`, 'utf8');
  const JOURNAL = JSON.parse(readFileSync(`${DIR}meta/_journal.json`, 'utf8')) as { entries: { tag: string; when: number }[] };

  it('desce e sobe de novo; fontes antigas ficam "confirmada" ao subir (nada muda para elas)', async () => {
    const t = await createTestDb();
    try {
      const cols = async () => (await t.client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'sources' ORDER BY 1`)).rows.map((r) => r.column_name);
      const reg = async () => Number((await t.client.query<{ n: string }>(`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`)).rows[0]!.n);
      const antes = await reg();
      await t.client.exec(DOWN);
      expect(await cols()).not.toContain('revisao');
      expect((await t.client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'editorial_evidencias'`)).rows).toHaveLength(0);
      expect(await reg()).toBe(antes - 1);
      await t.client.exec(`INSERT INTO sources (id, nome, url, tipo, ativo, termos_revisados) VALUES ('antiga', 'Antiga', 'https://antiga.example', 'site', true, true)`);
      for (const s of UP.split('--> statement-breakpoint')) if (s.trim()) await t.client.exec(s);
      const r = await t.client.query<{ revisao: string; ativo: boolean }>(`SELECT revisao, ativo FROM sources WHERE id = 'antiga'`);
      expect(r.rows).toEqual([{ revisao: 'confirmada', ativo: true }]);
    } finally {
      await t.close();
    }
  }, 120_000);

  it('o down só toca nesta tabela, nas colunas novas de sources e no registro desta migração', () => {
    expect([...DOWN.matchAll(/DROP TABLE IF EXISTS (\w+);/g)].map((m) => m[1])).toEqual(['editorial_evidencias']);
    expect([...DOWN.matchAll(/DROP COLUMN IF EXISTS (\w+);/g)].map((m) => m[1]).sort()).toEqual(['chave_idem', 'criado_por', 'licenca', 'revisao']);
    expect(DOWN).toContain(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${JOURNAL.entries.find((e) => e.tag === TAG)!.when};`);
    expect(DOWN.replace(/--.*$/gm, '')).not.toMatch(/\bDROP (SCHEMA|DATABASE)\b|TRUNCATE|\bDELETE FROM (?!drizzle\.__drizzle_migrations)/i);
  });
});
