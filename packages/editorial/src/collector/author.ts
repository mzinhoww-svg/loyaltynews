import { stripHtml } from './sanitize';

/**
 * Autoria declarada na página, por fonte. Hoje só a Câmara: "Reportagem - Nome<br>Edição - Nome". Nas páginas atuais esse trecho
 * pode estar dentro de um comentário HTML (na tela aparece só "Da Agência Câmara"), por isso a busca é no HTML cru.
 * O valor é texto de terceiro que vai parar no bloco "Fontes:": só passa o que tem cara de nome de pessoa (letras, espaço, ponto,
 * apóstrofo, hífen e vírgula), até 80 caracteres. Na dúvida, sem autor.
 */
const CAMARA = /Reportagem\s*(?:-|–|—|&ndash;|&mdash;|&#8211;|&#8212;|:)\s*([^<\r\n]{2,120})/;
const NAME = /^\p{Lu}[\p{L}\p{M} .,'’-]{1,79}$/u;

export function extractAuthor(sourceId: string, html: string): string | undefined {
  if (sourceId !== 'camara-noticias') return undefined;
  const raw = CAMARA.exec(html)?.[1];
  if (!raw) return undefined;
  const name = stripHtml(raw).replace(/\s*(?:Edição|Edicao)\b.*$/i, '').replace(/\s+/g, ' ').replace(/[\s,.-]+$/, '').trim();
  // pelo menos duas palavras ou uma palavra capitalizada com inicial: frases soltas ("especial sobre…") não são nome
  if (!NAME.test(name) || name.split(' ').length > 10 || /(^| )(sobre|para|com|especial|http)( |$)/i.test(name)) return undefined;
  return name;
}
