import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DECISION_ID, FLAG_DEFAULTS, FLAG_RELEASES, PRODUCTION_FLAGS_ON, PRODUCTION_HOSTS, flagEnvFrom, productionFlagsByCommit, resolveFlags } from './flags';

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
    expect(() => resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'planosPagos' })).toThrow(
      'Subida recusada: flag planosPagos sem decisão para staging (ADR-022)',
    );
  });

  it('adendo 2: leitorViaProvedor nasce desligada, liga só no staging (DP-32) e produção não sobe', () => {
    expect(FLAG_DEFAULTS.leitorViaProvedor).toBe(false);
    expect(resolveFlags({}).state.leitorViaProvedor).toBe(false);
    expect(resolveFlags({ APP_ENV: 'staging' }).state.leitorViaProvedor).toBe(false);
    const r = resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'leitorViaProvedor' });
    expect(r.state.leitorViaProvedor).toBe(true);
    expect(r.logLine).toBe('flags ligadas: leitorViaProvedor (DP-32, staging)');
    expect(() => resolveFlags({ APP_ENV: 'production', LN_FLAGS_ON: 'leitorViaProvedor' })).toThrow(
      new Error('Subida recusada: flag leitorViaProvedor sem decisão para production (ADR-022)'),
    );
  });

  it('DP-41: openbotDispatch liga só no staging', () => {
    const r = resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas,openbotDispatch' });
    expect(r.on).toEqual(['intelligencePessoas', 'openbotDispatch']);
    expect(r.logLine).toBe('flags ligadas: intelligencePessoas (DP-38, staging), openbotDispatch (DP-41, staging)');
    expect(() => resolveFlags({ APP_ENV: 'production', LN_FLAGS_ON: 'openbotDispatch' })).toThrow(
      'Subida recusada: flag openbotDispatch sem decisão para production (ADR-022)',
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
    expect(FLAG_RELEASES.openbotDispatch).toEqual({ staging: 'DP-41', production: null });
    expect(FLAG_RELEASES.leitorViaProvedor).toEqual({ staging: 'DP-32', production: null });
    expect(FLAG_RELEASES.adServerVendas).toEqual({ staging: 'DP-43', production: null });
  });

  it('DP-43: adServerVendas liga só no staging; produção, local e sem APP_ENV nunca ligam por variável', () => {
    const on = resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'adServerVendas' });
    expect(on.state.adServerVendas).toBe(true);
    expect(on.logLine).toContain('adServerVendas (DP-43, staging)');
    expect(() => resolveFlags({ APP_ENV: 'production', LN_FLAGS_ON: 'adServerVendas' })).toThrow(/sem decisão para production/);
    expect(resolveFlags({ LN_FLAGS_ON: 'adServerVendas' }).state.adServerVendas).toBe(false); // sem APP_ENV: ignorada
    expect(resolveFlags({ APP_ENV: 'staging' }).state.adServerVendas).toBe(false); // sem LN_FLAGS_ON: desligada
    expect(FLAG_DEFAULTS.adServerVendas).toBe(false); // padrão do código continua desligado
  });

  it('DP-57 e DP-76: produção liga EXATAMENTE portalFormularios e publicacaoPortal POR COMMIT, sem variável; log e on corretos', () => {
    for (const APP_ENV of ['production', 'PRODUCAO', ' producao ']) {
      const r = resolveFlags({ APP_ENV });
      expect(r.ambiente).toBe('production');
      expect(r.on).toEqual(['portalFormularios', 'publicacaoPortal']);
      expect(r.state).toEqual({ ...FLAG_DEFAULTS, portalFormularios: true, publicacaoPortal: true });
      expect(r.logLine).toBe('flags ligadas: portalFormularios (DP-57, production, por commit), publicacaoPortal (DP-76, production, por commit)');
      expect(r.warnings).toEqual([]);
    }
    expect(FLAG_RELEASES.portalFormularios).toEqual({ staging: 'DP-57', production: 'DP-57' });
    expect([...PRODUCTION_FLAGS_ON]).toEqual(['portalFormularios', 'publicacaoPortal']);
    expect(FLAG_DEFAULTS.portalFormularios).toBe(false); // o padrão do código continua desligado
  });

  it('DP-76: publicacaoPortal tem a decisão nos dois ambientes; publicacaoAutonoma e intelligencePessoas não ligam em produção', () => {
    expect(FLAG_RELEASES.publicacaoPortal).toEqual({ staging: 'DP-76', production: 'DP-76' });
    expect(FLAG_DEFAULTS.publicacaoPortal).toBe(false);
    const prod = resolveFlags({ APP_ENV: 'production' });
    expect(prod.state.publicacaoAutonoma).toBe(false);
    expect(prod.state.intelligencePessoas).toBe(false);
    expect(FLAG_RELEASES.intelligencePessoas.production).toBeNull();
    expect((FLAG_RELEASES as Record<string, unknown>).publicacaoAutonoma).toBeUndefined();
    expect(() => resolveFlags({ APP_ENV: 'production', LN_FLAGS_ON: 'publicacaoAutonoma' })).toThrow(/publicacaoAutonoma sem decisão para production/);
  });

  it('DP-76: LN_FLAGS_ON continua recusada em produção para publicacaoPortal; no staging liga por variável, para ensaiar', () => {
    for (const APP_ENV of ['production', 'PRODUCAO', ' producao ']) {
      for (const LN_FLAGS_ON of ['publicacaoPortal', 'portalFormularios,publicacaoPortal']) {
        expect(() => resolveFlags({ APP_ENV, LN_FLAGS_ON })).toThrow(/por LN_FLAGS_ON em production; em produção a flag liga só por commit/);
      }
    }
    expect(resolveFlags({ APP_ENV: 'staging' }).state.publicacaoPortal).toBe(false);
    const stg = resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'publicacaoPortal' });
    expect(stg.on).toEqual(['publicacaoPortal']);
    expect(stg.logLine).toBe('flags ligadas: publicacaoPortal (DP-76, staging)');
  });

  it('DP-57: adServerVendas continua DESLIGADA em produção e fora de PRODUCTION_FLAGS_ON', () => {
    expect(resolveFlags({ APP_ENV: 'production' }).state.adServerVendas).toBe(false);
    expect((PRODUCTION_FLAGS_ON as readonly string[]).includes('adServerVendas')).toBe(false);
    expect(FLAG_RELEASES.adServerVendas.production).toBeNull();
  });

  it('DP-57: LN_FLAGS_ON continua proibida em produção, mesmo para flag com decisão de produção', () => {
    expect(() => resolveFlags({ APP_ENV: 'production', LN_FLAGS_ON: 'portalFormularios' })).toThrow(
      new Error('Subida recusada: flag portalFormularios por LN_FLAGS_ON em production; em produção a flag liga só por commit (PRODUCTION_FLAGS_ON) (ADR-022)'),
    );
    expect(() => resolveFlags({ APP_ENV: 'production', LN_FLAGS_ON: 'adServerVendas' })).toThrow(/sem decisão para production/);
    expect(() => resolveFlags({ APP_ENV: 'production', LN_FLAGS_ON: 'flagInexistente' })).toThrow(/flag desconhecida flagInexistente/);
  });

  it('DP-57: a ligação por commit vale SÓ em production (staging, local, CI e sem APP_ENV não ligam nada sozinhos)', () => {
    for (const APP_ENV of [undefined, 'staging', 'development', 'ci', 'local', 'prod']) {
      const r = resolveFlags({ APP_ENV });
      expect(r.on).toEqual([]);
      expect(r.state.portalFormularios).toBe(false);
    }
    const stg = resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'portalFormularios' }); // staging: por variável, com a DP-57, para ensaiar
    expect(stg.on).toEqual(['portalFormularios']);
    expect(stg.logLine).toBe('flags ligadas: portalFormularios (DP-57, staging)');
  });

  it('DP-57: productionFlagsByCommit falha fechada (flag sem decisão de produção, desconhecida ou fora do formato)', () => {
    expect(productionFlagsByCommit(['portalFormularios', 'portalFormularios'])).toEqual([{ nome: 'portalFormularios', decisao: 'DP-57' }]);
    expect(productionFlagsByCommit(PRODUCTION_FLAGS_ON)).toEqual([{ nome: 'portalFormularios', decisao: 'DP-57' }, { nome: 'publicacaoPortal', decisao: 'DP-76' }]);
    expect(productionFlagsByCommit([])).toEqual([]);
    expect(() => productionFlagsByCommit(['adServerVendas'])).toThrow(
      new Error('Subida recusada: flag adServerVendas em PRODUCTION_FLAGS_ON sem decisão para production (ADR-022)'),
    );
    expect(() => productionFlagsByCommit(['planosPagos'])).toThrow(/planosPagos em PRODUCTION_FLAGS_ON sem decisão/);
    expect(() => productionFlagsByCommit(['flagInexistente'])).toThrow(/PRODUCTION_FLAGS_ON com flag desconhecida flagInexistente/);
    expect(() => productionFlagsByCommit(['sk-abc/<x>'])).toThrow(new Error('Subida recusada: PRODUCTION_FLAGS_ON com flag desconhecida nome inválido (ADR-022)'));
    // o conjunto real do contrato é válido
    expect(() => productionFlagsByCommit(PRODUCTION_FLAGS_ON)).not.toThrow();
  });

  it('N6: todo id de produção existe em governance/decisions.yaml', () => {
    const yaml = readFileSync(new URL('../../../governance/decisions.yaml', import.meta.url), 'utf8');
    for (const [, rel] of Object.entries(FLAG_RELEASES)) {
      const id = rel.production as string | null;
      if (id !== null) expect(yaml).toContain(`"id": "${id}"`);
    }
  });

  it('N7 (DP-54): o staging recusa NEXT_PUBLIC_SITE_URL de qualquer host de produção (www, apex e o host da Vertra), em qualquer caixa; o host do staging passa', () => {
    expect([...PRODUCTION_HOSTS].sort()).toEqual(['loyaltynews.com.br', 'loyaltynews.vertraweb.app', 'www.loyaltynews.com.br']);
    for (const url of ['https://www.loyaltynews.com.br', 'https://loyaltynews.com.br/', 'https://loyaltynews.vertraweb.app', 'https://WWW.LoyaltyNews.com.br/qualquer']) {
      expect(() => resolveFlags({ APP_ENV: 'staging', NEXT_PUBLIC_SITE_URL: url })).toThrow(/NEXT_PUBLIC_SITE_URL de produção/);
    }
    expect(() => resolveFlags({ APP_ENV: 'staging', NEXT_PUBLIC_SITE_URL: 'https://loyaltynews-stg.vertraweb.app' })).not.toThrow();
    // a produção em si não é barrada por esta regra (ela só vale para o modo staging)
    expect(() => resolveFlags({ APP_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://www.loyaltynews.com.br' })).not.toThrow();
  });
});
