import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Db as IntelDb } from '@ln/intelligence';
import { startIntelligenceReread } from './intelligence-reread';
import { resolveWorkerFlags, workerFlagResolver } from './worker-flags';

const SEED = fileURLToPath(new URL('../../../packages/intelligence/data/seed.public.v5.json', import.meta.url));
const db = { query: async () => ({ rows: [] }) } as unknown as IntelDb;
const JOB = { LN_INTELLIGENCE_REREAD: 'on', LN_REREAD_SEED: SEED };
const quiet = () => undefined;

describe('worker: flags de produto pelo resolvedor da ADR-022', () => {
  it('sem LN_FLAGS_ON, em ambiente desconhecido ou em produção: tudo desligado', () => {
    for (const env of [{}, { APP_ENV: 'staging' }, { APP_ENV: 'ci', LN_FLAGS_ON: 'intelligencePessoas,leitorViaProvedor' }, { APP_ENV: 'production' }]) {
      const f = workerFlagResolver(env, quiet);
      expect(f('intelligencePessoas')).toBe(false);
      expect(f('leitorViaProvedor')).toBe(false);
    }
  });

  it('staging liga só o que está em LN_FLAGS_ON', () => {
    const f = workerFlagResolver({ APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas,leitorViaProvedor' }, quiet);
    expect(f('intelligencePessoas')).toBe(true);
    expect(f('leitorViaProvedor')).toBe(true);
    expect(f('openbotDispatch')).toBe(false);
  });

  it('configuração inválida LANÇA na subida (não desliga em silêncio): diz a flag e o ambiente, sem o valor bruto', () => {
    expect(() => resolveWorkerFlags({ APP_ENV: 'production', LN_FLAGS_ON: 'leitorViaProvedor' }, quiet))
      .toThrow(/flag leitorViaProvedor sem decisão para production/);
    let msg = '';
    try {
      resolveWorkerFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'sk-segredo/x' }, quiet);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toMatch(/flag desconhecida/);
    expect(msg).not.toContain('sk-segredo'); // nome fora do formato permitido não é ecoado
  });
});

describe('job de releitura ligado ao resolvedor do worker', () => {
  it('sem a flag fica desligado; com ela no staging liga', () => {
    const off = startIntelligenceReread({ db, env: JOB, flags: workerFlagResolver({ APP_ENV: 'staging' }, quiet), log: quiet });
    expect(off).toBeNull();
    const on = startIntelligenceReread({ db, env: JOB, flags: workerFlagResolver({ APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas,leitorViaProvedor' }, quiet), log: quiet });
    expect(on).not.toBeNull();
    on!.stop();
  });

  it('em produção a flag não liga (o worker não sobe com ela)', () => {
    expect(() => resolveWorkerFlags({ APP_ENV: 'production', LN_FLAGS_ON: 'intelligencePessoas' }, quiet)).toThrow(/sem decisão para production/);
    const off = startIntelligenceReread({ db, env: JOB, flags: workerFlagResolver({ APP_ENV: 'production' }, quiet), log: quiet });
    expect(off).toBeNull();
  });
});
