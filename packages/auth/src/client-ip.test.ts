import { describe, expect, it } from 'vitest';
import { clientIp, trustedProxyHops } from './client-ip';

const h = (xff?: string, real?: string) =>
  new Headers({ ...(xff ? { 'x-forwarded-for': xff } : {}), ...(real ? { 'x-real-ip': real } : {}) });

describe('IP do cliente com fronteira de proxy confiável', () => {
  it('sem proxy confiável configurado, cabeçalhos nunca valem', () => {
    expect(clientIp(h('1.2.3.4', '5.6.7.8'), 0)).toBeNull();
    expect(trustedProxyHops({})).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: 'abc' })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '-1' })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '11' })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '2' })).toBe(2);
  });
  it('com N proxies, vale a N-ésima entrada da direita; o que o cliente escreve à esquerda é ignorado', () => {
    expect(clientIp(h('9.9.9.9, 203.0.113.7'), 1)).toBe('203.0.113.7');
    expect(clientIp(h('6.6.6.6, 9.9.9.9, 203.0.113.7'), 1)).toBe('203.0.113.7');
    expect(clientIp(h('6.6.6.6, 203.0.113.7, 10.0.0.2'), 2)).toBe('203.0.113.7');
  });
  it('menos entradas que proxies, vazio, lixo e X-Real-IP isolado: null', () => {
    expect(clientIp(h('203.0.113.7'), 2)).toBeNull();
    expect(clientIp(h(), 1)).toBeNull();
    expect(clientIp(h('não-é-ip'), 1)).toBeNull();
    expect(clientIp(h(undefined, '5.6.7.8'), 1)).toBeNull();
  });
  it('aceita IPv6', () => {
    expect(clientIp(h('2001:DB8::1'), 1)).toBe('2001:db8::1');
  });
});
