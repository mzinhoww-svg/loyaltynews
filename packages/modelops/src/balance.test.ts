import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BalanceGuard } from './balance';

test('lê o saldo na primeira retenção e recusa o que não cabe', async () => {
  let reads = 0;
  const guard = new BalanceGuard(async () => {
    reads += 1;
    return 1;
  }, 10);
  assert.equal((await guard.hold(0.6)).ok, true);
  const refused = await guard.hold(0.6);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.reason, 'insufficient_balance');
  assert.equal(reads, 1, 'uma leitura cobre as duas retenções');
});

test('relê o saldo a cada N retenções', async () => {
  let reads = 0;
  const guard = new BalanceGuard(async () => {
    reads += 1;
    return 100;
  }, 3);
  for (let i = 0; i < 7; i++) await guard.hold(0.01);
  // leituras em: 1ª, após 3 retenções, após mais 3
  assert.equal(reads, 3);
});

test('falha de leitura fecha o portão: nenhuma retenção sem saldo lido', async () => {
  const guard = new BalanceGuard(async () => {
    throw new Error('rede');
  });
  const r = await guard.hold(0.01);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'balance_unknown');
});

test('liquidar com custo real desconta o saldo; liberar devolve; pendente segue retido', async () => {
  const guard = new BalanceGuard(async () => 5, 10);
  await guard.hold(1);
  await guard.settle(1, 0.4);
  assert.equal(guard.estimate(), 4.6, 'custo real de 0,40 descontado; retenção de 1 saiu da pendência');

  await guard.hold(2);
  assert.equal(guard.estimate(), 2.6, 'retenção ainda pendente reduz o saldo estimado');
  await guard.settle(2, 0);
  assert.equal(guard.estimate(), 4.6, 'liberação devolve a retenção');
});

test('retenção acima do saldo estimado é recusada mesmo depois de liquidações', async () => {
  const guard = new BalanceGuard(async () => 1, 10);
  await guard.hold(0.5);
  await guard.settle(0.5, 0.5);
  const r = await guard.hold(0.6);
  assert.equal(r.ok, false, 'saldo restante 0,5 não cobre 0,6');
});
