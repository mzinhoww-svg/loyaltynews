import { test } from 'vitest';
import assert from 'node:assert/strict';
import { AD_FORMATS } from '@ln/contracts';
import { CATALOG } from './index';

// O catálogo do módulo precisa casar 1:1 com os 47 formatos de packages/contracts (ids, seção, nome, referência, escopo).
test('catálogo casa com AD_FORMATS de @ln/contracts', () => {
  assert.equal(CATALOG.length, AD_FORMATS.length);
  for (const c of AD_FORMATS) {
    const f = CATALOG.find((x) => x.id === c.id);
    assert.ok(f, `formato ausente no módulo: ${c.id}`);
    assert.equal(f.section, c.secao); assert.equal(f.name, c.nome);
    assert.equal(f.referenceText, c.referenciaBrl); assert.equal(f.scope, c.escopo);
  }
});
test('estados do módulo são subconjunto do enum Disponibilidade do contrato', async () => {
  const { Disponibilidade } = await import('@ln/contracts');
  for (const f of CATALOG) assert.ok(Disponibilidade.options.includes(f.status as never), f.status);
});
