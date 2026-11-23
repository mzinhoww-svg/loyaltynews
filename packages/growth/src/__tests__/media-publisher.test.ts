import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_FLAGS, type GrowthFlags } from '../flags';
import { LIVE_ACK, readOnlyTransport } from '../mlabs/live';
import { READ_ONLY_TOOLS, WRITE_TOOLS } from '../mlabs/port';
import { SimulatedMlabsTransport } from '../mlabs/transport.mock';
import { assertUploadUrl } from '../mlabs/media-port.internal';
import { MediaUploadError } from '../pipeline/raster-upload';
import { SimulatedRasterizer } from '../pipeline/raster-upload.mock';
import { createSocialPublisher, PUBLISHER_SOCIAL, PublishRefused, type LivePublisherConfig, type SocialPublisher } from '../publisher/publisher';
import type { CreativeAsset } from '../types';

// Transporte REAL de mídia (R5-02) DENTRO do publicador, contra o mLabs SIMULADO. Nenhuma chamada real: o PUT é um simulador injetado e o
// `fetch` global é substituído nos testes que passam pelo caminho padrão.
const NOW = new Date('2026-11-23T12:00:00.000Z');
const ON: GrowthFlags = { ...DEFAULT_FLAGS, growth_linkedin_live: true };
const asset = (over: Partial<CreativeAsset> = {}): CreativeAsset => ({
  format: 'linkedin_landscape', width: 1200, height: 627, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627"/>', html: '', contextKey: 'ctx', brandStatus: 'proposta', mock: false, ...over,
});
const REF = 'creative://art-1/abc';
const refusal = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof PublishRefused || e instanceof MediaUploadError ? e.reason : `outro:${String(e)}`));

let flags: GrowthFlags;
let transport: SimulatedMlabsTransport;
let rasterizer: SimulatedRasterizer;
let putCalls: number;
const mk = (over: Partial<LivePublisherConfig> = {}): SocialPublisher =>
  createSocialPublisher({
    mode: 'live', transport, liveAck: LIVE_ACK, actor: PUBLISHER_SOCIAL, flags: () => flags, now: () => NOW.toISOString(),
    media: { rasterizer, putBytes: async (...a) => { putCalls++; return transport.putBytes(...a); } },
    ...over,
  });
const tools = () => transport.calls.map((c) => c.tool);

beforeEach(() => {
  flags = { ...ON };
  transport = new SimulatedMlabsTransport(() => NOW);
  rasterizer = new SimulatedRasterizer();
  putCalls = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('upload de mídia pelo publicador: identidade, flag e capability', () => {
  test('caminho feliz: prepare_media_upload → PUT → get_media_upload até concluir; nenhum create_post; auditado sem a URL assinada', async () => {
    const pub = mk();
    const r = await pub.uploadMedia(PUBLISHER_SOCIAL, asset(), REF);
    assert.deepEqual(r, { imageIds: ['SIM-IMG-SIM-UP-0001'] });
    assert.deepEqual(tools(), ['prepare_media_upload', 'get_media_upload', 'get_media_upload']);
    assert.equal(transport.all.length, 0, 'nada de post: só mídia');
    const prep = transport.calls[0]!.args;
    assert.deepEqual(Object.keys(prep).sort(), ['channels', 'filename', 'mimeType', 'sha256', 'sizeBytes']);
    assert.deepEqual([prep.mimeType, prep.channels, putCalls], ['image/png', ['linkedin'], 1]);
    assert.match(String(prep.sha256), /^[0-9a-f]{64}$/);
    assert.deepEqual(pub.audit.map((a) => [a.action, a.outcome]), [['upload_media', 'accepted']]);
    assert.doesNotMatch(JSON.stringify(pub.audit), /sig=|upload\.simulado/);
  });

  test('flag desligada DEPOIS de criar o publicador: recusa antes de qualquer chamada (mLabs e PUT), com auditoria', async () => {
    const pub = mk();
    flags = { ...DEFAULT_FLAGS };
    assert.equal(await refusal(pub.uploadMedia(PUBLISHER_SOCIAL, asset(), REF)), 'publicacao_real_desligada');
    assert.deepEqual([transport.calls.length, putCalls, rasterizer.calls], [0, 0, 0]);
    assert.deepEqual(pub.audit.map((a) => [a.action, a.outcome, a.reason]), [['upload_media', 'refused', 'publicacao_real_desligada']]);
  });

  test('identidade que não é publisher_social é recusada; sem rasterizador configurado também', async () => {
    const pub = mk();
    assert.equal(await refusal(pub.uploadMedia({ id: 'x', role: 'growth_agent' }, asset(), REF)), 'identidade_nao_autorizada');
    assert.equal(await refusal(mk({ media: undefined }).uploadMedia(PUBLISHER_SOCIAL, asset(), REF)), 'rasterizador_ausente');
    assert.deepEqual([transport.calls.length, putCalls], [0, 0]);
  });

  test('flag desligada ENTRE o preparo e o PUT: o PUT não acontece e nada é registrado como enviado', async () => {
    const pub = mk();
    const prep = transport.call.bind(transport);
    transport.call = async (tool, args) => {
      const r = await prep(tool, args);
      if (tool === 'prepare_media_upload') flags = { ...DEFAULT_FLAGS };
      return r;
    };
    assert.equal(await refusal(pub.uploadMedia(PUBLISHER_SOCIAL, asset(), REF)), 'put_recusado');
    assert.equal(putCalls, 0);
    assert.equal(transport.media.puts, 0);
  });

  test('criativo mock nunca sobe no modo real, nem com allowMock; no simulado só com allowMock', async () => {
    const live = mk({ media: { rasterizer, allowMock: true } });
    assert.equal(await refusal(live.uploadMedia(PUBLISHER_SOCIAL, asset({ mock: true }), REF)), 'criativo_mock');
    assert.equal(transport.calls.length, 0);
    const sim = createSocialPublisher({ mode: 'simulated', flags: () => ON, media: { rasterizer } });
    assert.equal(await refusal(sim.uploadMedia(PUBLISHER_SOCIAL, asset({ mock: true }), REF)), 'criativo_mock');
    const sim2 = createSocialPublisher({ mode: 'simulated', flags: () => ON, media: { rasterizer, allowMock: true } });
    assert.deepEqual(await sim2.uploadMedia(PUBLISHER_SOCIAL, asset({ mock: true }), REF), { imageIds: ['SIM-IMG-SIM-UP-1'] });
  });

  test('o mesmo criativo não sobe duas vezes (registro pelo hash do SVG, dentro do publicador)', async () => {
    const pub = mk();
    const a = await pub.uploadMedia(PUBLISHER_SOCIAL, asset(), REF);
    const b = await pub.uploadMedia(PUBLISHER_SOCIAL, asset(), 'creative://outro');
    assert.deepEqual(a, b);
    assert.equal(transport.media.prepares, 1);
  });
});

describe('a resposta do mLabs não é confiada', () => {
  const withPrepare = (reply: unknown) => {
    const real = transport.call.bind(transport);
    transport.call = async (tool, args) => (tool === 'prepare_media_upload' ? reply : real(tool, args));
  };

  test('resposta sem uploadId/uploadUrl, URL insegura e método diferente de PUT: recusa, sem PUT', async () => {
    const base = { uploadId: 'u1', uploadUrl: 'https://upload.exemplo.example/u1?sig=x', method: 'PUT', headers: {} };
    for (const [reply, why] of [
      [{}, 'sem campos'],
      [{ ...base, uploadUrl: 'http://upload.exemplo.example/u1' }, 'http'],
      [{ ...base, uploadUrl: 'https://localhost/u1' }, 'localhost'],
      [{ ...base, uploadUrl: 'https://169.254.169.254/latest' }, 'ip'],
      [{ ...base, uploadUrl: 'https://[::1]/u1' }, 'ipv6'],
      [{ ...base, uploadUrl: 'https://user:pw@upload.exemplo.example/u1' }, 'credencial'],
      [{ ...base, uploadUrl: 'https://intranet/u1' }, 'sem ponto'],
      [{ ...base, method: 'POST' }, 'método'],
    ] as const) {
      transport = new SimulatedMlabsTransport(() => NOW);
      withPrepare(reply);
      const r = await refusal(mk().uploadMedia(PUBLISHER_SOCIAL, asset(), REF));
      assert.equal(r, 'preparo_falhou', why);
      assert.equal(putCalls, 0, why);
    }
  });

  test('assertUploadUrl: aceita HTTPS público, recusa o resto', () => {
    assertUploadUrl('https://storage.exemplo.example/a/b?X-Sig=1');
    for (const bad of ['', 'ftp://x.example/a', 'http://x.example/a', 'https://127.0.0.1/a', 'https://app.local/a', 'https://svc.internal/a', 'not a url']) {
      assert.throws(() => assertUploadUrl(bad), /url_recusada/, bad);
    }
  });

  test('processamento que falha ou nunca termina: recusa clara; falha de leitura isolada não derruba (conta como consulta)', async () => {
    transport.mediaFail = { processing: 'failed' };
    assert.equal(await refusal(mk().uploadMedia(PUBLISHER_SOCIAL, asset(), REF)), 'processamento_falhou');
    transport = new SimulatedMlabsTransport(() => NOW);
    let n = 0;
    const real = transport.call.bind(transport);
    transport.call = async (tool, args) => {
      if (tool === 'get_media_upload' && n++ === 0) throw new Error('rede');
      return real(tool, args);
    };
    assert.deepEqual(await mk().uploadMedia(PUBLISHER_SOCIAL, asset(), REF), { imageIds: ['SIM-IMG-SIM-UP-0001'] });
  });
});

describe('caminho padrão do PUT (fetch), com o fetch SUBSTITUÍDO: nada vai à rede', () => {
  test('flag desligada: o fetch nem é chamado; ligada: um PUT com os cabeçalhos devolvidos, sem seguir redirecionamento', async () => {
    const fetchSpy = vi.fn<(url: unknown, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const noPut = mk({ media: { rasterizer } });
    flags = { ...DEFAULT_FLAGS };
    assert.equal(await refusal(noPut.uploadMedia(PUBLISHER_SOCIAL, asset(), REF)), 'publicacao_real_desligada');
    assert.equal(fetchSpy.mock.calls.length, 0);

    flags = { ...ON };
    // o simulador de armazenamento precisa ver os bytes: ele só vale se o PUT padrão enviar tamanho e cabeçalhos corretos
    fetchSpy.mockImplementation(async (url, init) => {
      const body = init?.body as Blob;
      const bytes = new Uint8Array(await body.arrayBuffer());
      const status = await transport.putBytes(String(url), String(init?.method), init?.headers as Record<string, string>, bytes);
      return new Response(null, { status });
    });
    const r = await mk({ media: { rasterizer } }).uploadMedia(PUBLISHER_SOCIAL, asset(), REF);
    assert.deepEqual(r, { imageIds: ['SIM-IMG-SIM-UP-0001'] });
    assert.equal(fetchSpy.mock.calls.length, 1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    assert.match(url, /^https:\/\/upload\.simulado\.example\/SIM-UP-0001\?/);
    assert.deepEqual([init.method, init.redirect], ['PUT', 'error']);
    assert.deepEqual(init.headers, { 'content-type': 'image/png', 'if-none-match': '*' });
  });
});

describe('fronteira de escrita', () => {
  test('prepare_media_upload é ferramenta de ESCRITA: fora da lista de leitura, e o transporte somente-leitura a recusa; get_media_upload é leitura', async () => {
    assert.ok((WRITE_TOOLS as readonly string[]).includes('prepare_media_upload'));
    assert.ok(!(READ_ONLY_TOOLS as readonly string[]).includes('prepare_media_upload'));
    assert.ok((READ_ONLY_TOOLS as readonly string[]).includes('get_media_upload'));
    await assert.rejects(() => readOnlyTransport(transport).call('prepare_media_upload', {}), /fora da lista de leitura/);
    assert.equal(transport.calls.length, 0);
  });
});
