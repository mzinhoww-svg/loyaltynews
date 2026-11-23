import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { MediaUploadError, MlabsRasterUploader, pngSize, type MlabsRasterUploaderOptions } from '../pipeline/raster-upload';
import { SimulatedMediaUploadPort, SimulatedRasterizer, solidPng } from '../pipeline/raster-upload.mock';
import type { CreativeAsset } from '../types';

const T0 = new Date('2026-11-23T12:00:00.000Z');
const clock = { t: T0 };
const asset = (over: Partial<CreativeAsset> = {}): CreativeAsset => ({
  format: 'linkedin_landscape', width: 1200, height: 627, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627"/>', html: '', contextKey: 'ctx', brandStatus: 'proposta', mock: false, ...over,
});
let rast: SimulatedRasterizer;
let port: SimulatedMediaUploadPort;
const mk = (o: Partial<MlabsRasterUploaderOptions> = {}) => new MlabsRasterUploader({ rasterizer: rast, port, now: () => clock.t, sleep: async () => { clock.t = new Date(clock.t.getTime() + 1000); }, ...o });
const reason = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof MediaUploadError ? e.reason : `outro:${String(e)}`));

beforeEach(() => {
  clock.t = T0;
  rast = new SimulatedRasterizer();
  port = new SimulatedMediaUploadPort({ now: () => clock.t });
});

describe('PNG de teste e leitura do cabeçalho', () => {
  test('solidPng gera um PNG que pngSize lê; lixo não é PNG', () => {
    assert.deepEqual(pngSize(solidPng(1200, 627)), { width: 1200, height: 627 });
    assert.deepEqual(pngSize(solidPng(1080, 1080)), { width: 1080, height: 1080 });
    assert.equal(pngSize(new Uint8Array(100)), null);
  });
});

describe('MlabsRasterUploader (portas simuladas; nada vai ao mLabs)', () => {
  test('caminho feliz: rasteriza, prepara com tamanho EXATO e sha256, faz o PUT com os cabeçalhos devolvidos, consulta até concluir e devolve o imageId', async () => {
    const r = await mk().upload(asset(), 'img/ref-1');
    assert.deepEqual(r, { imageIds: ['SIM-IMG-sim-up-1'] });
    const p = port.prepares[0]!;
    assert.deepEqual([p.channels, /^ln-linkedin-landscape-[0-9a-f]{12}\.png$/.test(p.filename)], [['linkedin'], true]);
    assert.equal(p.sizeBytes, (await rast.rasterize(asset())).sizeBytes);
    assert.deepEqual([port.puts, port.polls], [1, 2]);
  });

  test('idempotência pelo SVG: o mesmo criativo não é preparado nem enviado duas vezes; SVG diferente sobe de novo', async () => {
    const u = mk();
    const a = await u.upload(asset(), 'r1');
    const b = await u.upload(asset(), 'r2');
    assert.deepEqual(a, b);
    assert.deepEqual([port.prepares.length, port.puts], [1, 1]);
    await u.upload(asset({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627"><rect/></svg>' }), 'r3');
    assert.equal(port.prepares.length, 2);
  });

  test('criativo MOCK nunca sobe (nem é rasterizado), salvo allowMock explícito', async () => {
    assert.equal(await reason(mk().upload(asset({ mock: true }), 'r')), 'criativo_mock');
    assert.deepEqual([rast.calls, port.prepares.length], [0, 0]);
    assert.equal(await reason(mk({ allowMock: true }).upload(asset({ mock: true }), 'r')), 'ok');
  });

  test('não confia no rasterizador: recalcula tamanho, formato, dimensões, hash dos bytes e hash do SVG de origem', async () => {
    const png = solidPng(1200, 627);
    for (const [tamper, why] of [
      [{ sizeBytes: 5 }, 'raster_invalido'],
      [{ mimeType: 'image/jpeg' as never }, 'raster_invalido'],
      [{ filename: 'Nome Com Espaço.png' }, 'raster_invalido'],
      [{ filename: 'x.png/../../y' }, 'raster_invalido'],
      [{ png: new Uint8Array(png.length), sha256: 'x' }, 'raster_invalido'],
      [{ width: 1080 }, 'raster_invalido'],
      [{ sha256: '0'.repeat(64) }, 'raster_invalido'],
      [{ svgSha256: '0'.repeat(64) }, 'raster_invalido'],
      [{ altText: '  ' }, 'raster_invalido'],
      [{ mock: true }, 'criativo_mock'],
    ] as const) {
      rast.tamper = tamper as never;
      assert.equal(await reason(mk().upload(asset(), 'r')), why, JSON.stringify(Object.keys(tamper)));
    }
    assert.equal(port.prepares.length, 0, 'nada foi preparado com raster inválido');
  });

  test('PNG acima do limite de bytes não sobe', async () => {
    assert.equal(await reason(mk({ maxBytes: 100 }).upload(asset(), 'r')), 'tamanho_acima_do_limite');
    assert.equal(port.prepares.length, 0);
  });

  test('falhas: preparo, PUT recusado, processamento falho, sem imageId, timeout; nada fica no ledger e a nova tentativa funciona', async () => {
    port.failPrepare = true;
    assert.equal(await reason(mk().upload(asset(), 'r')), 'preparo_falhou');
    port.failPrepare = false;
    port.putStatus = 403;
    assert.equal(await reason(mk().upload(asset(), 'r')), 'put_recusado');
    port.putStatus = null;
    port.processing = 'failed';
    assert.equal(await reason(mk().upload(asset(), 'r')), 'processamento_falhou');
    port.processing = 'no_image_id';
    assert.equal(await reason(mk().upload(asset(), 'r')), 'resposta_sem_imageid');
    port.processing = 'never';
    assert.equal(await reason(mk({ maxPolls: 3 }).upload(asset(), 'r')), 'timeout');
    port.processing = 'ok';
    const u = mk();
    assert.deepEqual(await u.upload(asset(), 'r'), { imageIds: ['SIM-IMG-sim-up-5'] });
  });

  test('autorização de 10 min: PUT depois do prazo é recusado antes de qualquer consulta', async () => {
    const slow = new SimulatedMediaUploadPort({ now: () => clock.t });
    const real = slow.put.bind(slow);
    slow.put = async (p, b) => {
      clock.t = new Date(clock.t.getTime() + 9.5 * 60_000);
      return real(p, b);
    };
    assert.equal(await reason(mk({ port: slow }).upload(asset(), 'r')), 'autorizacao_expirada');
    assert.equal(slow.polls, 0);
  });

  test('o erro nunca carrega a URL assinada, cabeçalhos nem o texto do erro do transporte', async () => {
    port.failPrepare = true;
    const e = await mk().upload(asset(), 'r').catch((x: Error) => x);
    assert.ok(e instanceof MediaUploadError);
    assert.doesNotMatch(`${e.message} ${JSON.stringify(e)}`, /segredo|exemplo\.invalid|sig=/);
    port.failPrepare = false;
    port.putStatus = 500;
    const e2 = await mk().upload(asset(), 'r').catch((x: Error) => x);
    assert.doesNotMatch(`${(e2 as Error).message}`, /simulado\.invalid|sig=|if-none-match/);
  });
});
