/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp, MemoryBlobStore } from '../_lib/testkit';
import * as publica from '../publico/midia/[id]/route';
import * as arquivoStudio from './[id]/arquivo/route';
import * as pubOne from '../publico/materias/[slug]/route';
import * as pubList from '../publico/materias/route';

// Entrega pública de mídia: só imagem citada por matéria publicada/corrigida; nada de listar o acervo.
let app: Awaited<ReturnType<typeof makeApp>>;
let blob: MemoryBlobStore;
let n = 0;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...Array.from({ length: 40 }, (_, i) => i)]);
const get = (id: string, headers: Record<string, string> = {}) =>
  publica.GET(new Request(`http://localhost:3000/api/publico/midia/${id}`, { headers: { 'x-forwarded-for': '10.9.0.2', ...headers } }), { params: Promise.resolve({ id }) });

/** Mídia no acervo (registro + arquivo no Blob). */
async function midia(over: Partial<typeof schema.media.$inferInsert> = {}, bytes: Uint8Array = PNG, mime = 'image/png') {
  const id = `m-${++n}`;
  const sha256 = createHash('sha256').update(`${id}`).digest('hex');
  const direitos = { url: `http://localhost:3000/api/midia/${id}/arquivo`, origem: 'propria', credito: 'Loyalty News', baseDeDireito: 'propria', textoAlternativo: 'Ilustração', edicoes: [] };
  await blob.put(`midia/${sha256}`, bytes, mime);
  await app.db.insert(schema.media).values({ id, tipo: 'imagem', direitos, sha256, blobKey: `midia/${sha256}`, mime, bytes: bytes.length, ...over });
  return { id, sha256, direitos };
}
async function materia(status: string, imagem: unknown, over: Record<string, unknown> = {}) {
  const id = `art-${++n}`;
  await app.db.insert(schema.articles).values({
    id, slug: id, titulo: 'T', editoria: 'pontos', corpo: 'C', resumo: 'R', status: status as any, imagem,
    publicadoEm: status === 'publicado' || status === 'corrigido' ? new Date('2026-11-20T10:00:00Z') : null, ...over,
  } as any);
  return id;
}

beforeAll(async () => {
  app = await makeApp();
  blob = new MemoryBlobStore();
  app.deps.blob = blob;
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('GET /api/publico/midia/{id}', () => {
  it('imagem citada por matéria publicada: 200 sem login, bytes, MIME do registro, nosniff, CSP sandbox, cache público e ETag; If-None-Match ⇒ 304', async () => {
    const m = await midia();
    await materia('publicado', m.direitos);
    const r = await get(m.id);
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(r.headers.get('cache-control')).toContain('public');
    expect(r.headers.get('etag')).toBe(`"${m.sha256}"`);
    expect(r.headers.get('set-cookie')).toBeNull();
    const nm = await get(m.id, { 'if-none-match': `"${m.sha256}"` });
    expect(nm.status).toBe(304);
    expect((await nm.arrayBuffer()).byteLength).toBe(0);
  });

  it('matéria corrigida também vale; a rota do Studio segue exigindo sessão', async () => {
    const m = await midia();
    await materia('corrigido', m.direitos);
    expect((await get(m.id)).status).toBe(200);
    const st = await call(arquivoStudio.GET, 'GET', { params: { id: m.id } });
    expect(st.status).toBe(401);
  });

  it('MESMO 404 para tudo que não é público: inexistente, sem matéria, rascunho/aprovado/despublicado/bloqueado, classe não pública, documento, sem arquivo, base pendente, licença vencida, id estranho', async () => {
    const corpos = new Set<string>();
    const nao = async (id: string, why: string) => {
      const r = await get(id);
      expect(r.status, why).toBe(404);
      const e = (await r.json()).error;
      corpos.add(`${e.code}|${e.message}`);
    };
    await nao('nao-existe', 'inexistente');
    const orfa = await midia();
    await nao(orfa.id, 'sem matéria');
    for (const st of ['rascunho', 'em_checagem', 'aprovado', 'despublicado', 'bloqueado']) {
      const m = await midia();
      await materia(st, m.direitos);
      await nao(m.id, `matéria ${st}`);
    }
    const priv = await midia();
    await materia('publicado', priv.direitos, { classeDeDado: 'internal' });
    await nao(priv.id, 'classe não pública');
    const doc = await midia({ tipo: 'documento' }, new TextEncoder().encode('%PDF-1.7 x'), 'application/pdf');
    await materia('publicado', doc.direitos);
    await nao(doc.id, 'documento');
    const semArq = await midia({ blobKey: null, mime: null, bytes: null });
    await materia('publicado', semArq.direitos);
    await nao(semArq.id, 'sem arquivo');
    const pend = await midia({ direitos: { url: 'http://localhost:3000/api/midia/p/arquivo', origem: 'propria', credito: 'X', baseDeDireito: 'pendente', textoAlternativo: 'x', edicoes: [] } });
    await materia('publicado', { url: `http://localhost:3000/api/midia/${pend.id}/arquivo`, origem: 'propria', credito: 'X', baseDeDireito: 'pendente', textoAlternativo: 'x', edicoes: [] });
    await nao(pend.id, 'base de direito pendente');
    const venc = await midia({ licencaExpiraEm: '2020-01-01' });
    await materia('publicado', venc.direitos);
    await nao(venc.id, 'licença vencida');
    for (const id of ['../etc/passwd', 'a'.repeat(80), 'a%20b', "x'--"]) await nao(id, `id estranho ${id}`);
    expect(corpos.size).toBe(1); // não revela por que
  });

  it('arquivo sumido do Blob: 404; mídia que ficou sem matéria publicada some do público', async () => {
    const m = await midia();
    const art = await materia('publicado', m.direitos);
    expect((await get(m.id)).status).toBe(200);
    await app.db.update(schema.articles).set({ status: 'despublicado' }).where(eq(schema.articles.id, art));
    expect((await get(m.id)).status).toBe(404);
    await app.db.update(schema.articles).set({ status: 'publicado' }).where(eq(schema.articles.id, art));
    blob.objects.delete(`midia/${m.sha256}`);
    expect((await get(m.id)).status).toBe(404);
  });

  it('não há listagem do acervo na área pública (só GET por id)', () => {
    expect(Object.keys(publica).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(['GET']);
  });
});

describe('leituras públicas usam a entrega pública', () => {
  it('imagem da matéria aponta para /api/publico/midia/{id} (e essa URL carrega); imagem externa fica como está', async () => {
    const m = await midia();
    const slug = await materia('publicado', m.direitos);
    const one = await call(pubOne.GET, 'GET', { params: { slug } });
    expect(one.status).toBe(200);
    expect(one.body.data.imagem.url).toBe(`http://localhost:3000/api/publico/midia/${m.id}`);
    expect(one.body.data.imagem.url).not.toContain('/api/midia/');
    expect((await get(m.id)).status).toBe(200);

    const ext = await materia('publicado', { url: 'https://cdn.example.org/foto.jpg', origem: 'licenciada', credito: 'Agência X', baseDeDireito: 'licenca', textoAlternativo: 'x', edicoes: [] });
    expect((await call(pubOne.GET, 'GET', { params: { slug: ext } })).body.data.imagem.url).toBe('https://cdn.example.org/foto.jpg');
  });

  it('mídia com licença vencida ou sem arquivo: a matéria sai SEM imagem (null), nunca com link quebrado', async () => {
    const venc = await midia({ licencaExpiraEm: '2020-01-01' });
    const a = await materia('publicado', venc.direitos);
    expect((await call(pubOne.GET, 'GET', { params: { slug: a } })).body.data.imagem).toBeNull();
    const semArq = await midia({ blobKey: null, mime: null, bytes: null });
    const b = await materia('publicado', semArq.direitos);
    expect((await call(pubOne.GET, 'GET', { params: { slug: b } })).body.data.imagem).toBeNull();
    const c = await materia('publicado', { url: 'http://localhost:3000/api/midia/inexistente/arquivo', origem: 'propria', credito: 'X', baseDeDireito: 'propria', textoAlternativo: 'x', edicoes: [] });
    expect((await call(pubOne.GET, 'GET', { params: { slug: c } })).body.data.imagem).toBeNull();
  });
});

describe('imagem na listagem pública (GET /api/publico/materias)', () => {
  const item = async (slug: string) => {
    const r = await call(pubList.GET, 'GET', { query: { limit: '100' } });
    expect(r.status).toBe(200);
    return r.body.data.find((x: any) => x.slug === slug);
  };

  it('item com imagem do acervo: só {url pública, textoAlternativo, credito, rotulo}; a URL carrega; nada interno', async () => {
    const m = await midia();
    const slug = await materia('publicado', m.direitos);
    const it_ = await item(slug);
    expect(it_.imagem).toEqual({ url: `http://localhost:3000/api/publico/midia/${m.id}`, textoAlternativo: 'Ilustração', credito: 'Loyalty News', rotulo: null });
    expect((await get(m.id)).status).toBe(200);
    const raw = JSON.stringify(it_);
    for (const interno of ['origem', 'baseDeDireito', 'edicoes', 'sha256', 'blobKey', 'licenca', m.sha256, '/api/midia/', 'bytes', 'mime']) expect(raw).not.toContain(interno);
    expect(Object.keys(it_.imagem).sort()).toEqual(['credito', 'rotulo', 'textoAlternativo', 'url']);
  });

  it('ilustração gerada leva o rótulo "Ilustração conceitual" e nenhum dado de geração', async () => {
    const ilus = { url: 'x', origem: 'ilustracao_gerada', credito: 'Loyalty News', baseDeDireito: 'gerada_ia', textoAlternativo: 'Ilustração conceitual: cartões e gráfico', edicoes: [] };
    const m = await midia({ direitos: ilus });
    const slug = await materia('publicado', { ...ilus, url: `http://localhost:3000/api/midia/${m.id}/arquivo`, generatedBy: 'modelo-x', promptSha256: 'f'.repeat(64) });
    const it_ = await item(slug);
    expect(it_.imagem).toMatchObject({ rotulo: 'Ilustração conceitual', credito: 'Loyalty News', textoAlternativo: 'Ilustração conceitual: cartões e gráfico' });
    const raw = JSON.stringify(it_);
    for (const proibido of ['generatedBy', 'modelo-x', 'promptSha256', 'ilustracao_gerada', 'gerada_ia']) expect(raw).not.toContain(proibido);
    // a leitura da matéria também traz o rótulo
    const one = await call(pubOne.GET, 'GET', { params: { slug } });
    expect(one.body.data.imagem.rotulo).toBe('Ilustração conceitual');
  });

  it('licença vencida, sem arquivo, mídia inexistente, base pendente e sem imagem: imagem null (o item continua na lista)', async () => {
    const venc = await midia({ licencaExpiraEm: '2020-01-01' });
    const a = await materia('publicado', venc.direitos);
    const semArq = await midia({ blobKey: null, mime: null, bytes: null });
    const b = await materia('publicado', semArq.direitos);
    const c = await materia('publicado', { url: 'http://localhost:3000/api/midia/inexistente/arquivo', origem: 'propria', credito: 'X', baseDeDireito: 'propria', textoAlternativo: 'x', edicoes: [] });
    const pend = { url: 'http://localhost:3000/api/midia/zz/arquivo', origem: 'propria', credito: 'X', baseDeDireito: 'pendente', textoAlternativo: 'x', edicoes: [] };
    const d = await materia('publicado', pend);
    const e = await materia('publicado', null);
    for (const slug of [a, b, c, d, e]) {
      const it_ = await item(slug);
      expect(it_, slug).toBeTruthy();
      expect(it_.imagem, slug).toBeNull();
    }
  });

  it('imagem externa aparece como card (sem campos internos); itens só públicos continuam valendo (rascunho fora da lista)', async () => {
    const ext = await materia('publicado', { url: 'https://cdn.example.org/foto.jpg', origem: 'licenciada', credito: 'Agência X', baseDeDireito: 'licenca', textoAlternativo: 'Foto', edicoes: [] });
    expect((await item(ext)).imagem).toEqual({ url: 'https://cdn.example.org/foto.jpg', textoAlternativo: 'Foto', credito: 'Agência X', rotulo: null });
    const m = await midia();
    const rasc = await materia('rascunho', m.direitos);
    expect(await item(rasc)).toBeUndefined();
  });
});
