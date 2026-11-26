import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthPayload, healthProblem } from './health';
import { readBuildIdentity } from './build-identity';

const SHA = 'a'.repeat(40);
const tmp = () => mkdtempSync(join(tmpdir(), 'ln-health-'));
const put = (root: string, rel: string, txt: string) => { const p = join(root, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, txt); };

describe('health', () => {
  it('devolve version, env, buildId e buildCommit; flags só como lista de nomes', () => {
    const p = healthPayload({ APP_COMMIT: 'abc1234', APP_ENV: 'homologacao' });
    expect(p).toEqual({ status: 'ok', service: 'loyaltynews-web', version: 'abc1234', buildId: null, buildCommit: null, env: 'homologacao', flags: [] });
    expect(Object.keys(p)).not.toContain('flagsLigadas');
  });
  it('flags ligadas aparecem só pelo nome', () => {
    expect(healthPayload({ APP_ENV: 'staging' }, ['intelligencePessoas']).flags).toEqual(['intelligencePessoas']);
  });
  it('sem variáveis, valores neutros', () => {
    expect(healthPayload({})).toMatchObject({ version: 'unknown', env: 'local', buildId: null, buildCommit: null });
  });

  it('lê o BUILD_ID do .next e o commit da marca; pacote comum não tem marca', () => {
    const r = tmp();
    try {
      put(r, '.next/BUILD_ID', 'BUILD_abc123\n');
      expect(readBuildIdentity(r)).toEqual({ buildId: 'BUILD_abc123', commit: null, prebuilt: false });
      put(r, '.next/.ln-prebuilt.json', JSON.stringify({ buildId: 'BUILD_abc123', commit: SHA }));
      expect(readBuildIdentity(r)).toEqual({ buildId: 'BUILD_abc123', commit: SHA, prebuilt: true });
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it('healthProblem: marca de outro commit dá build_divergente; pacote comum e commit igual não', () => {
    const id = { buildId: 'BUILD_abc123', commit: SHA, prebuilt: true };
    expect(healthProblem({ APP_COMMIT: SHA }, id)).toBeNull();
    expect(healthProblem({ APP_COMMIT: 'b'.repeat(40) }, id)).toBe('build_divergente');
    expect(healthProblem({ APP_COMMIT: 'b'.repeat(40) }, { ...id, prebuilt: false, commit: null })).toBeNull();
    expect(healthProblem({}, id)).toBeNull();
  });
});
