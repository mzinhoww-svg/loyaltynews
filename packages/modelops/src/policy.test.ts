import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatePolicy, loadPolicyFile } from './policy';

const FIXTURE = fileURLToPath(new URL('../fixtures/model.policy.proposto-DP02-v4.json', import.meta.url));

// Os testes mutam campos aninhados de propósito (inclusive removendo chaves); por isso o tipo é solto só aqui.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fresh(): Record<string, any> {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

test('política v4 do fixture é válida', () => {
  const r = loadPolicyFile(FIXTURE);
  assert.equal(r.ok, true, r.errors.join(' | '));
  assert.ok(r.policy);
});

test('teto diferente de 50 é rejeitado', () => {
  const p = fresh();
  p.rules.hard_monthly_budget_usd = 60;
  const r = validatePolicy(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /teto deve ser 50/);
});

test('verbas que não fecham no teto são rejeitadas', () => {
  const p = fresh();
  p.rules.budget_allocation_usd.openai = 25;
  const r = validatePolicy(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /soma 55 difere do teto 50/);
});

// Chaves numéricas são reordenadas pelo próprio JavaScript; por isso o validador confere o conjunto de degraus.
test('degrau ausente ou sobrando é rejeitado', () => {
  const p = fresh();
  delete p.rules.budget_steps_usd['42'];
  const r = validatePolicy(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /chaves devem ser 35, 40, 42, 50/);

  const q = fresh();
  q.rules.budget_steps_usd['45'] = 'extra';
  assert.equal(validatePolicy(q).ok, false);
});

test('rota que aponta para modelo inexistente é rejeitada', () => {
  const p = fresh();
  p.routes.economy.push('modelo-fantasma');
  const r = validatePolicy(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /modelo desconhecido modelo-fantasma/);
});

test('bloqueio de custo desconhecido desligado é rejeitado', () => {
  const p = fresh();
  p.rules.block_unknown_cost = false;
  const r = validatePolicy(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /block_unknown_cost/);
});

test('OpenRouter aprovado para dado pessoal é rejeitado', () => {
  const p = fresh();
  p.data_classes.processors.openrouter.not_approved_for = ['internal', 'commercial_confidential', 'restricted', 'secret'];
  const r = validatePolicy(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /deve excluir a classe personal/);
});

test('rota de roteamento por tarefa inexistente é rejeitada', () => {
  const p = fresh();
  p.routing_by_task.daily = 'rota-inexistente; qualquer texto';
  const r = validatePolicy(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /rota desconhecida "rota-inexistente"/);
});

test('ausência de production_enabled é rejeitada', () => {
  const p = fresh();
  delete p.rules.production_enabled;
  const r = validatePolicy(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /production_enabled/);
});

test('arquivo inexistente vira falha, não exceção', () => {
  const r = loadPolicyFile(FIXTURE + '.nao-existe');
  assert.equal(r.ok, false);
  assert.match(r.errors[0] ?? '', /leitura/);
});
