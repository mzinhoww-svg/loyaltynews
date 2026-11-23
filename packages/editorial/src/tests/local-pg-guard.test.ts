import { test } from 'vitest';
import assert from 'node:assert/strict';
import { assertLocalDisposablePg } from '../../fixtures/local-pg-guard.mock';

test('banco local e descartável é aceito', () => {
  for (const u of [
    'postgres://postgres@127.0.0.1:55433/ln_editorial_local',
    'postgresql:' + '//postgres:x@localhost:5432/test_rodada',
    'postgres://postgres@[::1]:55433/ln_test_a1',
  ]) assert.doesNotThrow(() => assertLocalDisposablePg(u), u);
  const t = assertLocalDisposablePg('postgres://postgres@127.0.0.1:55433/ln_editorial_local');
  assert.deepEqual([t.host, t.port, t.dbName], ['127.0.0.1', '55433', 'ln_editorial_local']);
});

test('recusa qualquer destino que não seja local e descartável (a suíte faz DROP DATABASE)', () => {
  const bad: Array<[string | undefined, RegExp]> = [
    [undefined, /ausente/],
    ['', /ausente/],
    ['isto nao e url', /inválida/],
    ['mysql://root@127.0.0.1/test_x', /protocolo/],
    ['postgres://postgres@db.prod.example.com:5432/test_x', /host recusado/],
    ['postgres://postgres@10.0.0.5:5432/test_x', /host recusado/],
    ['postgres://postgres@127.0.0.1.evil.example/test_x', /host recusado/],
    ['postgres://postgres@localhost:5432/loyaltynews', /prefixo|começar/],
    ['postgres://postgres@localhost:5432/postgres', /começar/],
    ['postgres://postgres@localhost:5432/template1', /começar/],
    ['postgres://postgres@localhost:5432/', /nome de banco/],
    ['postgres://postgres@localhost:5432/test_x?host=db.prod.example.com', /parâmetros/],
    ['postgres://postgres@localhost:5432/test_x; drop database loyaltynews', /nome de banco|inválida/],
    ['postgres://postgres@localhost:5432/TEST_X', /nome de banco/],
    ['postgres://postgres@localhost:5432/x_test_', /começar/],
  ];
  for (const [u, re] of bad) assert.throws(() => assertLocalDisposablePg(u), re, String(u));
});
