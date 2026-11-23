// ADR-001 / Vertra: o pool do PostgreSQL da Fábrica NUNCA abre sem TLS (certificado de cliente). Estes testes falham se alguém voltar a
// criar `new Pool({ connectionString })` no código da Fábrica ou deixar o pool sem ouvinte de 'error' (C1).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFactoryPool } from './editorial-factory';

// Par certificado/chave de TESTE (autoassinado, gerado só para os testes; não protege nada): precisa ser PEM válido para a autoverificação.
const CERT = '-----BEGIN CERTIFICATE-----\nMIIBjDCCATOgAwIBAgIUSfG+UDW/PdEktFe3K/RyQ9UXcrkwCgYIKoZIzj0EAwIw\nGzEZMBcGA1UEAwwQbG4tdGVzdGUtZmFicmljYTAgFw0yNjExMjMxODA0MjRaGA8y\nMTI2MTAzMDE4MDQyNFowGzEZMBcGA1UEAwwQbG4tdGVzdGUtZmFicmljYTBZMBMG\nByqGSM49AgEGCCqGSM49AwEHA0IABBUb0w0KUuIGL4Al0i9d/zpeHCgAdbZAXKNi\nqQxrXeyv1nKA9VZFZkWlYrET9POvkQupi6g1o3V3+v6cqHJVBFqjUzBRMB0GA1Ud\nDgQWBBTbQFb3G02HW/7lXe6VZXc/qylnMDAfBgNVHSMEGDAWgBTbQFb3G02HW/7l\nXe6VZXc/qylnMDAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCICej\nSc8qTDuFuPM7WTNY7QqbLjtdltd6QL5N6lLnEnrvAiBTJzWvkhtVWrjiSdqYD5Ex\nD0qEs0i8w7S/fnRq6iM1mA==\n-----END CERTIFICATE-----\n';
const KEY = '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIGgZc85zoFb54sA8WKSUn3iAlbyH/aCrlYjl69j7qQ+LoAoGCCqGSM49\nAwEHoUQDQgAEFRvTDQpS4gYvgCXSL13/Ol4cKAB1tkBco2KpDGtd7K/WcoD1VkVm\nRaVisRP086+RC6mLqDWjdXf6/pyoclUEWg==\n-----END EC PRIVATE KEY-----\n';
const oneLine = (pem: string) => pem.trimEnd().replace(/\n/g, '\\n'); // como o painel de variáveis da Vertra achata o PEM
const DB_URL = 'postgres://u:p@db.vertra.example:5432/ln?sslmode=require&application_name=fabrica';
const TLS_ENV = { DATABASE_URL: DB_URL, DB_SSL_CA_PEM: oneLine(CERT), DB_SSL_CERT_PEM: oneLine(CERT), DB_SSL_KEY_PEM: oneLine(KEY) };
type PoolOpts = { connectionString?: string; ssl?: false | { ca: string; cert: string; key: string; rejectUnauthorized: boolean }; max?: number };
const optsOf = (p: unknown) => (p as { options: PoolOpts }).options;

describe('pool da Fábrica: sempre TLS (ADR-001)', () => {
  it('estático: o código da Fábrica não cria Pool sem pgPoolConfig e o main usa o construtor com TLS', () => {
    const dir = new URL('./', import.meta.url);
    for (const f of ['editorial-factory.ts', 'editorial-factory.main.ts']) {
      const src = readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      expect(src, f).not.toMatch(/new Pool\(\s*\{/);
      expect(src, f).not.toMatch(/new Pool\(\s*(?!pgPoolConfig)[^)]*connectionString/);
    }
    const lib = readFileSync(new URL('editorial-factory.ts', dir), 'utf8');
    expect(lib).toMatch(/new Pool\(pgPoolConfig\(\{ \.\.\.env, DB_SSL_MODE:/);
    expect(lib).toMatch(/pool\.on\('error', onClientError\(/);
    const main = readFileSync(new URL('editorial-factory.main.ts', dir), 'utf8');
    expect(main).not.toMatch(/new Pool\(/);
    expect(main).toContain('createFactoryPool(process.env');
    expect(main).toContain('installOutputFilter()');
  });

  it('com os PEM (uma linha com \\n escapado): ssl verify-full com certificado de cliente; a URL perde sslmode e mantém o resto', () => {
    const pool = createFactoryPool(TLS_ENV, { log: () => {} });
    const o = optsOf(pool);
    expect(o.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(o.ssl && o.ssl.ca).toBe(CERT); expect(o.ssl && o.ssl.cert).toBe(CERT); expect(o.ssl && o.ssl.key).toBe(KEY);
    expect(o.connectionString).toBe('postgres://u:p@db.vertra.example:5432/ln?application_name=fabrica');
    expect(o.max).toBe(4);
    expect(optsOf(createFactoryPool(TLS_ENV, { max: 2, log: () => {} })).max).toBe(2);
  });

  it('SEM TLS o pool NÃO abre: sem PEM (qualquer NODE_ENV), PEM incompleto, DB_SSL_MODE inválido, e disable só com CI=true', () => {
    const noPem = { DATABASE_URL: DB_URL };
    for (const nodeEnv of [undefined, 'production', 'development', 'test']) expect(() => createFactoryPool({ ...noPem, ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}) }, { log: () => {} }), String(nodeEnv)).toThrow(/TLS exige/);
    expect(() => createFactoryPool({ ...noPem, DB_SSL_MODE: 'verify-full' }, { log: () => {} })).toThrow(/TLS exige/);
    expect(() => createFactoryPool({ DATABASE_URL: DB_URL, DB_SSL_CA_PEM: oneLine(CERT) }, { log: () => {} })).toThrow();
    expect(() => createFactoryPool({ ...TLS_ENV, DB_SSL_MODE: 'prefer' }, { log: () => {} })).toThrow(/DB_SSL_MODE inválido/);
    expect(() => createFactoryPool({ ...noPem, DB_SSL_MODE: 'disable' }, { log: () => {} })).toThrow(/só é permitido com CI=true/);
    expect(() => createFactoryPool({ DATABASE_URL: '' }, { log: () => {} })).toThrow(/DATABASE_URL ausente/);
    // única saída sem TLS: Postgres efêmero do CI, explicitamente
    expect(optsOf(createFactoryPool({ ...noPem, DB_SSL_MODE: 'disable', CI: 'true' }, { log: () => {} })).ssl).toBe(false);
  });

  it('PEM inválido é recusado ANTES de conectar, dizendo só qual variável falhou (nunca o conteúdo)', () => {
    const lines: string[] = [];
    const ruim = { ...TLS_ENV, DB_SSL_KEY_PEM: '-----BEGIN EC PRIVATE KEY-----\\nAAAA\\n-----END EC PRIVATE KEY-----' };
    expect(() => createFactoryPool(ruim, { log: (l) => lines.push(l) })).toThrow(/TLS inválido/);
    const saida = lines.join('\n');
    expect(saida).toContain('PROBLEMA');
    expect(saida).not.toMatch(/BEGIN|AAAA|MHcCAQEE/);
  });

  it("C1: o pool tem ouvinte de 'error' e o erro (com PEM e senha na mensagem) sai saneado, sem derrubar o processo", () => {
    const lines: string[] = [];
    const pool = createFactoryPool(TLS_ENV, { log: (l) => lines.push(l) });
    expect(pool.listenerCount('error')).toBeGreaterThanOrEqual(1);
    lines.length = 0;
    const e = Object.assign(new Error(`falha em postgres://u:segredo@db.example/ln ${KEY}`), { code: 'ECONNRESET', options: { key: KEY, cert: CERT } });
    expect(() => pool.emit('error', e)).not.toThrow();
    const saida = lines.join('\n');
    expect(saida).toContain('ECONNRESET');
    expect(saida).not.toMatch(/BEGIN|segredo|MHcCAQEE|FRvTDQpS4g/);
  });
});
