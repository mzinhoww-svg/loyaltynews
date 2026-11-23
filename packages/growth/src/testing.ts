import assert from 'node:assert/strict';
import type { UploadLedger } from './pipeline/raster-upload';

// Entrada `@ln/growth/testing`: SÓ a suíte de CONFORMIDADE do registro de envios de mídia (UploadLedger). Não exporta adaptador,
// capability, transporte nem publicador (o teste public-surface.test.ts varre esta entrada como as outras). Só para testes; não
// importar em produção. A implementação PostgreSQL (dono: Backend) tem de passar estes casos inteiros, como a fila do OpenBot
// passa `@ln/openbot/testing`.

export interface LedgerConformanceCase {
  name: string;
  run: () => Promise<void>;
}

const T = '2026-11-23T12:00:00.000Z';
const KEY = (n: string) => `svg:${n.padEnd(64, '0')}:linkedin`;

export function uploadLedgerConformanceCases(make: () => Promise<UploadLedger> | UploadLedger): LedgerConformanceCase[] {
  return [
    {
      name: 'chave inexistente devolve null',
      run: async () => {
        const l = await make();
        assert.equal(await l.get(KEY('a')), null);
      },
    },
    {
      name: 'putIfAbsent grava e devolve a entrada; get devolve a mesma (imageId e instante iguais, sem arredondar)',
      run: async () => {
        const l = await make();
        const e = { imageId: 'img-1', at: '2026-11-23T12:00:00.123Z' };
        assert.deepEqual(await l.putIfAbsent(KEY('a'), e), e);
        assert.deepEqual(await l.get(KEY('a')), e);
      },
    },
    {
      name: 'a primeira gravação vence: putIfAbsent com outro valor devolve o PRIMEIRO e não altera',
      run: async () => {
        const l = await make();
        await l.putIfAbsent(KEY('a'), { imageId: 'primeiro', at: T });
        const kept = await l.putIfAbsent(KEY('a'), { imageId: 'segundo', at: '2026-11-24T00:00:00.000Z' });
        assert.deepEqual(kept, { imageId: 'primeiro', at: T });
        assert.deepEqual(await l.get(KEY('a')), { imageId: 'primeiro', at: T });
      },
    },
    {
      name: 'gravações paralelas da mesma chave convergem no mesmo imageId (uma só linha)',
      run: async () => {
        const l = await make();
        const got = await Promise.all(Array.from({ length: 8 }, (_, i) => l.putIfAbsent(KEY('p'), { imageId: `img-${i}`, at: T })));
        assert.equal(new Set(got.map((g) => g.imageId)).size, 1);
        assert.deepEqual(await l.get(KEY('p')), got[0]);
      },
    },
    {
      name: 'delete remove; regravar depois funciona; remover o que não existe não é erro; chaves são independentes',
      run: async () => {
        const l = await make();
        await l.putIfAbsent(KEY('a'), { imageId: 'a1', at: T });
        await l.putIfAbsent(KEY('b'), { imageId: 'b1', at: T });
        await l.delete(KEY('a'));
        assert.equal(await l.get(KEY('a')), null);
        assert.equal((await l.get(KEY('b')))?.imageId, 'b1');
        await l.delete(KEY('nunca-existiu'));
        assert.equal((await l.putIfAbsent(KEY('a'), { imageId: 'a2', at: T })).imageId, 'a2');
      },
    },
    {
      name: 'entradas inválidas são recusadas (chave fora do formato, imageId vazio ou longo, instante inválido) e nada é gravado',
      run: async () => {
        const l = await make();
        for (const key of ['', 'com espaço', 'x'.repeat(201), "svg:'; drop table x;--"]) {
          await assert.rejects(() => l.putIfAbsent(key, { imageId: 'i', at: T }), RangeError, `chave ${JSON.stringify(key).slice(0, 30)}`);
          await assert.rejects(() => l.get(key), RangeError);
        }
        await assert.rejects(() => l.putIfAbsent(KEY('a'), { imageId: '', at: T }), RangeError);
        await assert.rejects(() => l.putIfAbsent(KEY('a'), { imageId: 'x'.repeat(201), at: T }), RangeError);
        await assert.rejects(() => l.putIfAbsent(KEY('a'), { imageId: 'i', at: 'ontem' }), RangeError);
        assert.equal(await l.get(KEY('a')), null);
      },
    },
    {
      name: 'chave no tamanho máximo (200) e com os separadores do formato é aceita',
      run: async () => {
        const l = await make();
        const k = `svg:${'f'.repeat(64)}:linkedin,linkedin_personal`;
        assert.ok(k.length <= 200);
        assert.deepEqual(await l.putIfAbsent(k, { imageId: 'ok', at: T }), { imageId: 'ok', at: T });
        const long = 'k'.repeat(200);
        assert.equal((await l.putIfAbsent(long, { imageId: 'ok', at: T })).imageId, 'ok');
      },
    },
  ];
}
