import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { renderPost } from '../creative/post';
import { RasterRefusal, rasterizeCreative, rasterPixelSha256, slugify, type RasterAsset } from '../creative/raster';
import { renderSocialCard, type SocialCardFormat, type SocialCardInput } from '../creative/social-cards';
import type { CreativeAsset } from '../types';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

// Exemplos FICTÍCIOS. O rasterizador é puro (sem rede, sem relógio, sem fonte do sistema).
const MATERIA: SocialCardInput = {
  id: 'R-1',
  title: 'Programa Alfa oferece bônus de 100% em transferências até 15 de dezembro',
  deck: 'O comunicado não informa se o bônus vale para todos os clientes.',
  editoria: 'Pontos & Milhas',
  url: 'https://example.invalid/r-1',
  facts: [{ text: 'Dado fictício.', source: 'fixture://r' }],
  gatesPassed: true,
};
const ANALISE: SocialCardInput = { ...MATERIA, id: 'R-2', title: 'O que os regulamentos dizem sobre prazo de transferência', editoria: 'Regulação & Dados', autoral: { formato: 'comparativo' } };
const FORMATS: SocialCardFormat[] = ['linkedin_landscape', 'square'];
const sha = (d: string | Uint8Array) => createHash('sha256').update(d).digest('hex');
const refusal = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
  } catch (e) {
    return e instanceof RasterRefusal ? e.rule : `outro:${String(e)}`;
  }
  return undefined;
};
async function pixel(r: RasterAsset, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(Buffer.from(r.png)).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

test('PNG: tamanho exato, RGB opaco (sem transparência), contrato do uploader', async () => {
  for (const f of FORMATS) {
    for (const a of [MATERIA, ANALISE, MOCK_ARTICLE]) {
      const card = renderSocialCard(a, { format: f });
      const r = await rasterizeCreative(card);
      const meta = await sharp(Buffer.from(r.png)).metadata();
      assert.equal(meta.format, 'png');
      assert.deepEqual([meta.width, meta.height], [card.width, card.height]);
      assert.deepEqual([r.width, r.height], [card.width, card.height]);
      assert.equal(meta.hasAlpha, false);
      assert.equal(meta.channels, 3);
      assert.equal(meta.depth, 'uchar');
      assert.equal(r.mimeType, 'image/png');
      assert.equal(r.sizeBytes, r.png.byteLength);
      assert.equal(r.sha256, sha(r.png));
      assert.equal(r.svgSha256, sha(card.svg));
      assert.match(r.filename, /^[a-z0-9-]+\.png$/);
      assert.ok(r.filename.length <= 200);
      assert.ok(r.filename.includes(`${card.width}x${card.height}`));
      assert.ok(r.sizeBytes > 5_000 && r.sizeBytes < 400_000, `peso ${r.sizeBytes}`);
      assert.ok(r.altText.length > 20 && r.altText.includes('Loyalty News'));
      assert.equal(r.brandStatus, card.brandStatus);
      assert.equal(r.mock, card.mock);
      // assinatura de PNG
      assert.deepEqual(Array.from(r.png.slice(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  }
});

test('PNG: determinístico (mesma entrada = mesmos pixels e, na mesma plataforma, mesmos bytes)', async () => {
  for (const f of FORMATS) {
    const card = renderSocialCard(MATERIA, { format: f });
    const a = await rasterizeCreative(card);
    const b = await rasterizeCreative(card);
    assert.equal(await rasterPixelSha256(a.png), await rasterPixelSha256(b.png));
    assert.equal(a.sha256, b.sha256);
    assert.equal(a.svgSha256, b.svgSha256);
    assert.equal(a.filename, b.filename);
  }
});

test('PNG: entrada diferente muda svgSha256, nome e pixels; materia e análise não se confundem', async () => {
  const a = await rasterizeCreative(renderSocialCard(MATERIA));
  const b = await rasterizeCreative(renderSocialCard({ ...MATERIA, title: 'Programa Alfa oferece bônus de 100% em transferências até 20 de dezembro' }));
  const c = await rasterizeCreative(renderSocialCard(ANALISE));
  assert.notEqual(a.svgSha256, b.svgSha256);
  assert.notEqual(a.filename, b.filename);
  assert.notEqual(await rasterPixelSha256(a.png), await rasterPixelSha256(b.png));
  assert.ok(a.filename.startsWith('ln-materia-') && c.filename.startsWith('ln-analise-'));
  assert.ok(c.altText.includes('autoral') && !a.altText.includes('autoral'));
});

test('PNG: cores do brandkit nos pixels (matéria = primário #153C3C; análise = menta #DDEFE8)', async () => {
  const m = await rasterizeCreative(renderSocialCard(MATERIA));
  const a = await rasterizeCreative(renderSocialCard(ANALISE));
  assert.deepEqual(await pixel(m, 4, 4), [0x15, 0x3c, 0x3c]);
  assert.deepEqual(await pixel(a, 4, 4), [0xdd, 0xef, 0xe8]);
  // margem esquerda da área de texto fica limpa (nada de texto vazando para fora da área segura)
  for (const r of [m, a]) for (const y of [150, 250, 350, 450]) assert.deepEqual(await pixel(r, 20, y), await pixel(r, 4, 4));
});

test('PNG: nome de arquivo ASCII mesmo com acentos, e o texto alternativo é o <desc> do SVG', async () => {
  const r = await rasterizeCreative(renderSocialCard({ ...MATERIA, title: 'Cartão Gama: “1,5 ponto” por dólar — ação & atenção' }));
  assert.match(r.filename, /^ln-materia-cartao-gama-1-5-ponto-por-dolar-acao-atencao-1200x627-[0-9a-f]{8}\.png$/);
  assert.ok(r.altText.includes('Cartão Gama') && r.altText.includes('& atenção'), r.altText);
  assert.equal(slugify('Ação — Çá & Ñ'), 'acao-ca-n');
});

test('rasterização recusa SVG que depende de fonte, rede ou script (determinismo e segurança)', async () => {
  // o criativo antigo (renderPost) usa <text>: o resultado dependeria da fonte instalada
  assert.equal(await refusal(rasterizeCreative(renderPost(MOCK_ARTICLE))), 'svg_com_texto');
  const card = renderSocialCard(MATERIA);
  const base: CreativeAsset = card;
  assert.equal(await refusal(rasterizeCreative({ ...base, svg: base.svg.replace('</svg>', '<script>1</script></svg>') })), 'svg_ativo');
  assert.equal(await refusal(rasterizeCreative({ ...base, svg: base.svg.replace('</svg>', '<image href="https://example.invalid/x.png" width="10" height="10"/></svg>') })), 'svg_recurso_externo');
  assert.equal(await refusal(rasterizeCreative({ ...base, width: 1000 })), 'dimensao_divergente');
  assert.equal(await refusal(rasterizeCreative({ ...base, svg: base.svg.replace(/<desc>[\s\S]*?<\/desc>/, '').replace(/<title>[\s\S]*?<\/title>/, '') })), 'sem_texto_alternativo');
});
