// Gera src/tokens/tokens.css e src/tokens/tokens.ts a partir de
// tokens/design.tokens.json (brandkit, literal) + tokens/extensions.json (derivados).
// Uso: npm run tokens   (os arquivos gerados são versionados; não editar à mão)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brand = JSON.parse(readFileSync(resolve(root, "tokens/design.tokens.json"), "utf8"));
const ext = JSON.parse(readFileSync(resolve(root, "tokens/extensions.json"), "utf8"));

const extColors = Object.fromEntries(Object.entries(ext.colors).map(([k, v]) => [k, v.value]));
const colors = { ...brand.colors, ...extColors };

const vars = [];
const add = (name, value) => vars.push([`--ln-${name}`, value]);

for (const [k, v] of Object.entries(colors)) add(`color-${k}`, v);
// UI: no CSS o token usa a variável injetada pelo next/font/local (nome real da família gerada); o JSON/TS guardam a família do brandkit.
add("font-ui", 'var(--ln-font-inter, "Inter Variable"), Inter, Arial, sans-serif');
add("font-editorial", brand.typography.editorial);
for (const [k, [size, lh]] of Object.entries(ext.fontSize)) {
  add(`text-${k}`, size);
  add(`leading-${k}`, lh);
}
for (const [k, v] of Object.entries(ext.fontWeight)) add(`weight-${k}`, v);
for (const [k, v] of Object.entries(ext.spacing)) add(`space-${k}`, v);
for (const [k, v] of Object.entries(ext.radius)) add(`radius-${k}`, v);
for (const [k, v] of Object.entries(ext.shadow)) add(`shadow-${k}`, v);
for (const [k, v] of Object.entries(ext.layout)) add(`layout-${k}`, v);
add("focus-width", ext.focus.width);
add("focus-offset", ext.focus.offset);
add("motion-fast", ext.motion.fast);
add("motion-easing", brand.motion.easing);
add("touch-target", ext.touchTarget);

// Papéis semânticos (referenciam os tokens acima).
const semantic = [
  ["bg", "var(--ln-color-white)"],
  ["bg-subtle", "var(--ln-color-mint)"],
  ["bg-inverse", "var(--ln-color-primary)"],
  ["fg", "var(--ln-color-black)"],
  ["fg-muted", "var(--ln-color-text-muted)"],
  ["fg-inverse", "var(--ln-color-white)"],
  ["fg-accent-inverse", "var(--ln-color-signal)"],
  ["link", "var(--ln-color-primary)"],
  ["accent", "var(--ln-color-secondary-strong)"],
  ["accent-decor", "var(--ln-color-secondary)"],
];
for (const [k, v] of semantic) add(`role-${k}`, v);

const header = `/* GERADO por scripts/build-tokens.mjs — não editar.
 * Fonte: tokens/design.tokens.json (brandkit ${brand.brand_version}, status "${brand.status}")
 * + tokens/extensions.json (derivados da frente 05; ver _nota). */\n`;

const css =
  header +
  `:root {\n${vars.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n\n` +
  `/* Breakpoints (media queries não aceitam var(); valores em tokens.ts):\n` +
  Object.entries(ext.breakpoints).map(([k, v]) => ` *   ${k} = ${v}`).join("\n") + `\n */\n`;

const ts =
  header.replace("/*", "/*").trimEnd() +
  `\n\nexport const meta = ${JSON.stringify({ brandVersion: brand.brand_version, status: brand.status }, null, 2)} as const;\n\n` +
  `export const brandColors = ${JSON.stringify(brand.colors, null, 2)} as const;\n\n` +
  `export const colors = ${JSON.stringify(colors, null, 2)} as const;\n\n` +
  `export const typography = ${JSON.stringify(brand.typography, null, 2)} as const;\n\n` +
  `export const fontSize = ${JSON.stringify(ext.fontSize, null, 2)} as const;\n\n` +
  `export const fontWeight = ${JSON.stringify(ext.fontWeight, null, 2)} as const;\n\n` +
  `export const spacing = ${JSON.stringify(ext.spacing, null, 2)} as const;\n\n` +
  `export const radius = ${JSON.stringify(ext.radius, null, 2)} as const;\n\n` +
  `export const breakpoints = ${JSON.stringify(ext.breakpoints, null, 2)} as const;\n\n` +
  `export const layout = ${JSON.stringify(ext.layout, null, 2)} as const;\n\n` +
  `export const motion = ${JSON.stringify(brand.motion, null, 2)} as const;\n\n` +
  `export const social = ${JSON.stringify(brand.social, null, 2)} as const;\n\n` +
  `/** Nome da CSS variable de um token: cssVar("color-primary") => "var(--ln-color-primary)". */\n` +
  `export const cssVar = (name: string): string => \`var(--ln-\${name})\`;\n`;

mkdirSync(resolve(root, "src/tokens"), { recursive: true });
writeFileSync(resolve(root, "src/tokens/tokens.css"), css);
writeFileSync(resolve(root, "src/tokens/tokens.ts"), ts);
console.log(`tokens: ${vars.length} CSS variables`);
