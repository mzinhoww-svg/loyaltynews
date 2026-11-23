import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DECISION_ID, FLAG_DEFAULTS, FLAG_RELEASES, flagEnvFrom, resolveFlags } from './flags';

describe('ADR-022 resolveFlags', () => {
  it('sem nada configurado: tudo desligado', () => {
    const r = resolveFlags({});
    expect(r.state).toEqual(FLAG_DEFAULTS);
    expect(r.on).toEqual([]);
    expect(Object.values(FLAG_DEFAULTS).every((v) => v === false)).toBe(true);
  });

  it('staging liga intelligencePessoas com DP-38 e loga a decisão', () => {
    const r = resolveFlags({ APP_ENV: ' Staging ', LN_FLAGS_ON: ' intelligencePessoas , ,' });
    expect(r.ambiente).toBe('staging');
    expect(r.state.intelligencePessoas).toBe(true);
    expect(r.on).toEqual(['intelligencePessoas']);
    expect(r.logLine).toBe('flags ligadas: intelligencePessoas (DP-38, staging)');
    expect(Object.entries(r.state).filter(([, v]) => v).length).toBe(1);
  });

  it('produção (production e producao) recusa flag sem decisão de produção, mensagem exata', () => {
    for (const APP_ENV of ['production', 'PRODUCAO', ' producao ']) {
      expect(() => resolveFlags({ APP_ENV, LN_FLAGS_ON: 'intelligencePessoas' })).toThrow(
        new Error('Subida recusada: flag intelligencePessoas sem decisão para production (ADR-022)'),
      );
    }
  });

  it('flag conhecida sem entrada no registro: recusada', () => {
    expect(() => resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'openbotDispatch' })).toThrow(
      'Subida recusada: flag openbotDispatch sem decisão para staging (ADR-022)',
    );
  });

  it('nome desconhecido: recusado em staging e produção, mensagem exata', () => {
    for (const APP_ENV of ['staging', 'production']) {
      expect(() => resolveFlags({ APP_ENV, LN_FLAGS_ON: 'flagInexistente' })).toThrow(
        new Error('Subida recusada: flag desconhecida flagInexistente em LN_FLAGS_ON (ADR-022)'),
      );
    }
  });

  it('diferencia maiúsculas', () => {
    expect(() => resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'IntelligencePessoas' })).toThrow(/flag desconhecida IntelligencePessoas/);
  });

  it('nunca ecoa o valor bruto: nome fora do formato vira "nome inválido"', () => {
    const segredo = 'sk-abc123/<script>';
    let msg = '';
    try {
      resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: `intelligencePessoas,${segredo}` });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe('Subida recusada: flag desconhecida nome inválido em LN_FLAGS_ON (ADR-022)');
    expect(msg).not.toContain('sk-');
  });

  it('entrada acima de 512 caracteres: recusada sem ecoar', () => {
    const big = 'intelligencePessoas,'.repeat(30);
    expect(() => resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: big })).toThrow(/acima de 512 caracteres/);
  });

  it('ambiente desconhecido não liga nada e avisa se LN_FLAGS_ON vier preenchida', () => {
    for (const APP_ENV of [undefined, 'development', 'ci', 'homologacao', 'local']) {
      const r = resolveFlags({ APP_ENV, LN_FLAGS_ON: 'intelligencePessoas' });
      expect(r.on).toEqual([]);
      expect(r.state.intelligencePessoas).toBe(false);
      expect(r.warnings.length).toBe(1);
    }
    expect(resolveFlags({ APP_ENV: 'ci' }).warnings).toEqual([]);
  });

  it('flagEnvFrom normaliza como o indexing', () => {
    expect(flagEnvFrom(' STAGING')).toBe('staging');
    expect(flagEnvFrom('production')).toBe('production');
    expect(flagEnvFrom('producao')).toBe('production');
    expect(flagEnvFrom('prod')).toBeNull();
  });

  it('N7: staging recusa PORTAL_INDEXAVEL definida', () => {
    expect(() => resolveFlags({ APP_ENV: 'staging', PORTAL_INDEXAVEL: '' })).toThrow(/PORTAL_INDEXAVEL/);
    expect(() => resolveFlags({ APP_ENV: 'production', PORTAL_INDEXAVEL: '1' })).not.toThrow();
  });

  it('N5: todo id do registro é DP-NN(N) ou null', () => {
    for (const [, rel] of Object.entries(FLAG_RELEASES)) {
      for (const id of [rel.staging, rel.production]) if (id !== null) expect(id).toMatch(DECISION_ID);
    }
    expect(DECISION_ID.test('DP-?? (piloto)')).toBe(false);
    expect(DECISION_ID.test('DP-38')).toBe(true);
    expect(FLAG_RELEASES.intelligencePessoas).toEqual({ staging: 'DP-38', production: null });
  });

  it('N6: todo id de produção existe em governance/decisions.yaml', () => {
    const yaml = readFileSync(new URL('../../../governance/decisions.yaml', import.meta.url), 'utf8');
    for (const [, rel] of Object.entries(FLAG_RELEASES)) {
      const id = rel.production as string | null;
      if (id !== null) expect(yaml).toContain(`"id": "${id}"`);
    }
  });
});
