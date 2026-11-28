import { stripHtml } from './sanitize';

/**
 * Autoria VISÍVEL na matéria, por fonte (parecer 65). Hoje só a Câmara: "Reportagem – Nome". Comentário, script, menu e rodapé são
 * removidos antes da busca: nome que a fonte não mostra ao leitor não é usado. O valor é texto de terceiro que vai para o bloco
 * "Fontes:": só passa o que tem cara de nome de pessoa. Na dúvida, sem autor.
 */
const HIDDEN = /<!--[\s\S]*?(?:-->|$)|<(script|style|noscript|template|svg|iframe|nav|header|footer|aside|form|dialog|button|select)\b[\s\S]*?<\/\1>/gi;
const CAMARA = /Reportagem\s*(?:-|–|—|:)\s*([^\n]{2,120})/;
const PARTICLE = /^(?:da|de|do|das|dos|e|del|van|von)$/;
const WORD = /^(?:\p{Lu}\.|(?:[dD]['’])?\p{Lu}[\p{L}\p{M}'’-]*)$/u;
const NOT_A_NAME = /^(?:agência|agencia|ao|vivo|veja|leia|saiba|mais|rádio|radio|tv|redação|redacao|especial|rascunho|não|nao|notícias|noticias|câmara|camara)$/i;

function visibleText(html: string): string {
  const clean = html.replace(HIDDEN, ' ');
  const block = /<article(?=[\s>])[^>]*>([\s\S]*?)<\/article>/i.exec(clean)?.[1] ?? /<main(?=[\s>])[^>]*>([\s\S]*?)<\/main>/i.exec(clean)?.[1] ?? clean;
  return block.replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, '\u0001').split('\u0001').map((part) => stripHtml(part).replace(/\s+/g, ' ').trim()).join('\n');
}

export function extractAuthor(sourceId: string, html: string): string | undefined {
  if (sourceId !== 'camara-noticias') return undefined;
  const raw = CAMARA.exec(visibleText(html))?.[1];
  if (!raw) return undefined;
  const name = raw.replace(/\s*(?:Edição|Edicao)\b.*$/, '').replace(/\s*\/\s*[A-Z]{2}\b/g, '').replace(/[\s,;–—-]+$/, '').trim();
  const words = name.split(/[\s,]+/).filter(Boolean);
  const people = words.filter((w) => !PARTICLE.test(w));
  if (name.length > 80 || words.length > 10 || people.length < 2) return undefined;
  if (!people.every((w) => WORD.test(w) && !NOT_A_NAME.test(w))) return undefined;
  return name;
}
