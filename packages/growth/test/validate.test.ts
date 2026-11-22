import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeOf, validateMlabsReadOnly, VALIDATION_PLAN } from '../src/mlabs/validate.ts';
import { READ_ONLY_TOOLS } from '../src/mlabs/port.ts';

test('plano de validação usa somente ferramentas de leitura', () => {
  for (const s of VALIDATION_PLAN) assert.ok((READ_ONLY_TOOLS as readonly string[]).includes(s.tool), s.tool);
});

test('validação registra só a forma da resposta, nunca valores', async () => {
  const calls: string[] = [];
  const secret = 'SEGREDO-NAO-PODE-APARECER';
  const r = await validateMlabsReadOnly({
    call: async (tool) => {
      calls.push(tool);
      if (tool === 'list_templates') throw new Error('falha simulada');
      return tool === 'list_channels' ? [{ id: secret, network: 'linkedin' }] : { token: secret, limits: {} };
    },
  }, () => '2026-11-22T12:00:00Z');
  assert.deepEqual(calls, VALIDATION_PLAN.map((s) => s.tool));
  assert.equal(r.mode, 'read_only');
  assert.equal(JSON.stringify(r).includes(secret), false);
  assert.deepEqual(r.results[0]?.shape, { type: 'array', length: 1, keys: ['id', 'network'] });
  assert.equal(r.results.find((x) => x.tool === 'list_templates')?.ok, false);
  assert.ok(r.notProvableByReads.some((x) => x.includes('menção')));
});

test('shapeOf', () => {
  assert.deepEqual(shapeOf(null), { type: 'null' });
  assert.deepEqual(shapeOf('x'), { type: 'string' });
  assert.deepEqual(shapeOf([]), { type: 'array', length: 0, keys: undefined });
});
