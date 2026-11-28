// DP-94: a Fábrica avulsa recusa produção por ambiente e por banco. Endereços e senha fictícios; o vínculo real só é lido.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import bindingsFile from '../../../infra/vertra/bindings.json';
import { FactoryRefused, assertFactoryEnvironment } from './editorial-factory-guard';

const vinculo = { ambientes: { staging: { dbHost: 'stg.mock.example', dbName: 'mockdb' }, production: { dbHost: 'prod.mock.example', dbName: 'mockdb' } } };
const STG = 'postgres://mock:segredo-mock@stg.mock.example:5432/mockdb';
const PROD = 'postgres://mock:segredo-mock@prod.mock.example:5432/mockdb';
const roda = (APP_ENV: string | undefined, DATABASE_URL: string | undefined, b = vinculo) => () => assertFactoryEnvironment({ APP_ENV, DATABASE_URL }, b);

describe('Fábrica avulsa: só staging (DP-94)', () => {
  it('staging no banco de staging roda, com ou sem parâmetros de TLS', () => {
    expect(roda('staging', STG)).not.toThrow();
    expect(roda('staging', `${STG}?sslmode=verify-full`)).not.toThrow();
    expect(roda('staging', STG.replace('stg.mock', 'STG.Mock').replace('postgres:', 'postgresql:'))).not.toThrow();
  });

  it.each([undefined, '', 'production', 'producao', 'PRODUCTION', ' production ', 'ci', 'local', 'Staging', ' staging '])('APP_ENV=%j recusa, mesmo com o banco de staging', (app) => {
    expect(roda(app, STG)).toThrow(FactoryRefused);
  });

  it.each([
    ['banco de produção', PROD],
    ['produção com ponto no fim', PROD.replace('prod.mock.example', 'prod.mock.example.')],
    ['outro host (apelido ou IP)', STG.replace('stg.mock.example', '203.0.113.7')],
    ['outro banco no host de staging', STG.replace('/mockdb', '/outro')],
    ['host trocado por parâmetro', `${STG}?host=prod.mock.example`],
    ['porta trocada por parâmetro', `${STG}?sslmode=require&port=6000`],
    ['parâmetro codificado', `${STG}?%68ost=prod.mock.example`],
    ['espaço', `${STG} `],
    ['sem protocolo postgres', STG.replace('postgres:', 'http:')],
    ['socket', '/var/run/postgresql'],
    ['vazio', ''],
  ])('APP_ENV=staging recusa %s, sem repetir endereço nem senha', (_nome, url) => {
    let erro: unknown;
    try { roda('staging', url)(); } catch (e) { erro = e; }
    expect(erro).toBeInstanceOf(FactoryRefused);
    expect((erro as Error).message).not.toMatch(/mock\.example|segredo-mock|203\.0\.113/);
  });

  it('sem vínculo de staging, recusa', () => {
    expect(roda('staging', STG, { ambientes: { staging: { dbHost: null, dbName: null } } } as unknown as typeof vinculo)).toThrow(/sem vínculo/);
  });

  it('com o vínculo real do repositório, o banco de produção registrado é recusado e o de staging passa', () => {
    const { staging, production } = bindingsFile.ambientes;
    const url = (a: { dbHost: string; dbName: string }) => `postgres://u:p@${a.dbHost}:5432/${a.dbName}`;
    expect(() => assertFactoryEnvironment({ APP_ENV: 'staging', DATABASE_URL: url(production) })).toThrow(FactoryRefused);
    expect(() => assertFactoryEnvironment({ APP_ENV: 'staging', DATABASE_URL: url(staging) })).not.toThrow();
  });

  it('o comando confere o ambiente antes de abrir conexão', () => {
    const main = readFileSync(new URL('editorial-factory.main.ts', import.meta.url), 'utf8');
    const trava = main.indexOf('assertFactoryEnvironment(process.env)');
    expect(trava).toBeGreaterThan(0);
    for (const depois of ['createFactoryPool(process.env', 'loadPilotWiring(process.env', 'runEditorialFactory({', 'runEditorialAutoral({']) expect(main.indexOf(depois), depois).toBeGreaterThan(trava);
  });
});
