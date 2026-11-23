import type { Draft, Finding } from '../types';

/**
 * "Tom lint" determinístico (guia de tom de voz v0.2, docs/tom-de-voz-v0.2.md; decisão do PM com o parecer do UI/UX Director).
 *  BLOQUEIA (objetivo, sem falso positivo): emoji; "!" no título; título acima de 90 caracteres; título começando por veja/saiba/confira;
 *    a frase em inglês do rodapé da marca dentro da matéria.
 *  AVISA o revisor (depende de contexto): palavra proibida no corpo/título (fora de citação literal e de nome próprio), data relativa
 *    sem data absoluta no parágrafo, "você" em notícia (só explicador pode), título acima da meta de 70 caracteres.
 * Nada aqui julga fato: só forma. Quem decide fato continuam os gates de evidência.
 */
export const TITLE_MAX = 90;
export const TITLE_TARGET = 70;
export const BRAND_FOOTER_EN = /the global network for board-level loyalty leaders/i;

export interface ToneResult { blocking: Finding[]; warnings: Finding[] }
type ToneDraft = Pick<Draft, 'headline' | 'resumo' | 'body'> & { subtitulo?: string | undefined; autoral?: Draft['autoral'] | undefined };

const f = (code: string, message: string): Finding => ({ code, message });
const noMarks = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const mainOf = (body: string) => body.split(/\n\n(?:Avisos|Fontes):\n/)[0]!;
/** Remove trechos entre aspas (fala literal) antes de conferir palavras e "você". */
const withoutQuotes = (s: string) => s.replace(/["“][^"”\n]{1,600}["”]/g, ' ');

const EMOJI = /\p{Extended_Pictographic}/u;
const CLICKBAIT_START = /^[\s"“'‘(]*(veja|saiba|confira)\b/i;
const CLICKBAIT_ANYWHERE = /\b(veja|saiba|confira)\b/i;
// palavras proibidas (comparadas sem acento); "aproveite"/"não perca" = segunda pessoa imperativa de venda
const FORBIDDEN = /\b(imperdivel(?:eis)?|corra|bomba|incrivel|incriveis|revolucionari[oa]s?|exclusiv[oa]s?|aproveite|nao perca)\b/gi;
const RELATIVE_DATE = /\b(hoje|ontem|anteontem|amanha|nesta (?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?|(?:nesta|esta) semana|semana que vem|proxima semana|mes que vem|neste mes|nos ultimos dias)\b/i;
const MONTHS = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const ABSOLUTE_DATE = new RegExp(`\\b\\d{1,2}(?:º|o|°)?\\s+de\\s+(?:${MONTHS})\\b|\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`, 'i');
const VOCE = /\bvoces?\b/i;

/** Palavra proibida que faz parte de nome próprio (vizinha começa com maiúscula): não conta. */
function isProperName(text: string, idx: number, len: number): boolean {
  const before = text.slice(0, idx).match(/([\p{L}]+)\s+$/u)?.[1];
  const after = text.slice(idx + len).match(/^\s+([\p{L}]+)/u)?.[1];
  const cap = (w: string | undefined) => !!w && /^\p{Lu}/u.test(w);
  const self = text.slice(idx, idx + len);
  return /^\p{Lu}/u.test(self) && (cap(before) || cap(after)) && idx > 0 && !/[.!?]\s*$/.test(text.slice(0, idx));
}

const SHOWN: Record<string, string> = { imperdivel: 'imperdível', imperdiveis: 'imperdíveis', incrivel: 'incrível', incriveis: 'incríveis', revolucionario: 'revolucionário', revolucionaria: 'revolucionária', revolucionarios: 'revolucionários', revolucionarias: 'revolucionárias', nao: 'não perca' };

function forbiddenIn(label: string, raw: string): Finding[] {
  const text = noMarks(withoutQuotes(raw));
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(FORBIDDEN)) {
    const w = m[0].toLowerCase();
    if (isProperName(text, m.index!, m[0].length) || seen.has(w)) continue;
    seen.add(w);
    out.push(f('tone_forbidden_word', `${label}: palavra proibida pelo guia de tom ("${SHOWN[w] ?? (w === 'nao perca' ? 'não perca' : m[0])}"): reescrever, a menos que seja citação literal ou nome de produto`));
  }
  return out;
}

export function checkTone(d: ToneDraft): ToneResult {
  const blocking: Finding[] = [];
  const warnings: Finding[] = [];
  const body = mainOf(d.body);
  const all = `${d.headline}\n${d.subtitulo ?? ''}\n${d.resumo ?? ''}\n${body}`;

  // ---- BLOQUEIOS ----
  if (EMOJI.test(all.replace(/[©®™]/g, ''))) blocking.push(f('tone_emoji', 'emoji no texto: o guia de tom não permite emoji'));
  if (d.headline.includes('!')) blocking.push(f('tone_title_exclamation', 'ponto de exclamação no título'));
  if ([...d.headline].length > TITLE_MAX) blocking.push(f('tone_title_length', `título com ${[...d.headline].length} caracteres (máximo ${TITLE_MAX}; meta ${TITLE_TARGET})`));
  if (CLICKBAIT_START.test(d.headline)) blocking.push(f('tone_title_clickbait', 'título começa com "veja", "saiba" ou "confira"'));
  if (BRAND_FOOTER_EN.test(all)) blocking.push(f('tone_brand_footer_phrase', 'a frase em inglês do rodapé da marca não pode aparecer em matéria'));

  // ---- AVISOS ----
  const len = [...d.headline].length;
  if (len > TITLE_TARGET && len <= TITLE_MAX) warnings.push(f('tone_title_target', `título com ${len} caracteres (meta de até ${TITLE_TARGET} para a home)`));
  if (!CLICKBAIT_START.test(d.headline) && CLICKBAIT_ANYWHERE.test(noMarks(withoutQuotes(d.headline)))) warnings.push(f('tone_title_clickbait_inside', 'título com "veja", "saiba" ou "confira"'));
  warnings.push(...forbiddenIn('título', d.headline), ...forbiddenIn('corpo', body));
  const paragraphs = body.split(/\n{2,}/);
  for (const p of paragraphs) {
    const clean = noMarks(withoutQuotes(p));
    if (RELATIVE_DATE.test(clean) && !ABSOLUTE_DATE.test(noMarks(p))) {
      warnings.push(f('tone_relative_date', `data relativa sem data absoluta no parágrafo: "${p.slice(0, 60).replace(/\s+/g, ' ')}…"`));
      break; // um aviso por matéria basta
    }
  }
  const explicador = d.autoral?.formato === 'explicador';
  if (!explicador && VOCE.test(noMarks(withoutQuotes(body)))) warnings.push(f('tone_voce_in_news', '"você" fora de explicador: manter impessoal em notícia, análise e comparativo'));
  return { blocking, warnings };
}
