import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  canUse, CONSENT_REQUIRED, DEFAULT_THIRD_PARTY_FLAGS, optedOutBySignal, PURPOSES, thirdPartyMeasurementAllowed, type ConsentRecord,
} from '../consent';

const policy = { currentVersion: 'v2' };
const consent = (over: Partial<ConsentRecord> = {}): ConsentRecord => ({ policyVersion: 'v2', grantedAt: '2026-11-23T12:00:00Z', purposes: { medicao_terceiros: true }, ...over });

describe('consentimento por finalidade (J-15)', () => {
  test('finalidades e as que exigem opt-in explícito', () => {
    assert.deepEqual([...PURPOSES], ['medicao_agregada', 'medicao_terceiros', 'publicidade']);
    assert.deepEqual([...CONSENT_REQUIRED], ['medicao_terceiros', 'publicidade']);
  });

  test('medição agregada própria não exige consentimento, mas exige política publicada', () => {
    assert.equal(canUse('medicao_agregada', { policy }), true);
    assert.equal(canUse('medicao_agregada', { policy: { currentVersion: null } }), false);
  });

  test('terceiros e publicidade: negados por padrão (sem registro) e nunca pré-habilitados', () => {
    for (const p of CONSENT_REQUIRED) {
      assert.equal(canUse(p, { policy }), false, p);
      assert.equal(canUse(p, { policy, consent: null }), false, p);
      assert.equal(canUse(p, { policy, consent: consent({ purposes: {} }) }), false, p);
      assert.equal(canUse(p, { policy, consent: consent({ purposes: { [p]: false } }) }), false, p);
    }
  });

  test('consentimento vale só para a finalidade escolhida e só na versão vigente da política', () => {
    assert.equal(canUse('medicao_terceiros', { policy, consent: consent() }), true);
    assert.equal(canUse('publicidade', { policy, consent: consent() }), false, 'consentir em uma não consente em outra');
    assert.equal(canUse('medicao_terceiros', { policy, consent: consent({ policyVersion: 'v1' }) }), false, 'política mudou: consentir de novo');
    assert.equal(canUse('medicao_terceiros', { policy: { currentVersion: null }, consent: consent() }), false);
  });

  test('GPC e DNT vencem qualquer consentimento e a medição agregada', () => {
    for (const signals of [{ gpc: true }, { dnt: true }]) {
      assert.equal(optedOutBySignal(signals), true);
      assert.equal(canUse('medicao_agregada', { policy, signals }), false);
      assert.equal(canUse('medicao_terceiros', { policy, consent: consent(), signals }), false);
    }
    assert.equal(optedOutBySignal(undefined), false);
    assert.equal(optedOutBySignal({ gpc: false, dnt: false }), false);
  });

  test('finalidade desconhecida é sempre negada', () => {
    for (const p of ['', 'marketing', 'MEDICAO_AGREGADA', 'medicao_terceiros ', '__proto__', 'constructor']) {
      assert.equal(canUse(p, { policy, consent: consent({ purposes: { [p]: true } as never }) }), false, p);
    }
  });
});

describe('porta única de medição de terceiros (ex.: GA4)', () => {
  test('flag desligada por padrão: nunca permite, mesmo com consentimento válido', () => {
    assert.equal(DEFAULT_THIRD_PARTY_FLAGS.analyticsThirdParty, false);
    assert.equal(thirdPartyMeasurementAllowed({ flags: DEFAULT_THIRD_PARTY_FLAGS, consent: consent(), policy }), false);
  });

  test('com a flag ligada ainda exige consentimento válido, política vigente e ausência de GPC/DNT', () => {
    const on = { analyticsThirdParty: true };
    assert.equal(thirdPartyMeasurementAllowed({ flags: on, policy }), false);
    assert.equal(thirdPartyMeasurementAllowed({ flags: on, consent: consent({ policyVersion: 'v1' }), policy }), false);
    assert.equal(thirdPartyMeasurementAllowed({ flags: on, consent: consent(), policy, signals: { gpc: true } }), false);
    assert.equal(thirdPartyMeasurementAllowed({ flags: on, consent: consent(), policy }), true);
  });
});
