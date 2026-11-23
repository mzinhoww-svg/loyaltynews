// Embute as fontes Inter (OFL-1.1, subconjunto latino em WOFF) e o logo azul-escuro em src/creative/social-assets.data.ts.
// Motivo: os cartões sociais convertem o texto em CURVAS (sem <text>), então a arte e o PNG não dependem de fonte instalada
// no servidor, e o módulo roda no Next e no navegador sem fs. Uso: node scripts/embed-fonts.mjs
// As fontes vêm de @fontsource/inter (devDependency, versão exata); o texto da licença é copiado para assets/fonts/.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@fontsource/inter/package.json'));
const out = new URL('../assets/fonts/', import.meta.url);
mkdirSync(out, { recursive: true });

const WEIGHTS = [400, 600, 700];
const b64 = {};
for (const w of WEIGHTS) {
  const src = join(pkgDir, 'files', `inter-latin-${w}-normal.woff`);
  copyFileSync(src, new URL(`Inter-latin-${w}.woff`, out));
  b64[w] = readFileSync(src).toString('base64');
}
copyFileSync(join(pkgDir, 'LICENSE'), new URL('OFL-1.1-Inter.txt', out));

const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const logoPrimary = readFileSync(new URL('../assets/logo_primary.svg', import.meta.url), 'utf8');
const lines = [
  `// GERADO por scripts/embed-fonts.mjs (Inter ${version}, OFL-1.1, subconjunto latino; logo do brandkit 2.0-draft.1). Não edite.`,
  `export const INTER_VERSION = ${JSON.stringify(version)};`,
  `export const INTER_WOFF_B64 = {`,
  ...WEIGHTS.map((w) => `  ${w}: ${JSON.stringify(b64[w])},`),
  `} as const;`,
  `export const LOGO_PRIMARY_SVG = ${JSON.stringify(logoPrimary)};`,
  '',
];
writeFileSync(new URL('../src/creative/social-assets.data.ts', import.meta.url), lines.join('\n'));
console.log('social-assets.data.ts gerado (Inter', version + ')');
