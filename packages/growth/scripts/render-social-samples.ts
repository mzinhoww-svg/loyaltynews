// Gera amostras dos cards sociais (SVG + PNG) em out/social-samples/ a partir de dados FICTÍCIOS. Não publica nada.
// Uso: npx tsx packages/growth/scripts/render-social-samples.ts  (a pasta out/ não é versionada)
import { mkdirSync, writeFileSync } from 'node:fs';
import { MOCK_ARTICLE } from '../fixtures/article.mock';
import { rasterizeCreative } from '../src/creative/raster';
import { renderSocialCard, type SocialCardFormat, type SocialCardInput } from '../src/creative/social-cards';

const out = new URL('../out/social-samples/', import.meta.url);
mkdirSync(out, { recursive: true });

// Exemplos fictícios (empresas e números inventados; nada aqui é notícia real).
const real: SocialCardInput = {
  id: 'AMOSTRA-1',
  title: 'Programa Alfa oferece bônus de 100% em transferências até 15 de dezembro',
  deck: 'O comunicado não informa se o bônus vale para todos os clientes nem se haverá prorrogação.',
  editoria: 'Pontos & Milhas',
  url: 'https://example.invalid/amostra-1',
  facts: [{ text: 'Dado fictício.', source: 'fixture://amostra' }],
  gatesPassed: true,
};
const longo: SocialCardInput = {
  ...real,
  id: 'AMOSTRA-2',
  title: 'Cartão Gama passa a oferecer 1,5 ponto por dólar gasto a partir de janeiro, informou o banco; a anuidade não mudou',
  editoria: 'Bancos & Cartões',
};
const patrocinado: SocialCardInput = { ...real, id: 'AMOSTRA-3', editoria: 'Varejo & Cashback', sponsored: { label: 'Conteúdo patrocinado' } };
const analise: SocialCardInput = {
  ...real,
  id: 'AMOSTRA-4',
  title: 'O que os regulamentos de transferência bonificada dizem, e o que não dizem, sobre prazo e elegibilidade',
  deck: 'Análise a partir de páginas oficiais; a leitura da redação vem rotulada.',
  editoria: 'Regulação & Dados',
  autoral: { formato: 'analise' },
};
const explicador: SocialCardInput = { ...analise, id: 'AMOSTRA-5', title: 'Como funciona a validade de pontos em programas de varejo', editoria: 'Varejo & Cashback', deck: undefined, autoral: { formato: 'explicador' } };
const comparativo: SocialCardInput = { ...analise, id: 'AMOSTRA-6', title: 'Três programas de milhas e suas regras de expiração, lado a lado', editoria: 'Travel & Hospitality', autoral: { formato: 'comparativo' } };

const cases: Array<[string, SocialCardInput, SocialCardFormat]> = [];
for (const f of ['linkedin_landscape', 'square'] as SocialCardFormat[]) {
  cases.push([`materia-${f}`, real, f], [`materia-longa-${f}`, longo, f], [`materia-patrocinada-${f}`, patrocinado, f], [`materia-mock-${f}`, MOCK_ARTICLE, f]);
  cases.push([`analise-${f}`, analise, f], [`explicador-${f}`, explicador, f], [`comparativo-${f}`, comparativo, f]);
  cases.push([`analise-mock-${f}`, { ...analise, mock: true }, f]);
}
for (const [name, art, format] of cases) {
  const card = renderSocialCard(art, { format });
  writeFileSync(new URL(`${name}.svg`, out), card.svg);
  const r = await rasterizeCreative(card);
  writeFileSync(new URL(`${name}.png`, out), r.png);
  console.log(name.padEnd(34), `${r.width}x${r.height}`, `${(r.sizeBytes / 1024).toFixed(0)} KB`, r.filename);
}
