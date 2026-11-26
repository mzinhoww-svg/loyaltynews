import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Dados de EXEMPLO (não são leituras de produção). Repositório git temporário: "antiga" não tem a retenção, "nova" tem.
const SCRIPT = fileURLToPath(new URL('../scripts/verificar-lead-prod.mjs', import.meta.url));
let dir = ''; let antiga = ''; let retencao = ''; let nova = '';

const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
const commit = (m: string, data: string) => {
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', m], { env: { ...process.env, GIT_COMMITTER_DATE: data, GIT_AUTHOR_DATE: data } });
  return git('rev-parse', 'HEAD');
};
const arquivo = (nome: string, conteudo: unknown) => { const p = join(dir, nome); writeFileSync(p, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo)); return p; };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ln-verif-lead-'));
  execFileSync('git', ['init', '-q', dir]);
  antiga = commit('antiga', '2030-01-01T00:00:00Z');
  retencao = commit('retencao', '2030-01-02T00:00:00Z');
  nova = commit('nova', '2030-01-03T00:00:00Z');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Over = Partial<Record<'commit' | 'envio' | 'fonte' | 'log' | 'saltWeb' | 'saltWorkers' | 'saltIgual', string>>;
function rodar(o: Over = {}) {
  const saude = arquivo('health.json', { status: 'ok', env: 'production', version: nova });
  const releases = arquivo('releases.json', { data: [{ source: o.fonte ?? 'upload', files_changed: o.fonte === 'env_change' ? 0 : 10, created_at: o.envio ?? '2030-01-04T10:00:00Z' }] });
  const log = arquivo('worker.log', o.log ?? '2030-01-04T10:00:05Z guard-env OK (APP_ENV=production)\n2030-01-04T10:00:06Z [workers] filas: a=on\n2030-01-04T10:00:07Z [workers] no ar; filas com handler: 1');
  const a = ['--repo', dir, '--retencao', retencao, '--exclusao', retencao, '--web-health', saude, '--worker-commit', o.commit ?? nova, '--worker-releases', releases, '--worker-log', log,
    '--salt-web', o.saltWeb ?? 'sim', '--salt-workers', o.saltWorkers ?? 'sim', '--salt-igual', o.saltIgual ?? 'sim'];
  const r = spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
}

describe('verificação pós-deploy do ciclo do lead', () => {
  it('estado corrigido (exemplo) é aprovado', () => {
    const r = rodar();
    expect(r.out).toContain('APROVADO: 10 de 10 itens');
    expect(r.code).toBe(0);
  });
  it.each<[string, Over, string]>([
    ['worker em commit sem a retenção', { commit: 'ANTIGA' }, 'worker: commit contém a retenção'],
    ['só mudou variável, sem envio de código', { fonte: 'env_change' }, 'worker: envio de código posterior à retenção'],
    ['envio de código anterior à retenção', { envio: '2030-01-01T12:00:00Z' }, 'worker: envio de código posterior à retenção'],
    ['log sem a linha das filas', { log: '2030-01-04T10:00:05Z guard-env OK\n2030-01-04T10:00:07Z [workers] no ar; filas com handler: 0' }, 'log da subida traz'],
    ['linha das filas só numa subida anterior', { log: '2030-01-04T10:00:01Z guard-env OK\n2030-01-04T10:00:02Z [workers] filas: a\n2030-01-04T10:00:03Z [workers] no ar\n2030-01-04T11:00:00Z guard-env OK\n2030-01-04T11:00:01Z [workers] no ar' }, 'log da subida traz'],
    ['retenção falhando', { log: '2030-01-04T10:00:05Z guard-env OK\n2030-01-04T10:00:06Z [workers] filas: a\n2030-01-04T10:00:07Z [workers] no ar\n2030-01-04T10:00:08Z [workers] retenção de leads falhou' }, 'sem falha de retenção'],
    ['log anterior ao envio', { envio: '2030-01-05T00:00:00Z' }, 'a subida é posterior ao envio'],
    ['sal ausente no web', { saltWeb: 'nao' }, 'sal presente no web'],
    ['sal ausente no worker', { saltWorkers: 'nao' }, 'sal presente no worker'],
    ['sal diferente', { saltIgual: 'nao' }, 'sal igual nos dois'],
    ['sal não informado', { saltIgual: '?' }, 'sal igual nos dois'],
  ])('reprova: %s', (_nome, over, trecho) => {
    const r = rodar(over.commit === 'ANTIGA' ? { ...over, commit: antiga } : over);
    expect(r.code).toBe(1);
    expect(r.out.split('\n').some((l) => l.startsWith('FALHA') && l.includes(trecho)), r.out).toBe(true);
  });
  it('sem nenhuma informação reprova (falha fechada) e argumento solto é erro de uso', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--repo', dir, '--retencao', retencao, '--exclusao', retencao], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('REPROVADO: 10 de 10');
    expect(spawnSync(process.execPath, [SCRIPT, '--salt-web'], { encoding: 'utf8' }).status).toBe(2);
  });
});
