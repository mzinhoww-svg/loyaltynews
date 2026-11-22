import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { ACTIONS, RESOURCES, ROLES, can, isRole, matrix } from './rbac';

test('papel desconhecido, vazio ou nulo é negado em tudo', () => {
  for (const role of [undefined, null, '', 'root', 'ADMIN']) {
    for (const r of RESOURCES) for (const a of ACTIONS) assert.equal(can(role, r, a), false);
  }
});

test('admin tem todas as ações em todos os recursos', () => {
  for (const r of RESOURCES) for (const a of ACTIONS) assert.equal(can('admin', r, a), true);
});

test('só admin gerencia usuários; só admin e editor_chefe leem auditoria', () => {
  for (const role of ROLES) {
    assert.equal(can(role, 'usuarios', 'read'), role === 'admin', `usuarios/read ${role}`);
    assert.equal(can(role, 'auditoria', 'read'), role === 'admin' || role === 'editor_chefe', `auditoria/read ${role}`);
  }
});

test('publicar matéria só admin e editor_chefe (publicação ainda exige recibo na rota)', () => {
  for (const role of ROLES) assert.equal(can(role, 'materias', 'publish'), role === 'admin' || role === 'editor_chefe');
});

test('leitor e revisor nunca criam nem apagam', () => {
  for (const role of ['leitor', 'revisor'] as const)
    for (const r of RESOURCES) for (const a of ['create', 'delete', 'publish'] as const) assert.equal(can(role, r, a), false);
});

test('comercial não toca matérias', () => {
  for (const a of ACTIONS) assert.equal(can('comercial', 'materias', a), false);
});

test('toda concessão usa recursos e ações conhecidos; isRole', () => {
  for (const role of ROLES)
    for (const [res, acts] of Object.entries(matrix()[role])) {
      assert.ok((RESOURCES as readonly string[]).includes(res));
      for (const a of acts ?? []) assert.ok((ACTIONS as readonly string[]).includes(a));
    }
  assert.equal(isRole('editor'), true);
  assert.equal(isRole('x'), false);
});
