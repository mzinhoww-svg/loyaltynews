import { describe, expect, it } from 'vitest';
import { GET } from '../health/route';
import { diagXffEnabled, diagXffHeaders, xffCount } from './diag-xff';

const h = (xff?: string) => new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff });

describe('xffCount', () => {
  it('ausente = 0; uma, várias, com espaços e com entradas vazias', () => {
    expect(xffCount(h())).toBe(0);
    expect(xffCount(h(''))).toBe(0);
    expect(xffCount(h('203.0.113.9'))).toBe(1);
    expect(xffCount(h('203.0.113.9, 198.51.100.1, 10.0.0.2'))).toBe(3);
    expect(xffCount(h('  203.0.113.9 ,   198.51.100.1  '))).toBe(2);
    expect(xffCount(h(',, 203.0.113.9 ,, ,'))).toBe(1);
    expect(xffCount(h(' , ,'))).toBe(0);
  });
});

describe('flag DIAG_XFF', () => {
  it('desligada por padrão: sem DIAG_XFF ou com valor diferente de "1", nenhum cabeçalho', () => {
    for (const env of [{}, { DIAG_XFF: '' }, { DIAG_XFF: '0' }, { DIAG_XFF: 'true' }, { DIAG_XFF: 'yes' }, { APP_ENV: 'homologacao' }]) {
      expect(diagXffEnabled(env)).toBe(false);
      expect(diagXffHeaders(env, h('1.2.3.4'))).toEqual({});
    }
  });
  it('ligada fora de produção: só x-ln-xff-count', () => {
    for (const env of [{ DIAG_XFF: '1' }, { DIAG_XFF: '1', APP_ENV: 'homologacao' }, { DIAG_XFF: '1', APP_ENV: 'staging' }]) {
      expect(diagXffHeaders(env, h('203.0.113.9, 198.51.100.1'))).toEqual({ 'x-ln-xff-count': '2' });
    }
    expect(diagXffHeaders({ DIAG_XFF: '1' }, h())).toEqual({ 'x-ln-xff-count': '0' });
  });
  it('em produção a flag é ignorada (qualquer grafia)', () => {
    for (const app of ['production', 'producao', 'produção', 'PRODUCAO', ' Production ', 'prod']) {
      expect(diagXffEnabled({ DIAG_XFF: '1', APP_ENV: app })).toBe(false);
      expect(diagXffHeaders({ DIAG_XFF: '1', APP_ENV: app }, h('1.2.3.4'))).toEqual({});
    }
  });
});

describe('/api/health', () => {
  const call = async (env: Record<string, string>, xff?: string) => {
    const old = { ...process.env };
    Object.assign(process.env, env);
    try {
      const req = new Request('http://localhost/api/health', { headers: xff ? { 'x-forwarded-for': xff } : {} });
      const res = GET(req);
      return { status: res.status, headers: res.headers, body: await res.text() };
    } finally {
      for (const k of Object.keys(env)) if (k in old) process.env[k] = old[k]; else delete process.env[k];
    }
  };

  it('flag desligada: sem cabeçalho; corpo e status de sempre', async () => {
    const r = await call({}, '203.0.113.9');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-ln-xff-count')).toBeNull();
    expect(JSON.parse(r.body)).toMatchObject({ status: 'ok', service: 'loyaltynews-web' });
  });
  it('flag ligada: cabeçalho com a contagem e nenhum IP no cabeçalho nem no corpo', async () => {
    const r = await call({ DIAG_XFF: '1', APP_ENV: 'homologacao' }, '203.0.113.9, 198.51.100.77');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-ln-xff-count')).toBe('2');
    const everything = r.body + JSON.stringify([...r.headers.entries()]);
    expect(everything).not.toContain('203.0.113.9');
    expect(everything).not.toContain('198.51.100.77');
  });
  it('produção: sem cabeçalho mesmo com a flag', async () => {
    const r = await call({ DIAG_XFF: '1', APP_ENV: 'producao' }, '203.0.113.9');
    expect(r.headers.get('x-ln-xff-count')).toBeNull();
    expect(r.status).toBe(200);
  });
});
