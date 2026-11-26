// Gera os assets de marca do portal a partir das fontes OFICIAIS do brandkit já no repositório:
//   logo e monograma: packages/ui/src/components/logo-data.ts (gerado dos SVGs do brandkit)
//   ilustrações de contexto (viagem, varejo, pagamentos): packages/growth/src/creative/assets.data.ts
//   fonte: @fontsource/inter (OFL)
// Sem IA de imagem, sem rede, sem relógio: a mesma entrada produz os mesmos arquivos.
// Uso (na raiz do repositório): node apps/web/scripts/brand/gerar-assets.mjs [--folha apps/web/.brand-folha]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..', '..', '..', '..');
const web = join(raiz, 'apps', 'web');
const pub = join(web, 'public');
const app = join(web, 'app');
const req = createRequire(join(raiz, 'package.json'));
const sharp = req('sharp');
const { chromium } = req('playwright-core');
const { logoData, monogramData } = await import(pathToFileURL(join(raiz, 'packages/ui/src/components/logo-data.ts')).href);
const { CONTEXT_SVG } = await import(pathToFileURL(join(raiz, 'packages/growth/src/creative/assets.data.ts')).href);
const { EDITORIAS } = await import(pathToFileURL(join(raiz, 'packages/contracts/src/editorias.data.ts')).href);
const folhaIdx = process.argv.indexOf('--folha');
const folha = folhaIdx > 0 ? resolve(process.argv[folhaIdx + 1]) : null;

const COR = { primaria: '#153C3C', verde: '#34877A', menta: '#DDEFE8', sinal: '#A7DDC9', borda: '#B9D3CA', branco: '#FFFFFF' };
const mkdir = (p) => mkdirSync(p, { recursive: true });
const escreve = (p, c) => { mkdir(dirname(p)); writeFileSync(p, c); };
const num = (n) => String(Math.round(n * 100) / 100);

// --- logo e monograma (SVG) ---
const logoSvg = (variante, altura) => {
  const [w, h] = logoData.size;
  const f = logoData.fills[variante];
  const ps = logoData.paths.map((p, i) => `<path d="${p.d}" transform="${p.transform}" fill="${f[i]}"/>`).join('');
  const dim = altura ? ` width="${num((altura * w) / h)}" height="${altura}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"${dim} role="img" aria-label="Loyalty News">${ps}</svg>`;
};
const monoSvg = (variante, tamanho) => {
  const [w, h] = monogramData.size;
  const els = monogramData[variante].map((e) => (e.tag === 'rect' ? `<rect width="${e.width}" height="${e.height}" rx="${e.rx}" fill="${e.fill}"/>` : `<path d="${e.d}" transform="${e.transform}" fill="${e.fill}"/>`)).join('');
  const dim = tamanho ? ` width="${tamanho}" height="${tamanho}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"${dim} role="img" aria-label="Loyalty News">${els}</svg>`;
};
escreve(join(pub, 'brand', 'logo-sobre-claro.svg'), logoSvg('primary'));
escreve(join(pub, 'brand', 'logo-sobre-escuro.svg'), logoSvg('reverse'));
escreve(join(pub, 'brand', 'logo-monocromatico.svg'), logoSvg('monochrome'));
escreve(join(pub, 'brand', 'monograma-escuro.svg'), monoSvg('dark'));
escreve(join(pub, 'brand', 'monograma-claro.svg'), monoSvg('light'));
escreve(join(app, 'icon.svg'), monoSvg('dark'));

// --- placeholder de imagem de matéria (16:9, com a marca, sem texto) ---
const monoInterno = monogramData.dark.map((e) => (e.tag === 'rect' ? '' : `<path d="${e.d}" transform="${e.transform}" fill="${e.fill}"/>`)).join('');
const placeholder = (fundo, bloco, glifo) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" role="img" aria-label="Imagem da matéria indisponível"><rect width="1200" height="675" fill="${fundo}"/><circle cx="980" cy="120" r="260" fill="${COR.borda}" opacity=".35"/><circle cx="170" cy="640" r="200" fill="${COR.borda}" opacity=".25"/><g transform="translate(520 257.5) scale(1.0)"><rect width="160" height="160" rx="22" fill="${bloco}"/><g>${monoInterno.replace(/fill="[^"]+"/g, `fill="${glifo}"`)}</g></g></svg>`;
escreve(join(pub, 'brand', 'placeholder-materia.svg'), placeholder(COR.menta, COR.primaria, COR.branco));
escreve(join(pub, 'brand', 'placeholder-materia-escuro.svg'), placeholder(COR.primaria, COR.menta, COR.primaria));

// --- ícones das 10 editorias (24x24, traço de 2 px, currentColor) ---
const ICONES = {
  mercado: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>',
  programas: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  pontos: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v9M7.5 12h9"/>',   // moeda com "+": pontos que se acumulam (moedas empilhadas pareciam um banco de dados)
  bancos: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 15h4"/>',
  varejo: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  travel: '<path d="M3 14l8-2V5.5a1.5 1.5 0 0 1 3 0V12l7 2v2l-7-1.5V19l2 1.5V22l-3.5-1L10 22v-1.5l2-1.5v-4.5L3 16z"/>',
  tech: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  crm: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.2c2.8.2 4.5 2.2 4.5 5"/>',
  global: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
  regulacao: '<path d="M12 3l8 3v6c0 4.5-3.2 7.9-8 9-4.8-1.1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
};
const iconeSvg = (traco, cor = 'currentColor') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${traco}</svg>`;
for (const e of EDITORIAS) {
  if (!ICONES[e.slug]) throw new Error(`falta o ícone da editoria ${e.slug}`);
  escreve(join(pub, 'icones', 'editorias', `${e.slug}.svg`), iconeSvg(ICONES[e.slug]));
}

// --- PNG por navegador: fonte Inter embutida, texto sem depender de fonte instalada ---
const inter = (peso) => readFileSync(join(raiz, 'node_modules', '@fontsource', 'inter', 'files', `inter-latin-${peso}-normal.woff2`)).toString('base64');
const fontes = [600, 700, 800].map((p) => `@font-face{font-family:'InterOG';font-weight:${p};src:url(data:font/woff2;base64,${inter(p)}) format('woff2')}`).join('');
const ARTE = { viagem: CONTEXT_SVG.travel, varejo: CONTEXT_SVG.retail, pagamentos: CONTEXT_SVG.payments };
const ARTE_DA_EDITORIA = { travel: 'viagem', pontos: 'viagem', global: 'viagem', varejo: 'varejo', programas: 'varejo', crm: 'varejo', bancos: 'pagamentos', mercado: 'pagamentos', tech: 'pagamentos', regulacao: 'pagamentos' };
const FRASE = 'Inteligência para quem constrói o futuro da fidelidade.';
const ENDERECO = 'www.loyaltynews.com.br'; // URL canônica (DP-54), exibida no rodapé das imagens sociais
const arte = (svg, w, h) => svg.replace('<svg ', `<svg width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" `);

const cartaz = ({ w, h, kicker, titulo, tamanho, arteChave, quadrado }) => {
  const pad = quadrado ? 80 : 72;
  const larguraArte = quadrado ? w : 560;
  const alturaArte = quadrado ? Math.round(h * 0.46) : h;
  return `<html><head><style>${fontes}html,body{margin:0}*{box-sizing:border-box}
  .c{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${COR.primaria};font-family:'InterOG',Arial,sans-serif;color:${COR.branco}}
  .arte{position:absolute;${quadrado ? 'left:0;bottom:0' : 'right:0;top:0'};width:${larguraArte}px;height:${alturaArte}px}
  .arte::after{content:'';position:absolute;inset:0;background:${quadrado ? `linear-gradient(0deg,rgba(21,60,60,0) 55%,${COR.primaria} 100%)` : `linear-gradient(90deg,${COR.primaria} 0%,rgba(21,60,60,.55) 38%,rgba(21,60,60,0) 100%)`}}
  .logo{position:absolute;left:${pad}px;top:${pad - 8}px}
  .t{position:absolute;left:${pad}px;top:${quadrado ? 250 : 215}px;width:${quadrado ? w - pad * 2 : 640}px}
  .k{font-weight:700;font-size:22px;letter-spacing:.14em;text-transform:uppercase;color:${COR.sinal};margin:0 0 16px}
  .h{font-weight:800;font-size:${tamanho}px;line-height:1.08;margin:0;letter-spacing:-.01em}
  /* véu na base: garante o contraste do endereço sobre a arte clara (a quadrada tem a arte atrás do rodapé) */
  .veu{position:absolute;left:0;right:0;bottom:0;height:${quadrado ? 260 : 0}px;background:linear-gradient(0deg,${COR.primaria} 0%,${COR.primaria} 38%,rgba(21,60,60,0) 100%)}
  .rodape{position:absolute;left:${pad}px;bottom:${pad - 12}px;display:flex;align-items:center;gap:16px;font-weight:600;font-size:24px;color:${COR.sinal}}
  .rodape i{display:block;width:64px;height:6px;border-radius:3px;background:${COR.verde}}</style></head><body><div class="c">
  <div class="arte">${arte(ARTE[arteChave], larguraArte, alturaArte)}</div>
  <div class="logo">${logoSvg('reverse', 44)}</div>
  <div class="t">${kicker ? `<p class="k">${kicker}</p>` : ''}<p class="h">${titulo}</p></div>
  <div class="veu"></div>
  <div class="rodape"><i></i><span>${ENDERECO}</span></div></div></body></html>`;
};

const navegador = await chromium.launch();
const png = async (html, w, h, destino, opcoes = {}) => {
  const p = await navegador.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: opcoes.escala ?? 1 });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  const buf = await p.screenshot({ clip: { x: 0, y: 0, width: w, height: h }, omitBackground: Boolean(opcoes.transparente) });
  await p.close();
  mkdir(dirname(destino));
  const saida = await sharp(buf).png({ palette: opcoes.paleta ?? false, quality: 92, effort: 10, compressionLevel: 9 }).toBuffer();
  writeFileSync(destino, saida);
  return saida.length;
};
const pesos = {};

// Imagem de compartilhamento padrão (OG 1200x630) e quadrada (1080x1080, WhatsApp/Instagram)
pesos['og/padrao.png'] = await png(cartaz({ w: 1200, h: 630, titulo: FRASE, tamanho: 54, arteChave: 'pagamentos' }), 1200, 630, join(pub, 'og', 'padrao.png'), { paleta: true });
pesos['og/padrao-quadrada.png'] = await png(cartaz({ w: 1080, h: 1080, titulo: FRASE, tamanho: 64, arteChave: 'pagamentos', quadrado: true }), 1080, 1080, join(pub, 'og', 'padrao-quadrada.png'), { paleta: true });
// OG por editoria (1200x630)
for (const e of EDITORIAS) {
  const tam = e.nome.length > 22 ? 64 : 72;
  pesos[`og/editoria-${e.slug}.png`] = await png(cartaz({ w: 1200, h: 630, kicker: 'Editoria', titulo: e.nome.replace(/&/g, '&amp;'), tamanho: tam, arteChave: ARTE_DA_EDITORIA[e.slug] }), 1200, 630, join(pub, 'og', `editoria-${e.slug}.png`), { paleta: true });
}

// Ícones de app: apple-icon 180, PWA 192 e 512, maskable 512 (monograma com margem de segurança), favicon.ico com 16/32/48
const sobreTile = (v, t, margem = 0) => `<html><body style="margin:0;background:transparent"><div style="width:${t}px;height:${t}px;display:grid;place-items:center">${monoSvg(v, Math.round(t * (1 - margem * 2)))}</div></body></html>`;
pesos['app/apple-icon.png'] = await png(sobreTile('dark', 180), 180, 180, join(app, 'apple-icon.png'), { transparente: true });
pesos['brand/icon-192.png'] = await png(sobreTile('dark', 192), 192, 192, join(pub, 'brand', 'icon-192.png'), { transparente: true });
pesos['brand/icon-512.png'] = await png(sobreTile('dark', 512), 512, 512, join(pub, 'brand', 'icon-512.png'), { transparente: true });
const maskable = `<html><body style="margin:0;background:${COR.primaria}"><div style="width:512px;height:512px;display:grid;place-items:center;background:${COR.primaria}">${monoSvg('dark', 360)}</div></body></html>`;
pesos['brand/icon-maskable-512.png'] = await png(maskable, 512, 512, join(pub, 'brand', 'icon-maskable-512.png'));
const icoPng = [];
for (const t of [16, 32, 48]) {
  const p = await navegador.newPage({ viewport: { width: t, height: t } });
  await p.setContent(`<html><body style="margin:0;background:transparent">${monoSvg('dark', t)}</body></html>`);
  const buf = await p.screenshot({ clip: { x: 0, y: 0, width: t, height: t }, omitBackground: true });
  await p.close();
  icoPng.push({ t, buf: await sharp(buf).png({ compressionLevel: 9 }).toBuffer() });
}
const cab = Buffer.alloc(6 + icoPng.length * 16);
cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(icoPng.length, 4);
let deslocamento = cab.length;
icoPng.forEach(({ t, buf }, i) => {
  const o = 6 + i * 16;
  cab.writeUInt8(t, o); cab.writeUInt8(t, o + 1); cab.writeUInt8(0, o + 2); cab.writeUInt8(0, o + 3);
  cab.writeUInt16LE(1, o + 4); cab.writeUInt16LE(32, o + 6); cab.writeUInt32LE(buf.length, o + 8); cab.writeUInt32LE(deslocamento, o + 12);
  deslocamento += buf.length;
});
const ico = Buffer.concat([cab, ...icoPng.map((x) => x.buf)]);
writeFileSync(join(app, 'favicon.ico'), ico);
pesos['app/favicon.ico'] = ico.length;

// Manifesto do site (ícones e cor do tema); o portal aponta para ele em metadata.manifest
escreve(join(pub, 'site.webmanifest'), JSON.stringify({
  name: 'Loyalty News', short_name: 'Loyalty News', description: 'Portal de inteligência sobre fidelização.', lang: 'pt-BR', start_url: '/', scope: '/', display: 'browser',
  background_color: COR.branco, theme_color: COR.primaria,
  icons: [
    { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2) + '\n');

// Folha de contato (conferência humana; não vai para o app)
if (folha) {
  mkdir(folha);
  const cel = (svg, nome) => `<div style="display:inline-block;width:170px;margin:8px;text-align:center;font:12px sans-serif;color:#153c3c"><div style="width:64px;height:64px;margin:0 auto 6px;color:#153c3c">${svg.replace('width="24" height="24"', 'width="64" height="64"')}</div>${nome}</div>`;
  const html = `<html><body style="margin:16px;background:#fff;font-family:sans-serif"><h3 style="color:#153c3c">Ícones das 10 editorias</h3>${EDITORIAS.map((e) => cel(iconeSvg(ICONES[e.slug]), e.nome)).join('')}
  <h3 style="color:#153c3c">Logo e monograma</h3><div style="display:flex;gap:16px;align-items:center"><div style="background:#fff;border:1px solid #ccc;padding:16px">${logoSvg('primary', 44)}</div><div style="background:#153c3c;padding:16px">${logoSvg('reverse', 44)}</div><div>${monoSvg('dark', 64)}</div><div>${monoSvg('light', 64)}</div></div>
  <h3 style="color:#153c3c">Placeholders</h3><div style="display:flex;gap:16px"><div style="width:320px">${placeholder(COR.menta, COR.primaria, COR.branco)}</div><div style="width:320px">${placeholder(COR.primaria, COR.menta, COR.primaria)}</div></div></body></html>`;
  await png(html, 980, 640, join(folha, 'folha-de-contato.png'));
}
await navegador.close();
console.log(JSON.stringify(pesos, null, 1));
