/**
 * Corpo placeholder (Lorem Ipsum) não é conteúdo: a fonte não sustenta matéria.
 *
 * Sinais medidos nos controles em 26/11/2026, com `parseHtml` + `sanitize` (o mesmo texto que vai à evidência):
 * - Bradesco RI, página do art_1cb36c43: 420 palavras, 2 frases canônicas de Lorem, latinShare 0,143, uniqueShare 0,476.
 * - A4A (airlines.org, release real): 247 palavras, 0 frase, latinShare 0, uniqueShare 0,583.
 * - Bradesco RI, notícia real ("Em 2026..."): 72 palavras, 0 frase, latinShare 0,056, uniqueShare 0,667.
 *
 * Regra conservadora, para não bloquear texto real: latinShare >= 0,10; ou 1 frase canônica com latinShare >= 0,06;
 * e repetição (uniqueShare baixo) só junto de latinShare. Corpo com menos de 20 palavras fica para `empty_content`:
 * páginas curtas reais não são barradas por esta regra.
 */
const LOREM_PHRASES = [
  'lorem ipsum', 'dolor sit amet', 'consectetur adipiscing', 'sed do eiusmod', 'ut enim ad minim',
  'duis aute irure', 'excepteur sint', 'mi tincidunt', 'id quisque ligula', 'nulla facilisi',
];

/** Vocabulário distintivo do Lorem; palavras comuns em pt/en (do, ex, ea, id, sit) ficam fora para não inflar texto real. */
const LOREM_WORDS = new Set([
  'lorem', 'ipsum', 'dolor', 'amet', 'consectetur', 'adipiscing', 'elit', 'eiusmod', 'tempor', 'incididunt',
  'labore', 'dolore', 'magna', 'aliqua', 'enim', 'minim', 'veniam', 'nostrud', 'exercitation', 'ullamco',
  'laboris', 'nisi', 'aliquip', 'commodo', 'consequat', 'duis', 'aute', 'irure', 'reprehenderit', 'voluptate',
  'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint', 'occaecat', 'cupidatat',
  'proident', 'culpa', 'officia', 'deserunt', 'mollit', 'anim', 'laborum', 'tincidunt', 'quisque', 'ligula', 'diam',
]);

export interface PlaceholderSignals {
  words: number;
  /** Ocorrências de frases canônicas de Lorem. */
  loremHits: number;
  /** Fração de palavras do vocabulário Lorem. */
  latinShare: number;
  /** Palavras distintas / palavras. */
  uniqueShare: number;
}

export function placeholderSignals(text: string): PlaceholderSignals {
  const low = text.toLowerCase();
  const words = low.match(/[a-zà-ÿ]{2,}/g) ?? [];
  const loremHits = LOREM_PHRASES.reduce((n, p) => n + (low.split(p).length - 1), 0);
  const latin = words.filter((w) => LOREM_WORDS.has(w)).length;
  const unique = new Set(words).size;
  return {
    words: words.length,
    loremHits,
    latinShare: words.length ? latin / words.length : 0,
    uniqueShare: words.length ? unique / words.length : 0,
  };
}

export function isPlaceholder(s: PlaceholderSignals): boolean {
  if (s.words < 20) return false;
  if (s.latinShare >= 0.10) return true;
  if (s.loremHits >= 1 && s.latinShare >= 0.06) return true;
  return s.latinShare >= 0.06 && s.uniqueShare <= 0.5;
}

export function isPlaceholderBody(text: string): boolean {
  return isPlaceholder(placeholderSignals(text));
}

/** Motivo legível para o skip (sem texto do corpo): base da decisão registrada por fonte/artigo. */
export function placeholderReason(s: PlaceholderSignals): string {
  return `palavras=${s.words}; lorem=${s.loremHits}; latinShare=${s.latinShare.toFixed(3)}; uniqueShare=${s.uniqueShare.toFixed(3)}`;
}
