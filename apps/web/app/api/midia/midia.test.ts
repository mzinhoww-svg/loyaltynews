/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp, MemoryBlobStore, type Actor } from '../_lib/testkit';
import { hoje, licencaStatus, sniff } from '../_lib/midia';
import * as midia from './route';
import * as midiaUma from './[id]/route';
import * as upload from './arquivo/route';
import * as arquivo from './[id]/arquivo/route';

let app: Awaited<ReturnType<typeof makeApp>>;
let editor: Actor;
let chefe: Actor;
let leitor: Actor;
let blob: MemoryBlobStore;

const sha = (n: string) => createHash('sha256').update(n).digest('hex');
const direitos = {
  url: 'https://example.org/foto.jpg', origem: 'licenciada', credito: 'Agência X', baseDeDireito: 'licenca', textoAlternativo: 'Descrição da foto',
};
const evid = { tipo: 'contrato', referencia: 'Contrato 2026-114 com a Agência X', descricao: 'Licença editorial anual' };
const plus = (days: number) => new Date(Date.parse(`${hoje(new Date('2026-11-22T12:00:00Z'))}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** PNG válido mínimo (assinatura + IHDR/IDAT/IEND); o servidor só confere a assinatura. */
const png = (extra = 0) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...Array.from({ length: 40 + extra }, (_, i) => i % 251)]);

const metaUpload = (over: Record<string, unknown> = {}) => ({
  direitos: { origem: 'propria', credito: 'Loyalty News', baseDeDireito: 'propria', textoAlternativo: 'Ilustração da matéria' }, ...over,
});

async function send(handler: (r: Request, c?: any) => Promise<Response>, bytes: Uint8Array | null, meta: unknown, as: Actor | null, name = 'foto.png') {
  const fd = new FormData();
  if (bytes) fd.set('arquivo', new File([bytes as BlobPart], name));
  fd.set('metadados', typeof meta === 'string' ? meta : JSON.stringify(meta));
  const res = await handler(
    new Request('http://localhost:3000/api/midia/arquivo', { method: 'POST', body: fd, headers: { 'x-forwarded-for': '10.9.0.2', ...(as ? { cookie: as.cookie } : {}) } }),
    { params: Promise.resolve({}) },
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  app = await makeApp();
  [editor, chefe, leitor] = [await app.actor('editor'), await app.actor('editor_chefe'), await app.actor('leitor')];
}, 120_000);
afterAll(async () => {
  await app.close();
});
const resetBlob = () => {
  blob = new MemoryBlobStore();
  app.deps.blob = blob;
};

describe('utilitários puros', () => {
  it('sniff reconhece só JPEG, PNG, GIF, WebP e PDF; SVG, HTML e lixo não', () => {
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniff(png())?.mime).toBe('image/png');
    expect(sniff(new TextEncoder().encode('GIF89a....'))?.mime).toBe('image/gif');
    expect(sniff(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))?.mime).toBe('image/webp');
    expect(sniff(new TextEncoder().encode('%PDF-1.7 ...'))).toEqual({ mime: 'application/pdf', tipo: 'documento' });
    expect(sniff(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniff(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniff(new Uint8Array([]))).toBeNull();
  });
  it('licencaStatus: sem expiração, válida, vence em breve (30 dias) e vencida', () => {
    expect(licencaStatus(null, '2026-11-22')).toBe('sem_expiracao');
    expect(licencaStatus('2027-06-01', '2026-11-22')).toBe('valida');
    expect(licencaStatus('2026-12-22', '2026-11-22')).toBe('vence_em_breve');
    expect(licencaStatus('2026-11-22', '2026-11-22')).toBe('vence_em_breve');
    expect(licencaStatus('2026-11-21', '2026-11-22')).toBe('vencida');
  });
});

describe('metadados, licença e deduplicação', () => {
  it('licença/autorização/exceção exigem evidência; expiração no passado é recusada; com evidência registra', async () => {
    const base = { tipo: 'imagem', direitos, sha256: sha('m1') };
    const sem = await call(midia.POST, 'POST', { body: base, as: editor });
    expect(sem.status).toBe(422);
    expect(sem.body.error.code).toBe('LICENSE_EVIDENCE_REQUIRED');
    const passado = await call(midia.POST, 'POST', { body: { ...base, licencaEvidencia: evid, licencaExpiraEm: '2020-01-01' }, as: editor });
    expect(passado.body.error.code).toBe('LICENSE_EXPIRED');
    expect((await call(midia.POST, 'POST', { body: { ...base, licencaEvidencia: { tipo: 'url', referencia: 'javascript:alert(1)' } }, as: editor })).status).toBe(400);
    const ok = await call(midia.POST, 'POST', { body: { ...base, licencaEvidencia: evid, licencaExpiraEm: '2027-12-31' }, as: editor });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ temArquivo: false, licencaStatus: 'valida', publicavel: true, licencaEvidencia: evid, licencaExpiraEm: '2027-12-31' });
    expect(ok.body.data.blobKey).toBeUndefined(); // a chave interna do Blob não sai
    const propria = await call(midia.POST, 'POST', { body: { tipo: 'imagem', direitos: { ...direitos, origem: 'propria', baseDeDireito: 'propria' }, sha256: sha('m2') }, as: editor });
    expect(propria.status).toBe(201); // base própria não exige evidência
  });

  it('deduplicação por sha256: o mesmo conteúdo devolve o registro existente (200) e não cria outro', async () => {
    const body = { tipo: 'imagem', direitos: { ...direitos, baseDeDireito: 'propria', origem: 'propria' }, sha256: sha('dup') };
    const a = await call(midia.POST, 'POST', { body, as: editor });
    const b = await call(midia.POST, 'POST', { body, as: editor });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ deduplicada: true });
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await app.db.$count(schema.media, eq(schema.media.sha256, sha('dup')))).toBe(1);
    const race = await Promise.all(Array.from({ length: 6 }, () => call(midia.POST, 'POST', { body: { ...body, sha256: sha('dup-race') }, as: editor })));
    expect(race.map((r) => r.status).filter((s) => s === 201)).toHaveLength(1);
    expect(await app.db.$count(schema.media, eq(schema.media.sha256, sha('dup-race')))).toBe(1);
  });

  it('expiração: filtros vencendo/vencida; licença vencida não é publicável; renovar volta a ser; PATCH respeita a regra de evidência', async () => {
    const mk = async (n: string, expira: string | null) => {
      const r = await call(midia.POST, 'POST', { body: { tipo: 'imagem', direitos, sha256: sha(n), licencaEvidencia: evid, ...(expira ? { licencaExpiraEm: expira } : {}) }, as: editor });
      return r.body.data.id as string;
    };
    const breve = await mk('exp-breve', '2026-12-10');
    await mk('exp-longe', '2027-09-01');
    const vencidaId = await mk('exp-venc', '2026-12-01');
    await app.db.update(schema.media).set({ licencaExpiraEm: '2026-11-01' }).where(eq(schema.media.id, vencidaId)); // venceu depois de registrada
    const vencendo = await call(midia.GET, 'GET', { query: { vencendo: '30' }, as: editor });
    expect(vencendo.body.data.map((m: any) => m.id)).toContain(breve);
    expect(vencendo.body.data.every((m: any) => m.licencaStatus === 'vence_em_breve')).toBe(true);
    const vencida = await call(midia.GET, 'GET', { query: { vencida: 'true' }, as: editor });
    expect(vencida.body.data.map((m: any) => m.id)).toEqual([vencidaId]);
    expect(vencida.body.data[0]).toMatchObject({ licencaStatus: 'vencida', publicavel: false });
    const renovada = await call(midiaUma.PATCH, 'PATCH', { params: { id: vencidaId }, body: { licencaExpiraEm: '2027-12-31' }, as: editor });
    expect(renovada.body.data).toMatchObject({ licencaStatus: 'valida', publicavel: true });
    const semEvid = await call(midiaUma.PATCH, 'PATCH', { params: { id: vencidaId }, body: { licencaEvidencia: null }, as: editor });
    expect(semEvid.status).toBe(422);
    expect(semEvid.body.error.code).toBe('LICENSE_EVIDENCE_REQUIRED');
    expect((await call(midia.GET, 'GET', { query: { vencendo: '999' }, as: editor })).status).toBe(400);
    expect((await call(midiaUma.PATCH, 'PATCH', { params: { id: vencidaId }, body: {}, as: editor })).status).toBe(400);
    expect((await call(midiaUma.PATCH, 'PATCH', { params: { id: 'nao-existe' }, body: { licencaExpiraEm: null }, as: editor })).status).toBe(404);
  });

  it('filtros licencaStatus, publicavel e q usam a MESMA régua dos campos da resposta; total reflete o filtro; inválidos 400', async () => {
    const mk = async (n: string, over: Record<string, unknown>) => {
      const r = await call(midia.POST, 'POST', { body: { tipo: 'imagem', direitos, sha256: sha(n), licencaEvidencia: evid, ...over }, as: editor });
      expect(r.status).toBe(201);
      return r.body.data.id as string;
    };
    const pendente = await mk('flt-pend', { direitos: { ...direitos, baseDeDireito: 'pendente', credito: 'Fotógrafo 100%_raro' }, licencaEvidencia: undefined });
    const venc = await mk('flt-venc', { licencaExpiraEm: '2026-12-02', direitos: { ...direitos, textoAlternativo: 'Avião da companhia Zeta' } });
    await app.db.update(schema.media).set({ licencaExpiraEm: '2026-10-01' }).where(eq(schema.media.id, venc));
    const list = (query: Record<string, string>) => call(midia.GET, 'GET', { query: { limit: '100', ...query }, as: editor });
    // cada filtro de status devolve só itens com aquele status, e o total bate com os itens (todos cabem em 100)
    for (const st of ['sem_expiracao', 'valida', 'vence_em_breve', 'vencida']) {
      const r = await list({ licencaStatus: st });
      expect(r.status).toBe(200);
      expect(r.body.data.every((m: any) => m.licencaStatus === st)).toBe(true);
      expect(r.body.total).toBe(r.body.data.length);
    }
    expect((await list({ licencaStatus: 'vencida' })).body.data.map((m: any) => m.id)).toContain(venc);
    const naoPub = await list({ publicavel: 'false' });
    expect(naoPub.body.data.every((m: any) => m.publicavel === false)).toBe(true);
    expect(naoPub.body.data.map((m: any) => m.id)).toEqual(expect.arrayContaining([pendente, venc]));
    const pub = await list({ publicavel: 'true' });
    expect(pub.body.data.every((m: any) => m.publicavel === true)).toBe(true);
    const todos = await list({});
    expect(pub.body.total + naoPub.body.total).toBe(todos.body.total); // partição exata
    // q: crédito ou texto alternativo, sem diferenciar caixa; % e _ literais; espaços nas pontas ignorados
    expect((await list({ q: '  avião da companhia zeta ' })).body.data.map((m: any) => m.id)).toEqual([venc]);
    expect((await list({ q: '100%_raro' })).body.data.map((m: any) => m.id)).toEqual([pendente]);
    expect((await list({ q: '%' })).body.data.map((m: any) => m.id)).toEqual([pendente]); // só o crédito com % literal
    expect((await list({ q: 'nada-casa-isto' })).body).toMatchObject({ data: [], total: 0 });
    const invalidos: Record<string, string>[] = [{ licencaStatus: 'x' }, { publicavel: 'sim' }, { q: '   ' }, { q: 'x'.repeat(101) }];
    for (const bad of invalidos) expect((await list(bad)).status).toBe(400);
  });
});

describe('upload do arquivo', () => {
  it('RBAC: sem sessão 401, leitor 403, sem armazenamento configurado 503', async () => {
    resetBlob();
    expect((await send(upload.POST, png(), metaUpload(), null)).status).toBe(401);
    expect((await send(upload.POST, png(), metaUpload(), leitor)).status).toBe(403);
    app.deps.blob = null;
    const r = await send(upload.POST, png(), metaUpload(), editor);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('NOT_CONFIGURED');
    resetBlob();
  });

  it('envia PNG: sha256 e tipo vêm do CONTEÚDO, vai ao Blob por sha, registro aponta para /api/midia/{id}/arquivo; repetir deduplica', async () => {
    resetBlob();
    const bytes = png(1);
    const r = await send(upload.POST, bytes, metaUpload(), editor);
    expect(r.status).toBe(201);
    const expectedSha = createHash('sha256').update(bytes).digest('hex');
    expect(r.body.data).toMatchObject({ tipo: 'imagem', sha256: expectedSha, mime: 'image/png', bytes: bytes.length, temArquivo: true, publicavel: true });
    expect(r.body.data.direitos.url).toBe(`http://localhost:3000/api/midia/${r.body.data.id}/arquivo`);
    expect([...blob.objects.keys()]).toEqual([`midia/${expectedSha}`]);
    expect(blob.objects.get(`midia/${expectedSha}`)?.contentType).toBe('image/png');
    const again = await send(upload.POST, bytes, metaUpload(), chefe);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ deduplicada: true });
    expect(again.body.data.id).toBe(r.body.data.id);
    expect(blob.objects.size).toBe(1);
  });

  it('leitura do arquivo devolve os mesmos bytes com cabeçalhos defensivos; sem arquivo 404; exige sessão', async () => {
    resetBlob();
    const bytes = png(2);
    const up = await send(upload.POST, bytes, metaUpload(), editor);
    const id = up.body.data.id as string;
    const res = await arquivo.GET(new Request(`http://localhost:3000/api/midia/${id}/arquivo`, { headers: { cookie: leitor.cookie } }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...bytes]);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect((await call(arquivo.GET, 'GET', { params: { id } })).status).toBe(401);
    const meta = await call(midia.POST, 'POST', { body: { tipo: 'imagem', direitos: { ...direitos, baseDeDireito: 'propria', origem: 'propria' }, sha256: sha('so-meta') }, as: editor });
    expect((await call(arquivo.GET, 'GET', { params: { id: meta.body.data.id }, as: editor })).body.error.code).toBe('NO_FILE');
  });

  it('recusa SVG, HTML disfarçado de .png, arquivo vazio, acima de 5 MB; campos ausentes e metadados inválidos: 400/415/413', async () => {
    resetBlob();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    expect((await send(upload.POST, svg, metaUpload(), editor, 'x.svg')).status).toBe(415);
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    expect((await send(upload.POST, html, metaUpload(), editor, 'foto.png')).status).toBe(415); // extensão e content-type do cliente não valem
    expect((await send(upload.POST, new Uint8Array([]), metaUpload(), editor)).status).toBe(415);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect((await send(upload.POST, big, metaUpload(), editor)).status).toBe(413);
    expect((await send(upload.POST, null, metaUpload(), editor)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await send(upload.POST, png(3), '{não é json', editor ? editor : null)).body.error.code).toBe('INVALID_JSON');
    expect((await send(upload.POST, png(3), { direitos: { origem: 'propria' } }, editor)).status).toBe(400);
    expect((await send(upload.POST, png(3), metaUpload({ extra: 1 }), editor)).status).toBe(400);
    expect(blob.objects.size).toBe(0); // nada foi ao Blob nas recusas
    expect(await app.db.$count(schema.media, eq(schema.media.tipo, 'documento'))).toBe(0);
  });

  it('licença no upload: base licenciada exige evidência; com evidência e expiração futura registra; PDF vira documento', async () => {
    resetBlob();
    const lic = { direitos: { origem: 'licenciada', credito: 'Agência X', baseDeDireito: 'licenca', textoAlternativo: 'Foto licenciada' } };
    expect((await send(upload.POST, png(10), lic, editor)).body.error.code).toBe('LICENSE_EVIDENCE_REQUIRED');
    expect((await send(upload.POST, png(10), { ...lic, licencaEvidencia: evid, licencaExpiraEm: '2020-01-01' }, editor)).body.error.code).toBe('LICENSE_EXPIRED');
    const ok = await send(upload.POST, png(10), { ...lic, licencaEvidencia: evid, licencaExpiraEm: plus(90) }, editor);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ licencaStatus: 'valida', licencaEvidencia: evid });
    const pdf = await send(upload.POST, new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj'), metaUpload(), editor, 'contrato.pdf');
    expect(pdf.status).toBe(201);
    expect(pdf.body.data).toMatchObject({ tipo: 'documento', mime: 'application/pdf' });
  });

  it('registro só de metadados + upload do mesmo conteúdo: anexa o arquivo ao registro existente', async () => {
    resetBlob();
    const bytes = png(20);
    const s = createHash('sha256').update(bytes).digest('hex');
    const meta = await call(midia.POST, 'POST', { body: { tipo: 'imagem', direitos: { ...direitos, baseDeDireito: 'propria', origem: 'propria' }, sha256: s }, as: editor });
    const r = await send(upload.POST, bytes, metaUpload(), editor);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ deduplicada: true, arquivoAnexado: true });
    expect(r.body.data).toMatchObject({ id: meta.body.data.id, temArquivo: true, mime: 'image/png' });
    expect(blob.objects.size).toBe(1);
  });

  it('excluir remove o registro e o arquivo do Blob; só editor-chefe exclui', async () => {
    resetBlob();
    const up = await send(upload.POST, png(30), metaUpload(), editor);
    const id = up.body.data.id as string;
    expect((await call(midiaUma.DELETE, 'DELETE', { params: { id }, as: editor })).status).toBe(403);
    expect((await call(midiaUma.DELETE, 'DELETE', { params: { id }, as: chefe })).status).toBe(204);
    expect(blob.objects.size).toBe(0);
    expect((await call(midiaUma.GET, 'GET', { params: { id }, as: editor })).status).toBe(404);
  });
});
