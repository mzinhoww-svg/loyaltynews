// Gera src/formats.data.ts a partir de r0-preparacao/arquitetura/formatos-comerciais-47.json (fonte: Blueprint v2.0 §4).
// Uso: node scripts/gen-formats.mjs <caminho-do-json>
import { readFileSync, writeFileSync } from 'node:fs';
const src = process.argv[2];
const d = JSON.parse(readFileSync(src, 'utf8'));
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function parse(ref) {
  const r = ref.trim();
  if (/^verba/i.test(r)) return { priceType: 'verba_mais_taxa', fromBRL: null, unit: 'verba', feePct: 20 };
  const from = /^a partir de/i.test(r);
  const m = r.replace(/^a partir de\s*/i, '').match(/^([\d.]+)(?:\/(mês|dia))?$/);
  if (!m) throw new Error('referencia nao reconhecida: ' + ref);
  return { priceType: from ? 'a_partir_de' : 'fixo', fromBRL: Number(m[1].replace(/\./g, '')), unit: m[2] === 'mês' ? 'mes' : m[2] === 'dia' ? 'dia' : 'unidade', feePct: null };
}
const seen = new Set();
const rows = d.formatos.map((f, i) => {
  let id = `${slug(f.secao)}--${slug(f.produto)}`;
  if (seen.has(id)) throw new Error('id duplicado ' + id);
  seen.add(id);
  return { id, n: i + 1, section: f.secao, name: f.produto, referenceText: f.referencia_brl, scope: f.escopo, ...parse(f.referencia_brl), sourceLine: f.linha };
});
if (rows.length !== d.total) throw new Error('total divergente');
const out = `// GERADO por scripts/gen-formats.mjs — não editar à mão.
// Fonte: ${d.fonte} (sha256 ${d.fonte_sha256}). Preços são referência comercial, não promessa de audiência ou faturamento.
import type { FormatSeed } from './types.js';

export const FORMAT_SEEDS: readonly FormatSeed[] = ${JSON.stringify(rows, null, 2)};
`;
writeFileSync(new URL('../src/formats.data.ts', import.meta.url), out);
console.log('formatos:', rows.length);
