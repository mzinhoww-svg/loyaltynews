import { describe, expect, it } from 'vitest';
import { sslConfigFromEnv } from './migrate';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
const KEY = '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----';

describe('migrate: política de TLS', () => {
  it('disable só no CI', () => {
    expect(sslConfigFromEnv({ DB_SSL_MODE: 'disable', CI: 'true' })).toBe(false);
    expect(() => sslConfigFromEnv({ DB_SSL_MODE: 'disable' })).toThrow(/CI=true/);
  });
  it('sem PEM, recusa', () => {
    expect(() => sslConfigFromEnv({})).toThrow(/DB_SSL_CA_PEM/);
    expect(() => sslConfigFromEnv({ DB_SSL_CA_PEM: PEM, DB_SSL_CERT_PEM: PEM })).toThrow();
  });
  it('com PEM, verifica o servidor e usa certificado de cliente', () => {
    expect(sslConfigFromEnv({ DB_SSL_CA_PEM: PEM, DB_SSL_CERT_PEM: PEM, DB_SSL_KEY_PEM: KEY })).toEqual({
      ca: PEM, cert: PEM, key: KEY, rejectUnauthorized: true,
    });
  });
  it('recusa modo desconhecido e valor que não é PEM', () => {
    expect(() => sslConfigFromEnv({ DB_SSL_MODE: 'prefer', DB_SSL_CA_PEM: PEM, DB_SSL_CERT_PEM: PEM, DB_SSL_KEY_PEM: KEY })).toThrow(/inválido/);
    expect(() => sslConfigFromEnv({ DB_SSL_CA_PEM: 'abc', DB_SSL_CERT_PEM: PEM, DB_SSL_KEY_PEM: KEY })).toThrow(/PEM/);
  });
});
