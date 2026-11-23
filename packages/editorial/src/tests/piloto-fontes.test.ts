import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEED_SOURCES } from '../sources/seed';
import { eligibility } from '../sources/registry';

// Dossiê das fontes do piloto (docs/piloto-fontes.md + .data.json): coerente com o cadastro e com o dossiê de termos.
interface Entrada {
  id: string; classe: 'A' | 'B' | 'C' | 'D' | 'E'; urlListagem: string; feed: string | null; sitemap: string | null;
  termos: Array<{ tipo: string; url: string; lidoEm: string }>; trechosLiterais: string[];
  permitidoColetar: string; permitidoReproduzir: string; restricoes: string;
  frequencia: { rodadasPorDia: number; materiasPorRodada: number; reqPorHora: number; espacamentoSeg: number };
  status: { cadastro: string; recomendacaoEditorial: 'habilitar' | 'recusar'; habilitacaoHumana: string; motivo: string };
  notaDeRevisaoSugerida: string | null;
}
const data = JSON.parse(readFileSync(new URL('../../docs/piloto-fontes.data.json', import.meta.url), 'utf8')) as { fontes: Entrada[]; regraGeral: Record<string, string> };
const dossie = readFileSync(new URL('../../docs/termos-fontes.md', import.meta.url), 'utf8');
const reg = new Map(SEED_SOURCES.map((s) => [s.id, s]));

test('cada fonte do piloto existe no cadastro, com os mesmos endereços e desabilitada (a habilitação é humana)', () => {
  assert.ok(data.fontes.length >= 5);
  for (const e of data.fontes) {
    const s = reg.get(e.id)!;
    assert.ok(s, `${e.id} no cadastro`);
    assert.equal(e.urlListagem, s.listingUrl, `${e.id}: listagem`);
    assert.equal(e.feed, s.feedUrl, `${e.id}: feed`);
    assert.equal(e.sitemap, s.sitemapUrl ?? null, `${e.id}: sitemap`);
    assert.equal(s.enabled, false, `${e.id}: cadastro nasce desabilitado`); assert.equal(eligibility(s).ok, false, e.id);
    assert.equal(e.status.cadastro, 'desabilitada');
    assert.equal(e.frequencia.reqPorHora, s.maxRequestsPerHour, `${e.id}: limite por hora do cadastro`);
    assert.ok(e.frequencia.espacamentoSeg >= 3, `${e.id}: espaçamento mínimo do coletor`);
    assert.ok(e.frequencia.rodadasPorDia <= 1);
  }
});

test('classe do dossiê de termos, termos lidos (link http(s) e data), trechos literais do dossiê e notas de revisão', () => {
  for (const e of data.fontes) {
    assert.match(dossie, new RegExp(`Classe ${e.classe} [^\\n]*fontes cadastradas: [^\\n]*\\b${e.id}\\b`), `${e.id}: classe ${e.classe} no dossiê`);
    for (const t of e.termos) { assert.match(t.url, /^https:\/\//); assert.match(t.lidoEm, /^2026-11-\d{2}$/); }
    if (e.classe === 'A') {
      assert.ok(e.termos.length >= 1 && e.trechosLiterais.length >= 2, `${e.id}: classe A cita o termo lido`);
      for (const q of e.trechosLiterais) assert.ok(dossie.includes(q.replace(/"/g, '"')) || dossie.includes(q.replace(/\\"/g, '"')), `${e.id}: trecho literal está no dossiê: ${q.slice(0, 50)}`);
      assert.equal(e.termos[0]!.url, reg.get(e.id)!.termsUrl, `${e.id}: termo = termsUrl do cadastro`);
    }
    assert.ok(e.permitidoColetar.length > 40 && e.permitidoReproduzir.length > 40 && e.restricoes.length > 20, e.id);
    assert.ok(e.status.motivo.length >= 30, `${e.id}: motivo`);
    if (e.status.recomendacaoEditorial === 'habilitar') assert.match(e.notaDeRevisaoSugerida ?? '', /DP-28/, `${e.id}: nota cita a DP-28 e ≥ 20 caracteres`);
    else assert.equal(e.notaDeRevisaoSugerida, null);
  }
});

test('piloto: Senado e Câmara + 3 fontes classe D recomendadas; recusadas têm motivo e nenhuma de classe C/E entra', () => {
  const hab = data.fontes.filter((e) => e.status.recomendacaoEditorial === 'habilitar');
  assert.deepEqual(hab.filter((e) => e.classe === 'A').map((e) => e.id), ['senado-noticias', 'camara-noticias']);
  assert.equal(hab.filter((e) => e.classe === 'D').length, 3);
  assert.ok(hab.every((e) => e.classe === 'A' || e.classe === 'D'), 'classe C e E ficam fora');
  const rec = data.fontes.filter((e) => e.status.recomendacaoEditorial === 'recusar');
  assert.deepEqual(rec.map((e) => e.id), ['febraban']);
  assert.match(rec[0]!.status.motivo, /sem feed nem sitemap/);
  const febraban = reg.get('febraban')!; assert.ok(!febraban.feedUrl && !febraban.sitemapUrl, 'recusada porque não é coletável');
  for (const e of hab) { assert.ok(e.feed || e.sitemap, `${e.id}: coletável (feed ou sitemap)`); assert.ok(e.frequencia.materiasPorRodada >= 1); }
  assert.match(data.regraGeral['habilitacao']!, /pessoa diferente da pesquisadora/);
});
