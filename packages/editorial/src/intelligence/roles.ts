import { normalizeText } from '../dedupe/dedupe';
import type { DroppedMention, DropReason, RoleMention } from './types';
import { ROLE_MENTION_KEYS } from './types';

/**
 * Extração de menções de cargo (nome, cargo, empresa) de matéria PUBLICADA. Determinística primeiro; o modelo (via
 * gateway) só PROPÕE e tudo o que ele devolve passa por `validateMention`. Princípio: nunca inventar vínculo —
 * toda menção carrega o trecho literal da matéria e só vale se nome, empresa e cargo constam nesse trecho e nas fontes.
 */

const MAX_EXCERPT = 500;
const CAP = '[A-ZÀ-Ú][a-zà-ú]+';
const NAME = `${CAP}(?: (?:d[aeo]s?|e) ${CAP}| ${CAP}){1,4}`;
const ORG = "[A-ZÀ-Ú][\\wÀ-ú.&'-]*(?: [A-ZÀ-Ú0-9][\\wÀ-ú.&'-]*)*";
const TITLE = '[a-zà-ú]+(?: (?:d[aeo]s?|e|em) [A-Za-zÀ-ú]+| [A-Za-zÀ-ú]+)*?';
const PREP = '(?:da|do|na|no|em)';
const HEAD_NOUN = '(?:presidente|vice-presidente|diretor|diretora|gerente|superintendente|head|coordenador|coordenadora|CEO|CFO|CMO|COO|CIO|CTO)';

const APPOINT = new RegExp(`(${NAME}) (?:foi nomead[oa](?: para| como)? |é o novo |é a nova |assume |assumiu |passa a ser )(?:como |o cargo de |a |o )?(${TITLE}) ${PREP} (${ORG})`);
const APPOINT_ORG_FIRST = new RegExp(`(?:^|[.;] |, )(?:[AO] )?(${ORG}) (?:anuncia|anunciou|nomeia|nomeou|contrata|contratou) (${NAME}) (?:como|para) (?:o cargo de |a |o )?(${TITLE})(?=[,.;]|$)`);
const DEPART = new RegExp(`(${NAME}) (?:(?:deixa|deixou|deixará) (?:o cargo de |a |o )?|(?:sai|saiu) d(?:o cargo de |a |o ))(${TITLE}) ${PREP} (${ORG})`);
const APPOSITIVE = new RegExp(`(${NAME}), (${HEAD_NOUN}(?: [A-Za-zÀ-ú]+| d[aeo]s? [A-Za-zÀ-ú]+)*?) ${PREP} (${ORG})(?=[,.;])`);

const MESES: Record<string, string> = { janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };

/** Palavras que abrem frase e a regex de nome captura por serem maiúsculas ("Segundo Ana Silva, diretora..."). */
const LEADING_WORDS = new Set(['Segundo', 'Conforme', 'Para', 'Com', 'Após', 'Apos', 'Ontem', 'Hoje', 'Nesta', 'Neste', 'Nessa', 'Nesse', 'Ainda', 'Mas', 'Porém', 'Assim', 'Também', 'Já', 'Como', 'Diz', 'Disse', 'Afirma', 'Afirmou', 'Informou', 'Segue', 'Entre', 'Sobre', 'Durante', 'Antes', 'Depois', 'Enquanto', 'Quando', 'Mesmo', 'Além', 'Alem', 'De', 'Do', 'Da']);
export function cleanName(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  while (parts.length > 2 && LEADING_WORDS.has(parts[0]!)) parts.shift();
  return parts.join(' ');
}

const upper1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const trimOrg = (s: string) => { const t = s.replace(/[,;:]+$/, '').trim(); return t.endsWith('S.A.') ? t : t.replace(/\.+$/, ''); };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Marcas de anúncio na frase (nomeação, saída, troca). Sem elas, `announced` não pode ser verdadeiro. */
export const ANNOUNCEMENT_CUE = /(nomead[oa]|nomeia|nomeou|assume|assumiu|passa a ser|é o novo|é a nova|anuncia|anunciou|contrata|contratou|deixa|deixou|deixará|sai d|saiu d|renunciou|promovid[oa]|desligad[oa])/i;

/** Datas completas da frase (AAAA-MM-DD). Só devolve data se houver exatamente UMA data inequívoca. */
export function explicitDates(sentence: string): string[] {
  const out = new Set<string>();
  const pt = /(\d{1,2})\s?[ºo°]?\s+de\s+([a-zç]+)\s+de\s+(\d{4})/gi;
  for (const m of sentence.matchAll(pt)) {
    const mm = MESES[m[2]!.toLowerCase()];
    if (mm) out.add(iso(m[3]!, mm, m[1]!));
  }
  for (const m of sentence.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)) out.add(iso(m[3]!, m[2]!.padStart(2, '0'), m[1]!));
  return [...out].filter((d) => d !== '');
}
function iso(y: string, m: string, d: string): string {
  const day = d.padStart(2, '0');
  const t = Date.parse(`${y}-${m}-${day}T00:00:00Z`);
  if (Number.isNaN(t)) return '';
  return new Date(t).toISOString().slice(0, 10) === `${y}-${m}-${day}` ? `${y}-${m}-${day}` : '';
}

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú])|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** Extração por regras. Cobertura baixa de propósito: o que a frase não diz, não é inferido. */
export function extractRoleMentionsDeterministic(text: string): RoleMention[] {
  const out: RoleMention[] = [];
  const seen = new Set<string>();
  const push = (m: RoleMention) => {
    const key = `${normalizeText(m.personName)}|${normalizeText(m.orgName)}|${m.kind}`;
    if (seen.has(key)) return;
    seen.add(key); out.push(m);
  };
  for (const sentence of splitSentences(text)) {
    const dates = explicitDates(sentence);
    const effective = dates.length === 1 ? { effectiveDate: dates[0]! } : {};
    let m = APPOINT.exec(sentence);
    if (m) push({ personName: cleanName(m[1]!), title: upper1(m[2]!.trim()), orgName: trimOrg(m[3]!), kind: 'present', announced: true, ...effective, excerpt: clip(sentence, MAX_EXCERPT) });
    m = APPOINT_ORG_FIRST.exec(sentence);
    if (m) push({ personName: cleanName(m[2]!), title: upper1(m[3]!.trim()), orgName: trimOrg(m[1]!), kind: 'present', announced: true, ...effective, excerpt: clip(sentence, MAX_EXCERPT) });
    m = DEPART.exec(sentence);
    if (m) push({ personName: cleanName(m[1]!), title: upper1(m[2]!.trim()), orgName: trimOrg(m[3]!), kind: 'left', announced: true, ...effective, excerpt: clip(sentence, MAX_EXCERPT) });
    // "Maria Silva, diretora de Marketing da Empresa X," — cargo atual citado, SEM anúncio
    if (!ANNOUNCEMENT_CUE.test(sentence)) {
      m = APPOSITIVE.exec(sentence);
      if (m) push({ personName: cleanName(m[1]!), title: upper1(m[2]!.trim()), orgName: trimOrg(m[3]!), kind: 'present', excerpt: clip(sentence, MAX_EXCERPT) });
    }
  }
  return out;
}

const has = (hay: string, needle: string) => needle.trim() !== '' && normalizeText(hay).includes(normalizeText(needle));
const PERSON_SHAPE = new RegExp(`^${NAME}$`);

export type Validation = { ok: true; mention: RoleMention } | { ok: false; drop: DroppedMention };

/**
 * Valida UMA menção proposta (regra ou modelo) contra o texto PUBLICADO e as evidências das fontes.
 * Devolve só os campos conhecidos (qualquer outro é descartado), com o trecho literal.
 */
export function validateMention(raw: unknown, publishedText: string, sourceEvidenceTexts: readonly string[]): Validation {
  const bad = (reason: DropReason, r?: Partial<RoleMention>): Validation => ({ ok: false, drop: { reason, ...(r?.personName ? { personName: r.personName } : {}), ...(r?.orgName ? { orgName: r.orgName } : {}) } });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad('bad_shape');
  const r = raw as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');
  const personName = str('personName'); const orgName = str('orgName'); const title = str('title'); const excerpt = str('excerpt');
  const kind = r['kind'];
  const ctx = { personName, orgName };
  if (!personName || !orgName || !title || !excerpt || (kind !== 'present' && kind !== 'left') || !PERSON_SHAPE.test(personName) || LEADING_WORDS.has(personName.split(' ')[0]!)) return bad('bad_shape', ctx);
  if (excerpt.length > MAX_EXCERPT) return bad('excerpt_not_literal', ctx);
  // 1) o trecho é LITERAL da matéria publicada
  if (!publishedText.includes(excerpt)) return bad('excerpt_not_literal', ctx);
  // 2) nome, empresa e cargo constam NO trecho
  if (!excerpt.includes(personName)) return bad('name_not_in_excerpt', ctx);
  if (!has(excerpt, orgName)) return bad('org_not_in_excerpt', ctx);
  if (!has(excerpt, title)) return bad('title_not_in_excerpt', ctx);
  // 3) e constam nas fontes primárias coletadas (a matéria não pode ter vínculo que a fonte não sustenta)
  const inSource = sourceEvidenceTexts.some((t) => has(t, personName) && has(t, orgName) && has(t, title));
  if (!inSource) return bad('not_in_source_evidence', ctx);
  // 4) anúncio só se o trecho tem marca de anúncio; data só se está no trecho
  const announced = r['announced'] === true;
  if (announced && !ANNOUNCEMENT_CUE.test(excerpt)) return bad('announcement_unsupported', ctx);
  let effectiveDate: string | undefined;
  if (typeof r['effectiveDate'] === 'string' && r['effectiveDate'] !== '') {
    const d = r['effectiveDate'];
    if (!announced || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !explicitDates(excerpt).includes(d)) return bad('date_not_in_excerpt', ctx);
    effectiveDate = d;
  }
  // 5) perfil público: só URL https/http pública que apareça no texto publicado
  let publicProfileUrl: string | undefined;
  if (typeof r['publicProfileUrl'] === 'string' && r['publicProfileUrl'] !== '') {
    try {
      const u = new URL(r['publicProfileUrl']);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return bad('profile_url_not_public', ctx);
    } catch { return bad('profile_url_not_public', ctx); }
    if (!publishedText.includes(r['publicProfileUrl'])) return bad('profile_url_not_in_text', ctx);
    publicProfileUrl = r['publicProfileUrl'];
  }
  const mention: RoleMention = {
    personName, orgName, title, kind, excerpt,
    ...(publicProfileUrl ? { publicProfileUrl } : {}), ...(announced ? { announced: true } : {}), ...(effectiveDate ? { effectiveDate } : {}),
  };
  for (const k of Object.keys(mention)) if (!(ROLE_MENTION_KEYS as readonly string[]).includes(k)) delete (mention as unknown as Record<string, unknown>)[k];
  return { ok: true, mention };
}

export const mentionKey = (m: RoleMention) => `${normalizeText(m.personName)}|${normalizeText(m.orgName)}|${m.kind}`;

/**
 * Flag `intelligencePessoas` desligada => só organizações: remove o nome da pessoa de TODOS os campos do pacote
 * (personName vazio e nome substituído por "[pessoa omitida]" no trecho). O consumidor registra só orgName.
 */
export function minimizeToOrganizations(mentions: readonly RoleMention[]): RoleMention[] {
  // remove o nome de TODAS as pessoas conhecidas do lote (um trecho pode citar mais de uma)
  const names = [...new Set(mentions.map((m) => m.personName).filter(Boolean))].sort((a, b) => b.length - a.length);
  return mentions.map((m) => ({
    personName: '', orgName: m.orgName, title: m.title, kind: m.kind,
    excerpt: names.reduce((t, n) => t.split(n).join('[pessoa omitida]'), m.excerpt),
  }));
}
