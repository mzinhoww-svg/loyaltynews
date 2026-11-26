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

const RODADA = '[workers] retenção de leads: rodada concluída {"naoConvertidos":0,"descartados":0}';
const LOG = ['2030-01-04T10:00:05Z guard-env OK (APP_ENV=production)', '2030-01-04T10:00:06Z [workers] filas: a=on', '2030-01-04T10:00:07Z [workers] no ar; filas com handler: 1', `2030-01-04T10:00:08Z ${RODADA}`];
const juntar = (...l: string[]) => l.join('\n');
const ENVIO = { id: 'rel-envio', source: 'upload', files_changed: 10, created_at: '2030-01-04T10:00:00Z' };

type Over = { commit?: string; releases?: object[]; log?: string; status?: string; manifesto?: string; releaseDoPacote?: string; agora?: string; saltWeb?: string; saltWorkers?: string; saltIgual?: string };
function rodar(o: Over = {}) {
  const saude = arquivo('health.json', { status: 'ok', env: 'production', version: nova });
  const releases = arquivo('releases.json', { data: o.releases ?? [ENVIO] });
  const log = arquivo('worker.log', o.log ?? juntar(...LOG));
  const pacote = arquivo('release.json', { commit: o.manifesto === 'ANTIGA' ? antiga : nova });
  const a = ['--repo', dir, '--retencao', retencao, '--exclusao', retencao, '--web-health', saude, '--worker-commit', o.commit === 'ANTIGA' ? antiga : nova, '--worker-releases', releases, '--worker-log', log,
    '--worker-status', o.status ?? 'up', '--pacote', pacote, '--release-do-pacote', o.releaseDoPacote ?? 'rel-envio', '--agora', o.agora ?? '2030-01-04T12:00:00Z',
    '--salt-web', o.saltWeb ?? 'sim', '--salt-workers', o.saltWorkers ?? 'sim', '--salt-igual', o.saltIgual ?? 'sim'];
  const r = spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
}

describe('verificação pós-deploy do ciclo do lead', () => {
  it('estado corrigido (exemplo) é aprovado', () => {
    const r = rodar();
    expect(r.out).toContain('APROVADO: 14 de 14 itens');
    expect(r.code).toBe(0);
  });
  it.each<[string, Over, string]>([
    ['worker em commit sem a retenção', { commit: 'ANTIGA' }, 'worker: commit contém a retenção'],
    ['só mudou variável, sem envio de código', { releases: [{ ...ENVIO, source: 'env_change', files_changed: 0 }] }, 'último código é um envio'],
    ['envio anterior à retenção', { releases: [{ ...ENVIO, created_at: '2030-01-01T12:00:00Z' }] }, 'último código é um envio'],
    ['rollback depois do envio', { releases: [ENVIO, { id: 'rel-volta', source: 'rollback', files_changed: 10, created_at: '2030-01-04T11:00:00Z' }] }, 'último código é um envio'],
    ['release sem origem (sonda do QA 6)', { releases: [{ id: 'rel-envio', files_changed: 10, created_at: ENVIO.created_at }] }, 'origem conhecida'],
    ['origem desconhecida', { releases: [{ ...ENVIO, source: 'outra' }] }, 'origem conhecida'],
    ['release sem contagem de arquivos', { releases: [{ id: 'rel-envio', source: 'upload', created_at: ENVIO.created_at }] }, 'origem conhecida'],
    ['pacote de outro commit', { manifesto: 'ANTIGA' }, 'pacote enviado ligado ao commit'],
    ['release que não é o do pacote', { releaseDoPacote: 'rel-outro' }, 'pacote enviado ligado ao commit'],
    ['aplicação fora do ar', { status: 'down' }, 'aplicação no ar'],
    ['parou depois de subir (sonda do QA 6)', { log: juntar(...LOG, '2030-01-04T10:01:00Z process exited; worker stopped') }, 'sem parada nem falha'],
    ['sem nenhuma rodada concluída (rodada pendurada)', { log: juntar(...LOG.slice(0, 3)) }, 'rodada de retenção concluída'],
    ['log antigo', { agora: '2030-01-05T12:00:00Z' }, 'rodada de retenção concluída'],
    ['rodada com data no futuro', { agora: '2030-01-04T09:00:00Z' }, 'rodada de retenção concluída'],
    ['rodada só numa subida anterior', { log: juntar(...LOG, '2030-01-04T11:00:00Z guard-env OK', '2030-01-04T11:00:01Z [workers] filas: a', '2030-01-04T11:00:02Z [workers] no ar') }, 'rodada de retenção concluída'],
    ['log sem a linha das filas', { log: juntar(LOG[0]!, LOG[2]!, LOG[3]!) }, 'log da subida traz'],
    ['retenção falhando', { log: juntar(...LOG, '2030-01-04T10:00:09Z [workers] retenção de leads falhou') }, 'sem parada nem falha'],
    ['log anterior ao envio', { releases: [{ ...ENVIO, created_at: '2030-01-05T00:00:00Z' }] }, 'a subida é posterior ao envio'],
    ['sal ausente no web', { saltWeb: 'nao' }, 'sal presente no web'],
    ['sal ausente no worker', { saltWorkers: 'nao' }, 'sal presente no worker'],
    ['sal diferente', { saltIgual: 'nao' }, 'sal igual nos dois'],
    ['sal não informado', { saltIgual: '?' }, 'sal igual nos dois'],
  ])('reprova: %s', (_nome, over, trecho) => {
    const r = rodar(over);
    expect(r.code).toBe(1);
    expect(r.out.split('\n').some((l) => l.startsWith('FALHA') && l.includes(trecho)), r.out).toBe(true);
  });
  it('sem nenhuma informação reprova (falha fechada); argumento solto ou prazo absurdo é erro de uso', () => {
    const base = [SCRIPT, '--repo', dir, '--retencao', retencao, '--exclusao', retencao];
    const r = spawnSync(process.execPath, base, { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('REPROVADO: 14 de 14');
    expect(spawnSync(process.execPath, [SCRIPT, '--salt-web'], { encoding: 'utf8' }).status).toBe(2);
    expect(spawnSync(process.execPath, [...base, '--max-horas', '999'], { encoding: 'utf8' }).status).toBe(2);
  });
});
