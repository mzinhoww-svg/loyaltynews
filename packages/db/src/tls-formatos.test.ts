import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describePem, normalizePem, pgSslFromEnv, selfCheckPemSet } from './tls';

// PEM REAL (certificado autoassinado e chave de TESTE, sem valor algum; gerados só para este arquivo) em todas as formas em que um painel de variáveis ou um
// executor de processos pode entregá-los. O que o worker de staging recebeu fez o OpenSSL responder "PEM routines::no start line": aqui cada forma
// tem de virar um PEM que o OpenSSL aceita, e o auto-diagnóstico tem de apontar QUAL variável quebrou, sem mostrar conteúdo.
const lf = (s: string) => s.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)); // o checkout pode trazer CRLF
const crt = lf(readFileSync(fileURLToPath(new URL('../fixtures/tls-teste.crt', import.meta.url)), 'utf8'));
const key = lf(readFileSync(fileURLToPath(new URL('../fixtures/tls-teste.key', import.meta.url)), 'utf8'));
const flatEscaped = (s: string) => s.trim().replace(/\n/g, '\\n');
const flatDoubleEscaped = (s: string) => s.trim().replace(/\n/g, '\\\\n'); // `\\n`: escapado duas vezes (painel + executor)
const flatQuotedEscaped = (s: string) => `"${s.trim().replace(/\n/g, '\\n')}"`;
const flatSpaces = (s: string) => s.trim().replace(/\n/g, ' ');
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const formas: Record<string, (s: string) => string> = {
  'multilinha (como deveria)': (s) => s,
  'CRLF': (s) => s.replace(/\n/g, '\r\n'),
  'uma linha com \n escapado': flatEscaped,
  'entre aspas': (s) => `"${s.trim()}"`,
  'achatado com ESPAÇOS no lugar das quebras': flatSpaces,
  'base64 do PEM inteiro': b64,
  'base64 com quebras': (s) => b64(s).replace(/(.{76})/g, '$1\n'),
  'espaços e quebras sobrando no começo e no fim': (s) => `\n  ${s}  \n\n`,
  'escapado duas vezes (\\\\n)': flatDoubleEscaped,
  'uma linha escapada e entre aspas': flatQuotedEscaped,
  'mistura de quebra real e \\n escapado': (s) => s.replace(/\n/g, (m, i: number) => (i % 2 === 0 ? '\\n' : m)),
};

describe('PEM real em todas as formas de entrega', () => {
  for (const [nome, f] of Object.entries(formas)) {
    it(`${nome}: normaliza para um PEM que o OpenSSL aceita (CA, certificado e chave)`, () => {
      const env = { DB_SSL_CA_PEM: f(crt), DB_SSL_CERT_PEM: f(crt), DB_SSL_KEY_PEM: f(key) };
      const r = selfCheckPemSet(env, 'DB_SSL');
      expect(r.lines.join('\n')).not.toMatch(/FALHA|AUSENTE|FALHOU/);
      expect(r.ok).toBe(true);
      const ssl = pgSslFromEnv({ ...env, NODE_ENV: 'production' });
      expect(ssl && ssl.cert.startsWith('-----BEGIN CERTIFICATE-----\n')).toBe(true);
      expect(ssl && ssl.key.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true);
    });
  }

  it('o resultado de toda forma é o MESMO PEM canônico (uma só forma chega ao TLS)', () => {
    const canon = normalizePem(crt);
    for (const [nome, f] of Object.entries(formas)) expect(normalizePem(f(crt)), nome).toBe(canon);
  });
});

describe('auto-diagnóstico dos PEM (sem abrir conexão, sem mostrar conteúdo)', () => {
  it('aponta a variável que quebrou, o código do erro e os fatos de formato; nunca o conteúdo', () => {
    const corpo = crt.split('\n')[1]!;
    const casos: Array<[string, Record<string, string>, RegExp]> = [
      ['só a primeira linha do certificado (corpo perdido)', { DB_SSL_CERT_PEM: '-----BEGIN CERTIFICATE-----' }, /DB_SSL_CERT_PEM: FALHA/],
      ['chave truncada (sem END)', { DB_SSL_KEY_PEM: key.slice(0, 400) }, /DB_SSL_KEY_PEM: FALHA/],
      ['CA que na verdade é outra coisa', { DB_SSL_CA_PEM: 'isto não é um certificado' }, /DB_SSL_CA_PEM: FALHA/],
      ['variável vazia', { DB_SSL_CA_PEM: '   ' }, /DB_SSL_CA_PEM: AUSENTE/],
      ['certificado e chave que NÃO formam par', { DB_SSL_KEY_PEM: readParOutro() }, /contexto TLS FALHOU/],
    ];
    for (const [nome, over, re] of casos) {
      const env = { DB_SSL_CA_PEM: crt, DB_SSL_CERT_PEM: crt, DB_SSL_KEY_PEM: key, ...over };
      const r = selfCheckPemSet(env, 'DB_SSL');
      expect(r.ok, nome).toBe(false);
      expect(r.lines.join('\n'), nome).toMatch(re);
      expect(r.lines.join('\n'), nome).not.toContain(corpo); // nunca o conteúdo
    }
  });

  it('describePem conta só estrutura (tamanho, linhas, BEGIN/END, CR, \n escapado, aspas, achatado com espaços)', () => {
    expect(describePem(crt)).toMatchObject({ begins: 1, ends: 1, hasCR: false, hasEscapedNewline: false, startsWithBegin: true, flattenedWithSpaces: false });
    expect(describePem(flatEscaped(crt))).toMatchObject({ lines: 1, hasEscapedNewline: true });
    expect(describePem(flatSpaces(crt))).toMatchObject({ lines: 1, flattenedWithSpaces: true });
    expect(describePem(`"${crt}"`)).toMatchObject({ hasQuotes: true });
    expect(describePem(undefined)).toMatchObject({ chars: 0, lines: 0 });
    expect(Object.values(describePem(crt)).every((v) => typeof v === 'number' || typeof v === 'boolean')).toBe(true); // nada de texto
  });
});

/** Uma chave privada válida que não é a do certificado de teste (gerada na hora com o próprio Node). */
function readParOutro(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- só neste teste
  const { generateKeyPairSync } = require('node:crypto') as typeof import('node:crypto');
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}
