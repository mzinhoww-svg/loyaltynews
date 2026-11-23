import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Db as IntelDb } from '@ln/intelligence';
import { startIntelligenceReread } from './intelligence-reread';
import { workerFlagResolver } from './worker-flags';

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

  it('configuração inválida (produção com flag sem decisão, nome desconhecido): falha fechada com log saneado, sem o valor bruto', () => {
    for (const LN_FLAGS_ON of ['leitorViaProvedor', 'sk-segredo/x']) {
      const lines: string[] = [];
      const f = workerFlagResolver({ APP_ENV: LN_FLAGS_ON === 'leitorViaProvedor' ? 'production' : 'staging', LN_FLAGS_ON }, (l) => lines.push(l));
      expect(f('leitorViaProvedor')).toBe(false);
      expect(lines.join('\n')).toMatch(/Subida recusada|flags desligadas/);
      expect(lines.join('\n')).not.toContain('sk-segredo');
    }
  });
});

describe('job de releitura ligado ao resolvedor do worker', () => {
  it('sem a flag fica desligado; com ela no staging liga; em produção não liga', () => {
    const off = startIntelligenceReread({ db, env: JOB, flags: workerFlagResolver({ APP_ENV: 'staging' }, quiet), log: quiet });
    expect(off).toBeNull();
    const prod = startIntelligenceReread({ db, env: JOB, flags: workerFlagResolver({ APP_ENV: 'production', LN_FLAGS_ON: 'intelligencePessoas' }, quiet), log: quiet });
    expect(prod).toBeNull();
    const on = startIntelligenceReread({ db, env: JOB, flags: workerFlagResolver({ APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas,leitorViaProvedor' }, quiet), log: quiet });
    expect(on).not.toBeNull();
    on!.stop();
  });
});
