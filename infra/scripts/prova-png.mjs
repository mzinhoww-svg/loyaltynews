#!/usr/bin/env node
// Prova que o `sharp` instalado FUNCIONA nesta plataforma: rasteriza um SVG pequeno (com texto) em PNG e confere assinatura, dimensões e tamanho.
// Existe porque o sharp é binário nativo por plataforma (@img/sharp-<os>-<cpu>): o `npm ci` do Windows não prova o Linux da Vertra.
// Rode DEPOIS do `npm ci` na plataforma-alvo (Linux): no ambiente da Vertra, num runner Linux de CI, ou onde houver Linux.
// Uso: node infra/scripts/prova-png.mjs [--root <checkout com node_modules>] [--saida <arquivo.png>]
//   --etapa <nome>: saída em UMA linha `[prova-png:<nome>] {json}` (para o log do build/start da Vertra, onde roda com `|| true`).
//   código 0 = PNG gerado e válido; 1 = o sharp carregou mas o PNG é inválido; 3 = sharp não instalado/não carrega nesta plataforma (mostra plataforma e o motivo, sem caminhos de usuário).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { platform, arch } from 'node:os';
import { parseArgs } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
const root = resolve(String(args.root && args.root !== true ? args.root : process.cwd()));
const etapa = args.etapa && args.etapa !== true ? String(args.etapa) : null;
const saida = (o) => console.log(etapa ? `[prova-png:${etapa}] ${JSON.stringify({ etapa, ...o })}` : JSON.stringify(o, null, 2));
const plat = `${platform()}-${arch()}`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#101820"/><circle cx="60" cy="90" r="36" fill="#f2aa4c"/><text x="120" y="102" font-family="sans-serif" font-size="32" fill="#ffffff">Loyalty</text></svg>';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let sharp;
try {
  const req = createRequire(join(root, 'package.json'));
  sharp = req('sharp');
} catch (e) {
  const motivo = String(e?.message ?? e).split('\n')[0].replace(/[A-Za-z]:\\[^\s'"]*|\/(?:home|Users|app)\/[^\s'"]*/g, '<caminho>').slice(0, 300);
  saida({ ok: false, plataforma: plat, node: process.version, erro: 'sharp não carrega nesta plataforma', motivo });
  process.exit(3);
}
try {
  const png = await sharp(Buffer.from(SVG)).png().toBuffer();
  const meta = await sharp(png).metadata();
  const problemas = [];
  if (!png.subarray(0, 8).equals(PNG_SIG)) problemas.push('assinatura PNG inválida');
  if (meta.format !== 'png' || meta.width !== 320 || meta.height !== 180) problemas.push(`dimensões/formato inesperados (${meta.format} ${meta.width}x${meta.height})`);
  if (png.length < 500) problemas.push(`PNG pequeno demais (${png.length} bytes)`);
  if (args.saida && args.saida !== true) writeFileSync(String(args.saida), png);
  saida({ ok: problemas.length === 0, plataforma: plat, node: process.version, sharp: sharp.versions?.sharp ?? null, vips: sharp.versions?.vips ?? null, bytes: png.length, largura: meta.width, altura: meta.height, problemas });
  process.exit(problemas.length ? 1 : 0);
} catch (e) {
  saida({ ok: false, plataforma: plat, erro: 'falha ao rasterizar', motivo: String(e?.message ?? e).split('\n')[0].slice(0, 300) });
  process.exit(1);
}
