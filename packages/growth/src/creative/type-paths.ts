import * as opentype from 'opentype.js';
import { INTER_WOFF_B64 } from './social-assets.data';

// Texto → curvas SVG, com a Inter embutida (OFL-1.1). Por quê: um <text> depende da fonte instalada em quem renderiza
// (servidor Linux, navegador, rasterizador), então o mesmo criativo sai diferente em cada lugar e a quebra de linha, medida
// por estimativa, erra. Aqui a medida é a real (avanço de glifo + kerning da própria fonte) e o desenho é só geometria:
// mesma entrada, mesmo SVG, em qualquer máquina. Roda no Node e no navegador (sem fs).

export type Weight = 400 | 600 | 700;

const cache = new Map<Weight, opentype.Font>();

function decode(b64: string): ArrayBuffer {
  // atob existe no Node ≥ 16 e no navegador.
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function font(weight: Weight): opentype.Font {
  let f = cache.get(weight);
  if (!f) {
    f = opentype.parse(decode(INTER_WOFF_B64[weight]));
    cache.set(weight, f);
  }
  return f;
}

export interface TypeOpts {
  weight: Weight;
  /** Espaçamento entre letras em milésimos de em (ex.: -20 = -0,02 em). */
  tracking?: number;
}

/** Largura real do texto, em px, com kerning da fonte. Não inclui o espaçamento depois da última letra. */
export function measure(text: string, size: number, o: TypeOpts): number {
  const tr = o.tracking ?? 0;
  const w = font(o.weight).getAdvanceWidth(text, size, { kerning: true, tracking: tr });
  // opentype soma o tracking depois de CADA glifo, inclusive o último.
  return w - (text.length > 0 ? (tr / 1000) * size : 0);
}

/** Quebra por palavras pela largura real. Uma palavra maior que a largura fica sozinha na linha (quem chama confere). */
export function wrap(text: string, size: number, maxWidth: number, o: TypeOpts): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || measure(next, size, o) <= maxWidth) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Elemento <path> com o texto desenhado. `x` é o início da linha de base; `anchor: 'end'` alinha pela direita. */
export function textPath(
  text: string,
  x: number,
  y: number,
  size: number,
  o: TypeOpts & { fill: string; anchor?: 'start' | 'end'; opacity?: number },
): string {
  const w = measure(text, size, o);
  const x0 = o.anchor === 'end' ? x - w : x;
  const d = font(o.weight).getPath(text, x0, y, size, { kerning: true, tracking: o.tracking ?? 0 }).toPathData(2);
  const op = o.opacity !== undefined && o.opacity < 1 ? ` fill-opacity="${o.opacity}"` : '';
  return `<path d="${d}" fill="${o.fill}"${op}/>`;
}
