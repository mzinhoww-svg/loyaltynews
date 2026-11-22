import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usdToMicro, priceToMicroPerMtok, tokensToMicro } from '../src/money.ts';
import { monthKey } from '../src/month.ts';

test('conversão USD para micro é exata nos valores de tabela', () => {
  assert.equal(usdToMicro(50), 50_000_000);
  assert.equal(usdToMicro(0.1), 100_000);
  assert.equal(priceToMicroPerMtok(1.32), 1_320_000);
});

test('custo de tokens arredonda para cima (reserva nunca subestima)', () => {
  // 1.000 tokens a US$ 0,125 por milhão = US$ 0,000125 = 125 micro
  assert.equal(tokensToMicro(1000, priceToMicroPerMtok(0.125)), 125);
  // 1 token a US$ 1,32 por milhão = 1,32 micro, arredonda para 2
  assert.equal(tokensToMicro(1, priceToMicroPerMtok(1.32)), 2);
});

test('mês muda à meia-noite de America/Sao_Paulo, não em UTC', () => {
  // 2026-11-30 23:59:59 em Brasília = 2026-12-01 02:59:59 UTC: ainda é novembro
  assert.equal(monthKey(new Date('2026-12-01T02:59:59Z')), '2026-11');
  // 2026-12-01 00:00:00 em Brasília = 2026-12-01 03:00:00 UTC: já é dezembro
  assert.equal(monthKey(new Date('2026-12-01T03:00:00Z')), '2026-12');
});
