import { describe, expect, it } from 'vitest';
import { GET } from '../health/route';
import { clientIp } from '@ln/auth';
import { diagXffEnabled, diagXffHeaders, xffCount, xffMatch } from './diag-xff';

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

describe('x-ln-xff-match (compara o XFF com CF-Connecting-IP; nenhum IP sai)', () => {
  const cf = (xff: string, ip: string) => new Headers({ 'x-forwarded-for': xff, 'cf-connecting-ip': ip });
  const MEDIDO = '203.0.113.9, 198.51.100.1, 10.0.0.2'; // 3 entradas, como no staging; o cliente é a mais à esquerda

  it('cenário medido no staging: N=3 ⇒ a 3ª da direita é o IP do cliente; posição 3; e clientIp com TRUSTED_PROXY_HOPS=3 devolve o mesmo', () => {
    const headers = cf(MEDIDO, '203.0.113.9');
    expect(xffMatch(headers, 3)).toEqual({ match: true, pos: 3 });
    expect(clientIp(headers, 3)).toBe('203.0.113.9');
    expect(xffMatch(headers, 2)).toEqual({ match: false, pos: 3 }); // N errado é visível
    expect(clientIp(headers, 2)).toBe('198.51.100.1');
  });
  it('IPv6 e caixa: comparação normalizada; IP do Cloudflare ausente do XFF ⇒ pos null', () => {
    expect(xffMatch(cf('2001:DB8::1, 10.0.0.2', '2001:db8::1'), 2)).toEqual({ match: true, pos: 2 });
    expect(xffMatch(cf('198.51.100.1, 10.0.0.2', '203.0.113.9'), 2)).toEqual({ match: false, pos: null });
  });
  it('sem TRUSTED_PROXY_HOPS ⇒ match null (na); menos entradas que N ⇒ false; sem CF-Connecting-IP (ou inválido) ⇒ null', () => {
    expect(xffMatch(cf(MEDIDO, '203.0.113.9'), 0)).toEqual({ match: null, pos: 3 });
    expect(xffMatch(cf('203.0.113.9', '203.0.113.9'), 3)).toEqual({ match: false, pos: 1 });
    expect(xffMatch(h(MEDIDO), 3)).toBeNull();
    expect(xffMatch(cf(MEDIDO, 'nao-e-ip'), 3)).toBeNull();
  });
  it('cabeçalhos: só com DIAG_XFF=1 fora de produção; true/false/na e posição; NENHUM IP no valor de nenhum cabeçalho', () => {
    const on = { DIAG_XFF: '1', APP_ENV: 'staging', TRUSTED_PROXY_HOPS: '3' };
    const r = diagXffHeaders(on, cf(MEDIDO, '203.0.113.9'));
    expect(r).toEqual({ 'x-ln-xff-count': '3', 'x-ln-xff-match': 'true', 'x-ln-xff-match-pos': '3' });
    expect(diagXffHeaders({ ...on, TRUSTED_PROXY_HOPS: '2' }, cf(MEDIDO, '203.0.113.9'))['x-ln-xff-match']).toBe('false');
    expect(diagXffHeaders({ DIAG_XFF: '1' }, cf(MEDIDO, '203.0.113.9'))).toEqual({ 'x-ln-xff-count': '3', 'x-ln-xff-match': 'na', 'x-ln-xff-match-pos': '3' });
    expect(diagXffHeaders({ ...on }, cf(MEDIDO, '9.9.9.9'))['x-ln-xff-match-pos']).toBe('none');
    for (const v of Object.values(r)) expect(v).not.toMatch(/\d+\.\d+\.\d+\.\d+|:/);
    expect(diagXffHeaders({ ...on, DIAG_XFF: '0' }, cf(MEDIDO, '203.0.113.9'))).toEqual({});
    expect(diagXffHeaders({ ...on, APP_ENV: 'production' }, cf(MEDIDO, '203.0.113.9'))).toEqual({});
    // sem CF-Connecting-IP: só a contagem, como antes
    expect(diagXffHeaders(on, h(MEDIDO))).toEqual({ 'x-ln-xff-count': '3' });
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
