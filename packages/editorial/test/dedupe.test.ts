import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Deduper, canonicalUrl, clusterItems, jaccard, shingles } from '../src/dedupe/dedupe.ts';

const A = 'O Programa Alfa (MOCK) anunciou parceria com a Varejista Beta para acúmulo de 2 pontos por real gasto a partir de dezembro de 2026.';
const A2 = 'Programa Alfa (MOCK) anunciou uma parceria com a Varejista Beta para acúmulo de 2 pontos por real gasto, a partir de dezembro de 2026.';
const B = 'Banco Gama (MOCK) lançou cartão com anuidade zero e cashback de 1% em supermercados para clientes de alta renda.';

test('canonicalUrl remove rastreio, fragmento, barra final e ordena query', () => {
  assert.equal(canonicalUrl('HTTPS://Ri.Mock.Example:443/a/b/?utm_source=x&z=2&a=1#frag'), 'https://ri.mock.example/a/b?a=1&z=2');
});

test('dedupe: mesma URL canônica, mesmo hash e similaridade lexical', () => {
  const d = new Deduper(0.6);
  assert.equal(d.add({ id: '1', url: 'https://x.example/a', title: 't', text: A }), null);
  assert.equal(d.add({ id: '2', url: 'https://x.example/a/?utm_medium=z', title: 'outro', text: B })?.reason, 'same_url');
  assert.equal(d.add({ id: '3', url: 'https://x.example/c', title: 't', text: A })?.reason, 'same_hash');
  const sim = d.add({ id: '4', url: 'https://x.example/d', title: 't', text: A2 });
  assert.equal(sim?.reason, 'similar');
  assert.equal(sim?.of, '1');
  assert.equal(d.add({ id: '5', url: 'https://x.example/e', title: 'cartão', text: B }), null);
});

test('clusters mantêm o primeiro como representante', () => {
  const { clusters, matches } = clusterItems([
    { id: 'a', url: 'https://x.example/1', title: 't', text: A },
    { id: 'b', url: 'https://x.example/2', title: 't', text: A2 },
    { id: 'c', url: 'https://x.example/3', title: 'u', text: B },
  ]);
  assert.deepEqual(clusters.get('a'), ['a', 'b']);
  assert.deepEqual(clusters.get('c'), ['c']);
  assert.equal(matches.length, 1);
});

test('jaccard: textos disjuntos ~0, idênticos 1', () => {
  assert.equal(jaccard(shingles(A), shingles(A)), 1);
  assert.ok(jaccard(shingles(A), shingles(B)) < 0.1);
});
