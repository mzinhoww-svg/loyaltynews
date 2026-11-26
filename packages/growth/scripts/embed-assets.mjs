// Gera src/creative/assets.data.ts a partir de assets/ (cópia do brandkit). Mantém o criativo sem fs/Buffer,
// para rodar no servidor do Next e no navegador. Uso: node scripts/embed-assets.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../assets/', import.meta.url);
const read = (n) => readFileSync(new URL(n, dir), 'utf8');
const tokens = JSON.parse(read('design.tokens.json'));
const out = [
  `// GERADO por scripts/embed-assets.mjs a partir de assets/ (brandkit ${tokens.brand_version}, ${tokens.status}). Não edite.`,
  `export const TOKENS_JSON = ${JSON.stringify(tokens, null, 2)} as const;`,
  `export const LOGO_WHITE_SVG = ${JSON.stringify(read('logo_white.svg'))};`,
  `export const CONTEXT_SVG = {`,
  ...['travel', 'retail', 'payments'].map((k) => `  ${k}: ${JSON.stringify(read(`${k}_context.svg`))},`),
  `} as const;`,
  '',
].join('\n');
writeFileSync(new URL('../src/creative/assets.data.ts', import.meta.url), out);
console.log('assets.data.ts gerado');
