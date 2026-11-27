/**
 * Planejamento do card de Open Graph por matéria (1200×630).
 * Função pura, sem DOM e sem next/og: decide tamanho e quebra da manchete antes de desenhar.
 * Regra de marca: a manchete NUNCA é cortada com reticências. Se não couber, o card é recusado
 * e a matéria cai na imagem da editoria (o chamador decide), em vez de publicar texto truncado.
 */

export const OG_CARD = {
  width: 1200,
  height: 630,
  padding: 72,
  maxLines: 4,
  /** Abaixo disso a manchete perde legibilidade no card; melhor recusar e usar a imagem da editoria. */
  minFontSize: 46,
  /** Fator conservador de largura média de glifo da Inter Bold (em). */
  glyphEm: 0.56,
} as const;

/** Cores do design system usadas no card (mesmos hex de packages/ui/tokens/tokens.ts). */
export const OG_COLORS = {
  background: '#153C3C', // primary
  headline: '#FFFFFF', // white
  eyebrow: '#DDEFE8', // mint
  footer: '#A7DDC9', // signal
} as const;

export class OgCardRefusal extends Error {
  constructor(motivo: string) {
    super(`card de OG recusado: ${motivo}`);
    this.name = 'OgCardRefusal';
  }
}

export interface OgCardPlano {
  width: number;
  height: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  eyebrow: string;
  credit: string;
  dateLabel: string;
  site: string;
}

/** Tamanho da manchete por faixa de comprimento (as três faixas do aceite: curta, média e 120). */
export function tamanhoDaManchete(titulo: string): number {
  const n = titulo.trim().length;
  if (n <= 40) return 76;
  if (n <= 70) return 66;
  if (n <= 95) return 58;
  return 52;
}

/** Quebra por largura, sem cortar palavra e sem perder caractere. */
export function quebrarManchete(titulo: string, fontSize: number, maxWidth: number): string[] {
  const palavras = titulo.trim().split(/\s+/).filter(Boolean);
  if (!palavras.length) throw new OgCardRefusal('título vazio');
  const porLinha = Math.max(1, Math.floor(maxWidth / (fontSize * OG_CARD.glyphEm)));
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of palavras) {
    const proxima = atual ? `${atual} ${palavra}` : palavra;
    if (proxima.length <= porLinha) atual = proxima;
    else {
      if (atual) linhas.push(atual);
      if (palavra.length > porLinha) throw new OgCardRefusal(`palavra maior que a linha: ${palavra}`);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

export interface OgCardEntrada {
  title: string;
  editoria: string;
  credit?: string;
  /** Data ISO de publicação. */
  publishedAt?: string;
}

/** Data editorial no fuso de São Paulo, curta para caber no rodapé do card. */
export function dataCurta(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' })
    .format(d)
    .replace(/\.$/, '');
}

/** Plano completo do card; lança OgCardRefusal quando a manchete não cabe em 4 linhas. */
export function planejarOgCard(entrada: OgCardEntrada): OgCardPlano {
  const larguraUtil = OG_CARD.width - OG_CARD.padding * 2;
  let fontSize = tamanhoDaManchete(entrada.title);
  let lines = quebrarManchete(entrada.title, fontSize, larguraUtil);
  while (lines.length > OG_CARD.maxLines && fontSize > OG_CARD.minFontSize) {
    // O passo nunca atravessa o mínimo: a última tentativa é exatamente nele (QA 5).
    fontSize = Math.max(OG_CARD.minFontSize, fontSize - 4);
    lines = quebrarManchete(entrada.title, fontSize, larguraUtil);
  }
  if (lines.length > OG_CARD.maxLines) throw new OgCardRefusal(`manchete ocupa ${lines.length} linhas no mínimo de ${OG_CARD.minFontSize}px`);
  return {
    width: OG_CARD.width,
    height: OG_CARD.height,
    lines,
    fontSize,
    lineHeight: Math.round(fontSize * 1.14),
    eyebrow: entrada.editoria.trim().toUpperCase(),
    credit: (entrada.credit ?? '').trim(),
    dateLabel: dataCurta(entrada.publishedAt),
    site: 'loyaltynews.com.br',
  };
}

/** Só gera o card quando a manchete cabe; quem não couber usa a imagem da editoria. */
export function podeGerarOgCard(entrada: OgCardEntrada): boolean {
  try {
    planejarOgCard(entrada);
    return true;
  } catch {
    return false;
  }
}
