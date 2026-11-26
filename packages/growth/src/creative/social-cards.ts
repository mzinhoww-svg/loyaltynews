import type { Article, CreativeAsset } from '../types';
import { CONTEXT_SVG, LOGO_WHITE_SVG } from './assets.data';
import { CreativeRefusal, TOKENS, contextKeyFor } from './post';
import { LOGO_PRIMARY_SVG } from './social-assets.data';
import { font, measure, textPath, wrap, type Weight } from './type-paths';

// Templates sociais dos rascunhos do LinkedIn (matéria e análise autoral), por código, a partir do brandkit
// (design.tokens.json: cores, Inter, áreas seguras, logo e ilustrações de contexto). SEM IA de imagem.
// Determinístico: mesma entrada = mesmo SVG, byte a byte. O texto é desenhado em curvas (Inter embutida), então o SVG
// e o PNG derivado não dependem de fonte instalada. O brandkit está "approved": o status acompanha cada card.
//
// - Card de MATÉRIA: fundo primário, ilustração de contexto à direita (paisagem) ou no alto (quadrado), editoria, manchete,
//   apoio opcional, logo. Nunca leva o selo de autoral.
// - Card de ANÁLISE: só para conteúdo autoral (tipo `analise`, DP-29): fundo menta, selo "CONTEÚDO AUTORAL", formato
//   (Análise, Explicador ou Comparativo), manchete e a assinatura institucional da redação. Conteúdo pago não vira card autoral.

export type SocialCardKind = 'materia' | 'analise';
export type SocialCardFormat = 'linkedin_landscape' | 'square';
export type AutoralFormat = 'analise' | 'explicador' | 'comparativo';

/** `Article` do Growth + marca de conteúdo autoral (vem da pauta autoral da Fábrica: `autoral.formato`). */
export type SocialCardInput = Article & { autoral?: { formato: AutoralFormat } };

export interface SocialCardOptions {
  format?: SocialCardFormat;
  /** Padrão: `analise` se o conteúdo é autoral; senão `materia`. Pedir `analise` sem `autoral` é recusado. */
  kind?: SocialCardKind;
  /** Manchete do card; padrão = título da matéria. Nunca é encurtada com reticências. */
  headline?: string;
  /** Texto de apoio (até 2 linhas; o excedente é cortado com reticências). Se atrapalhar a manchete, é omitido. */
  deck?: string;
}

export const AUTORAL_LABEL = 'CONTEÚDO AUTORAL';
export const SOCIAL_SIGNATURE = 'Redação Loyalty News';
const FORMATO_LABEL: Record<AutoralFormat, string> = { analise: 'ANÁLISE', explicador: 'EXPLICADOR', comparativo: 'COMPARATIVO' };

interface Spec {
  w: number;
  h: number;
  m: number;
  logoW: number;
  headMax: number;
  headMin: number;
  deckSize: number;
  eyebrow: number;
  tag: number;
  ribbonH: number;
  ribbonSize: number;
  maxLines: number;
}

const SPEC: Record<SocialCardFormat, Spec> = {
  linkedin_landscape: { w: TOKENS.social.open_graph[0], h: TOKENS.social.open_graph[1], m: 64, logoW: 190, headMax: 48, headMin: 30, deckSize: 22, eyebrow: 18, tag: 14, ribbonH: 40, ribbonSize: 18, maxLines: TOKENS.social.headline_max_lines },
  square: { w: TOKENS.social.square[0], h: TOKENS.social.square[1], m: TOKENS.social.safe_area, logoW: 280, headMax: 72, headMin: 40, deckSize: 30, eyebrow: 24, tag: 18, ribbonH: 56, ribbonSize: 24, maxLines: TOKENS.social.headline_max_lines },
};

const C = TOKENS.colors;
const MOCK_RED = '#b3261e';
const HEAD_TRACK = -20; // -0,02 em
const LEAD = 1.14;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (n: number): number => Math.round(n * 100) / 100;
const inner = (svg: string): string => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/** Normaliza o texto e recusa glifo que a Inter não tem (cairia no "quadradinho" do .notdef). */
function clean(text: string, what: string): string {
  const t = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  const f = font(400);
  for (const ch of t) {
    if (ch === ' ') continue;
    if (f.charToGlyph(ch).index === 0) throw new CreativeRefusal('glifo_ausente', `${what} tem o caractere "${ch}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase()}), que a fonte do criativo não cobre`);
  }
  return t;
}

function truncateLine(line: string, size: number, maxWidth: number, weight: Weight): string {
  let words = line.split(' ');
  while (words.length > 1 && measure(`${words.join(' ')}…`, size, { weight }) > maxWidth) words = words.slice(0, -1);
  return `${words.join(' ').replace(/[ ,.;:]+$/, '')}…`;
}

interface Fit {
  size: number;
  lines: string[];
  lead: number;
  deckLines: string[];
}

/** Maior corpo de manchete (e apoio) que cabe na largura e na altura disponíveis. A manchete nunca é cortada. */
function fit(headline: string, deck: string, S: Spec, width: number, avail: number): Fit {
  const attempt = (withDeck: boolean): Fit | null => {
    let deckLines: string[] = [];
    if (withDeck && deck) {
      deckLines = wrap(deck, S.deckSize, width, { weight: 400 });
      if (deckLines.length > 2) deckLines = [deckLines[0]!, truncateLine(deckLines[1]!, S.deckSize, width, 400)];
    }
    const deckH = deckLines.length ? 24 + Math.round(S.deckSize * 1.4) * deckLines.length : 0;
    for (let size = S.headMax; size >= S.headMin; size -= 2) {
      const lines = wrap(headline, size, width, { weight: 700, tracking: HEAD_TRACK });
      if (lines.length > S.maxLines) continue;
      if (lines.some((l) => measure(l, size, { weight: 700, tracking: HEAD_TRACK }) > width + 0.5)) continue;
      const lead = Math.round(size * LEAD);
      const total = Math.round(size * 0.8) + lead * (lines.length - 1) + Math.round(size * 0.22) + deckH;
      if (total <= avail) return { size, lines, lead, deckLines };
    }
    return null;
  };
  const f = attempt(true) ?? attempt(false);
  if (!f) throw new CreativeRefusal('manchete_longa', `"${headline.slice(0, 50)}…" não cabe em ${S.maxLines} linhas com corpo ≥ ${S.headMin}px`);
  return f;
}

function pill(x: number, y: number, label: string, size: number, fill: string, textFill: string, opts: { h: number; padX: number; tracking: number; weight: Weight }): { svg: string; w: number } {
  const tw = measure(label, size, { weight: opts.weight, tracking: opts.tracking });
  const w = Math.round(tw + opts.padX * 2);
  const base = y + Math.round(opts.h / 2 + size * 0.36);
  return {
    w,
    svg: `<rect x="${x}" y="${y}" width="${w}" height="${opts.h}" rx="${Math.round(opts.h / 2)}" fill="${fill}"/>${textPath(label, x + opts.padX, base, size, { weight: opts.weight, tracking: opts.tracking, fill: textFill })}`,
  };
}

function nested(svg: string, x: number, y: number, w: number, h: number, viewBox: string, slice = false): string {
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${viewBox}"${slice ? ' preserveAspectRatio="xMidYMid slice"' : ''}>${inner(svg)}</svg>`;
}

/** Gera o card em SVG (fonte da verdade; sem <text>) e uma prévia em HTML. */
export function renderSocialCard(article: SocialCardInput, opts: SocialCardOptions = {}): CreativeAsset {
  const format: SocialCardFormat = opts.format ?? 'linkedin_landscape';
  const kind: SocialCardKind = opts.kind ?? (article.autoral ? 'analise' : 'materia');
  if (kind === 'analise' && !article.autoral) throw new CreativeRefusal('sem_autoral', 'o card de análise só existe para conteúdo autoral (tipo analise); matéria comum usa o card de matéria');
  if (kind === 'materia' && article.autoral) throw new CreativeRefusal('autoral_sem_selo', 'conteúdo autoral não pode usar o card de matéria (ficaria sem o selo de autoral)');
  if (kind === 'analise' && article.sponsored) throw new CreativeRefusal('autoral_patrocinado', 'conteúdo patrocinado não leva o selo de autoral');

  const S = SPEC[format];
  const headline = clean(opts.headline ?? article.title, 'a manchete');
  if (!headline) throw new CreativeRefusal('sem_manchete', 'título vazio');
  const deck = clean(opts.deck ?? article.deck ?? '', 'o apoio');
  const editoria = clean(article.editoria, 'a editoria').toUpperCase();
  const key = contextKeyFor(article.editoria);
  const landscape = format === 'linkedin_landscape';
  const analise = kind === 'analise';
  const bg = analise ? C.mint : C.primary;
  const ink = analise ? C.primary : C.white;
  const logoSvg = analise ? LOGO_PRIMARY_SVG : LOGO_WHITE_SVG;
  const logoH = Math.round((S.logoW * 132) / 606);
  const logoX = S.m;
  const logoY = S.h - S.m - logoH;
  const parts: string[] = [];

  // ---------- geometria por tipo e formato
  let textW: number;
  let eyebrowBase: number;
  let headTop: number;
  const bottom = logoY - (landscape ? 28 : 36);
  let art: string;
  let tag: string;

  const tagText = article.mock ? 'MOCK · EXEMPLO · ILUSTRAÇÃO' : 'ILUSTRAÇÃO CONCEITUAL';
  const tagBox = (cx: number, cy: number, align: 'start' | 'end'): string => {
    const tw = measure(tagText, S.tag, { weight: 700, tracking: 100 });
    const w = Math.round(tw + 28);
    const h = Math.round(S.tag * 2.3);
    const x = align === 'end' ? cx - w : cx;
    return `<rect x="${x}" y="${cy}" width="${w}" height="${h}" fill="${C.black}" fill-opacity="0.78"/>${textPath(tagText, x + 14, cy + Math.round(h / 2 + S.tag * 0.36), S.tag, { weight: 700, tracking: 100, fill: C.white })}`;
  };

  if (!analise && landscape) {
    const panelX = 712;
    textW = panelX - S.m - 40;
    eyebrowBase = 100;
    headTop = 140;
    art = `<defs><linearGradient id="ln-fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${bg}"/><stop offset="0.38" stop-color="${bg}" stop-opacity="0"/></linearGradient></defs>${nested(CONTEXT_SVG[key], panelX, 0, S.w - panelX, S.h, '0 0 1080 640', true)}<rect x="${panelX}" y="0" width="${S.w - panelX}" height="${S.h}" fill="url(#ln-fade)"/>`;
    tag = tagBox(S.w - 24, 24, 'end');
  } else if (!analise) {
    const imgH = 440;
    textW = S.w - S.m * 2;
    eyebrowBase = 548;
    headTop = 588;
    art = `<defs><linearGradient id="ln-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="${bg}" stop-opacity="0"/><stop offset="1" stop-color="${bg}"/></linearGradient></defs>${nested(CONTEXT_SVG[key], 0, 0, S.w, imgH, '0 0 1080 640', true)}<rect x="0" y="0" width="${S.w}" height="${imgH}" fill="url(#ln-fade)"/>`;
    tag = tagBox(S.w - 24, 24, 'end');
  } else if (landscape) {
    const stripX = 900;
    textW = stripX - S.m - 48;
    eyebrowBase = 150;
    headTop = 188;
    // borda reta: a faixa de ilustração do card autoral fica nítida (o degradê sobre a arte clara ficava turvo)
    art = nested(CONTEXT_SVG[key], stripX, 0, S.w - stripX, S.h, '0 0 1080 640', true);
    tag = tagBox(S.w - 24, S.h - 24 - Math.round(S.tag * 2.3), 'end');
  } else {
    const stripH = 300;
    textW = S.w - S.m * 2;
    eyebrowBase = 454;
    headTop = 494;
    art = nested(CONTEXT_SVG[key], 0, 0, S.w, stripH, '0 0 1080 640', true);
    tag = tagBox(S.w - 24, 24, 'end');
  }

  // card de análise é texto-forte (sem foto de capa): aceita manchete maior quando ela é curta
  const f = fit(headline, deck, analise ? { ...S, headMax: Math.round(S.headMax * 1.15) } : S, textW, bottom - headTop);

  // ---------- montagem
  const alt = analise
    ? `Card de ${FORMATO_LABEL[article.autoral!.formato].toLowerCase()} autoral da ${SOCIAL_SIGNATURE}, editoria ${article.editoria}: ${headline}.${article.mock ? ' Exemplo de demonstração.' : ''}`
    : `Card da Loyalty News, editoria ${article.editoria}: ${headline}.${article.sponsored ? ` ${article.sponsored.label}.` : ''}${article.mock ? ' Exemplo de demonstração.' : ''}`;
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${S.w}" height="${S.h}" viewBox="0 0 ${S.w} ${S.h}" role="img" aria-label="${esc(headline)}" data-brand-status="${esc(TOKENS.status)}" data-brand-version="${esc(TOKENS.brand_version)}" data-kind="${kind}" data-format="${format}" data-context="${key}">`);
  parts.push(`<title>${esc(headline)}</title><desc>${esc(alt)}</desc>`);
  parts.push(`<rect width="${S.w}" height="${S.h}" fill="${bg}"/>`);
  parts.push(art);
  parts.push(tag);

  const barW = landscape ? 6 : 8;
  const eyebrowBar = analise ? C.secondary : C.signal;
  const eyebrowInk = analise ? C.primary : C.signal;
  let kickerY = eyebrowBase;
  if (analise) {
    // selo de autoral + formato, acima da editoria
    const sealH = landscape ? 38 : 50;
    const sealY = landscape ? 64 : 346;
    const seal = pill(S.m, sealY, AUTORAL_LABEL, landscape ? 15 : 20, C.primary, C.signal, { h: sealH, padX: landscape ? 18 : 24, tracking: 100, weight: 700 });
    parts.push(seal.svg);
    parts.push(textPath(FORMATO_LABEL[article.autoral!.formato], S.m + seal.w + 18, sealY + Math.round(sealH / 2 + (landscape ? 15 : 20) * 0.36), landscape ? 15 : 20, { weight: 700, tracking: 100, fill: C.primary }));
    kickerY = eyebrowBase;
  }
  parts.push(`<rect x="${S.m}" y="${kickerY - Math.round(S.eyebrow * 1.05)}" width="${barW}" height="${Math.round(S.eyebrow * 1.35)}" fill="${eyebrowBar}"/>`);
  parts.push(textPath(editoria, S.m + barW + 16, kickerY, S.eyebrow, { weight: 700, tracking: 120, fill: eyebrowInk }));

  const firstBase = headTop + Math.round(f.size * 0.8);
  f.lines.forEach((ln, i) => parts.push(textPath(ln, S.m, firstBase + i * f.lead, f.size, { weight: 700, tracking: HEAD_TRACK, fill: ink })));
  if (f.deckLines.length) {
    const lastBase = firstBase + (f.lines.length - 1) * f.lead;
    const deckLead = Math.round(S.deckSize * 1.4);
    const deckFirst = lastBase + Math.round(f.size * 0.22) + 24 + Math.round(S.deckSize * 0.8);
    f.deckLines.forEach((ln, i) => parts.push(textPath(ln, S.m, deckFirst + i * deckLead, S.deckSize, { weight: 400, fill: analise ? C.primary : C.mint })));
  }

  parts.push(`<svg x="${logoX}" y="${logoY}" width="${S.logoW}" height="${logoH}" viewBox="0 0 606 132">${inner(logoSvg)}</svg>`);
  const rightEdge = analise && landscape ? 900 - 48 : S.w - S.m;
  if (analise) {
    const sigSize = landscape ? 20 : 28;
    parts.push(textPath(SOCIAL_SIGNATURE, rightEdge, logoY + logoH - Math.round(logoH * 0.18), sigSize, { weight: 600, fill: C.primary, anchor: 'end' }));
  } else if (article.sponsored) {
    const p = pill(0, 0, clean(article.sponsored.label, 'o rótulo de patrocínio').toUpperCase(), landscape ? 14 : 20, 'none', C.signal, { h: landscape ? 34 : 46, padX: landscape ? 16 : 22, tracking: 100, weight: 700 });
    const px = (landscape ? 712 - 40 : S.w - S.m) - p.w;
    const py = logoY + Math.round((logoH - (landscape ? 34 : 46)) / 2);
    parts.push(`<g transform="translate(${r2(px)} ${r2(py)})">${p.svg.replace(/fill="none"/, `fill="none" stroke="${C.signal}" stroke-width="2"`)}</g>`);
  }
  if (article.mock) {
    const label = 'MOCK — NÃO PUBLICAR';
    const w = Math.round(measure(label, S.ribbonSize, { weight: 700 }) + 36);
    parts.push(`<rect x="0" y="${S.h - S.ribbonH}" width="${w}" height="${S.ribbonH}" fill="${MOCK_RED}"/>${textPath(label, 18, S.h - Math.round(S.ribbonH / 2 - S.ribbonSize * 0.36), S.ribbonSize, { weight: 700, fill: C.white })}`);
  }
  parts.push('</svg>');
  const svg = parts.join('');
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${esc(headline)} — card ${kind} ${format}</title><body style="margin:0;background:#e8eeeb;display:flex;justify-content:center;padding:24px"><div style="max-width:${S.w}px;width:100%">${svg}<p style="font:12px Inter,Arial,sans-serif;color:#456560">Brandkit ${esc(TOKENS.brand_version)} — status: ${esc(TOKENS.status)}${article.mock ? ' · MOCK' : ''}</p></div></body></html>`;

  return { format, width: S.w, height: S.h, svg, html, contextKey: key, brandStatus: TOKENS.status, mock: Boolean(article.mock) };
}
