import { describe, expect, it } from 'vitest';
import { INBOX_FINDING, InMemoryEditorialStore } from '@ln/editorial';
import { WithdrawRefused, assertWithdrawEnvironment, parseWithdrawArgs, runWithdraw } from './editorial-withdraw';
import bindingsFile from '../../../infra/vertra/bindings.json';
import { readFileSync } from 'node:fs';

describe('comando de retirada', () => {
  it('aceita um alvo só; sem alvo, com dois ou com argumento estranho recusa', () => {
    expect(parseWithdrawArgs(['--ambiente', 'staging', '--fonte', 'mestre-das-milhas'])).toEqual({ what: { sourceId: 'mestre-das-milhas' }, confirm: false, environment: 'staging' });
    expect(parseWithdrawArgs(['--url', 'https://x.example/a', '--ambiente', 'production', '--confirmar'])).toEqual({ what: { url: 'https://x.example/a' }, confirm: true, environment: 'production' });
    expect(parseWithdrawArgs(['--fonte', 'mestre-das-milhas'])).toBeNull();
    expect(parseWithdrawArgs(['--ambiente', 'prod', '--fonte', 'a'])).toBeNull();
    for (const ruim of [[], ['--confirmar'], ['--fonte'], ['--fonte', '--confirmar'], ['--fonte', 'a', '--url', 'https://x.example/a'], ['--url', 'http://x.example/a'], ['--fonte', 'a', '--tudo']]) {
      expect(parseWithdrawArgs(['--ambiente', 'staging', ...ruim]), ruim.join(' ')).toBeNull();
    }
  });
  it('sem --confirmar só conta; com --confirmar apaga', async () => {
    const store = new InMemoryEditorialStore();
    await store.putArticle({
      articleId: 'a', editoria: 'pontos', status: 'rascunho', blockers: [], reviews: [], recheckCount: 0, updatedAt: '2026-11-28T00:00:00.000Z',
      findings: [{ code: INBOX_FINDING, message: 'item coletado sem modelo' }],
      evidences: [{ id: 'ev', sourceId: 'mestre-das-milhas', url: 'https://x.example/a', canonicalUrl: 'https://x.example/a', fetchedAt: '2026-11-28T00:00:00.000Z', contentSha256: 'a'.repeat(64), title: 'MOCK', text: 'Texto MOCK', publishedAt: null, suspicious: false, suspiciousReasons: [] }],
    });
    const args = parseWithdrawArgs(['--ambiente', 'staging', '--fonte', 'mestre-das-milhas'])!;
    expect(await runWithdraw(store, { ...args, what: { sourceId: 'abemf' }, confirm: true }, new Date())).toContain('nada casou');
    expect(await runWithdraw(store, args, new Date())).toContain('1 item(ns) seriam apagados');
    expect((await store.getArticle('a'))!.evidences[0]!.text).toBe('Texto MOCK');
    expect(await store.listAudit()).toEqual([]);
    expect(await runWithdraw(store, { ...args, confirm: true }, new Date())).toContain('retirada feita: 1');
    expect((await store.getArticle('a'))!.evidences[0]!.text).toBe('');
  });
});

// Parecer 105: endereços e senhas fictícios; o vínculo real só é lido.
const VINCULO = { ambientes: { staging: { dbHost: 'stg.mock.example', dbName: 'mockstg' }, production: { dbHost: 'prod.mock.example', dbName: 'mockprod' } } };
// montado em partes para a varredura de segredos do repositório não ler um endereço com senha
const banco = (host: string, nome: string) => 'postgres:' + `//mock:segredo-mock@${host}:5432/${nome}`;
const DE = { staging: banco('stg.mock.example', 'mockstg'), production: banco('prod.mock.example', 'mockprod') };
const confere = (app: string | undefined, ambiente: 'staging' | 'production', url: string | undefined, v: unknown = VINCULO) => () =>
  assertWithdrawEnvironment({ APP_ENV: app, DATABASE_URL: url }, ambiente, v as typeof VINCULO);

describe('retirada: só no banco registrado do ambiente (parecer 105)', () => {
  it.each(['staging', 'production'] as const)('%s roda no próprio banco, com ou sem parâmetros de TLS', (a) => {
    expect(confere(a, a, DE[a])).not.toThrow();
    expect(confere(a, a, `${DE[a]}?sslmode=verify-full`)).not.toThrow();
  });

  it.each(['staging', 'production'] as const)('%s recusa o outro banco e todo endereço que troque o destino, sem repetir o valor', (a) => {
    const meu = DE[a];
    const outro = DE[a === 'staging' ? 'production' : 'staging'];
    const ruins = [
      outro, meu.replace(/mock(stg|prod)$/, 'outro'), meu.replace(/@[^:]+/, '@203.0.113.7'), meu.replace('.mock.example', '.mock.example.'),
      `${meu}?host=${new URL(outro).hostname}`, `${meu}?sslmode=require&port=6000`, `${meu}?%68ost=x`, `${meu}?hostaddr=203.0.113.7`, `${meu}?dbname=outro`,
      `${meu}?database=outro`, `${meu}?options=-c%20x`, `${meu}?target_session_attrs=any`, `${meu} `, meu.replace('postgres:', 'http:'), '/var/run/postgresql', '', undefined,
    ];
    for (const url of ruins) {
      let erro: unknown;
      try { confere(a, a, url)(); } catch (e) { erro = e; }
      expect(erro, String(url)).toBeInstanceOf(WithdrawRefused);
      expect((erro as Error).message).not.toMatch(/mock\.example|segredo-mock|203\.0\.113/);
    }
  });

  it('APP_ENV diferente de --ambiente recusa, mesmo com o banco certo', () => {
    for (const app of [undefined, '', 'production', 'Staging', ' staging', 'ci']) expect(confere(app, 'staging', DE.staging), String(app)).toThrow(/APP_ENV/);
    expect(confere('staging', 'production', DE.production)).toThrow(/APP_ENV/);
  });

  it('ambiente sem vínculo registrado recusa', () => {
    const semProd = { ambientes: { staging: VINCULO.ambientes.staging, production: { dbHost: null, dbName: null } } };
    expect(confere('production', 'production', DE.production, semProd)).toThrow(/sem vínculo/);
    expect(confere('production', 'production', DE.production, { ambientes: {} })).toThrow(/sem vínculo/);
  });

  it('com o vínculo real do repositório, cada ambiente só aceita o seu banco', () => {
    const url = (x: { dbHost: string; dbName: string }) => `postgres://u@${x.dbHost}:5432/${x.dbName}`;
    const { staging, production } = bindingsFile.ambientes;
    expect(() => assertWithdrawEnvironment({ APP_ENV: 'staging', DATABASE_URL: url(staging) }, 'staging')).not.toThrow();
    expect(() => assertWithdrawEnvironment({ APP_ENV: 'staging', DATABASE_URL: url(production) }, 'staging')).toThrow(WithdrawRefused);
    expect(() => assertWithdrawEnvironment({ APP_ENV: 'production', DATABASE_URL: url(staging) }, 'production')).toThrow(WithdrawRefused);
  });

  it('o comando confere antes de abrir conexão', () => {
    const main = readFileSync(new URL('editorial-withdraw.main.ts', import.meta.url), 'utf8');
    const trava = main.indexOf('assertWithdrawEnvironment(process.env');
    expect(trava).toBeGreaterThan(0);
    for (const depois of ['createFactoryPool(process.env', 'new PgEditorialStore', 'runWithdraw(store']) expect(main.indexOf(depois), depois).toBeGreaterThan(trava);
  });
});
