// Converte os SVGs oficiais do brandkit (assets/logo_*.svg, monogram_*.svg) em dados TS
// (src/components/logo-data.ts) para renderizar o Logo como SVG inline, sem <img> nem loader.
// Uso: node scripts/build-logo-data.mjs <pasta-assets-do-brandkit>
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2];
if (!dir) throw new Error("informe a pasta assets do brandkit extraído");

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const parse = (name) => {
  const svg = readFileSync(resolve(dir, name), "utf8");
  const vb = svg.match(/viewBox="([^"]+)"/)[1];
  const [, , w, h] = vb.split(" ").map(Number);
  const els = [...svg.matchAll(/<(path|rect)\s([^>]*?)\/>/g)].map((m) => ({ tag: m[1], ...attrs(m[2]) }));
  return { w, h, els };
};

const out = { logo: {}, monogram: {} };
const primary = parse("logo_primary.svg");
out.logo.paths = primary.els.map(({ d, transform }) => ({ d, transform }));
out.logo.size = [primary.w, primary.h];
out.logo.fills = {};
for (const v of ["primary", "reverse", "white", "monochrome"]) {
  out.logo.fills[v] = parse(`logo_${v}.svg`).els.map((e) => e.fill);
}
for (const v of ["dark", "light"]) {
  const m = parse(`monogram_${v}.svg`);
  out.monogram[v] = m.els.map(({ tag, ...rest }) => ({ tag, ...rest }));
  out.monogram.size = [m.w, m.h];
}

const body =
  `/* GERADO por scripts/build-logo-data.mjs a partir dos SVGs do brandkit — não editar. */\n` +
  `export const logoData = ${JSON.stringify(out.logo, null, 1)} as const;\n\n` +
  `export const monogramData = ${JSON.stringify(out.monogram, null, 1)} as const;\n`;
writeFileSync(resolve(root, "src/components/logo-data.ts"), body);
console.log("logo paths:", out.logo.paths.length, "fills:", Object.keys(out.logo.fills).join(","));
