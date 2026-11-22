import type { Article, Channel, Entity, Violation } from '../types.ts';

export const SIGNATURE = 'Redação Loyalty News';
export const LINKEDIN_MAX_CHARS = 3000;
/** LinkedIn corta o post em ~210 caracteres antes do "ver mais": o gancho precisa caber ali. */
export const HOOK_MAX_CHARS = 210;
export const MAX_FACT_BULLETS = 3;
export const MAX_HASHTAGS = 3;

const HASHTAGS: Record<string, string[]> = {
  'Mercado & Negócios': ['#Fidelidade', '#Mercado'],
  'Programas de Fidelidade': ['#ProgramasDeFidelidade', '#Fidelidade'],
  'Pontos & Milhas': ['#Milhas', '#Pontos'],
  'Bancos & Cartões': ['#Cartões', '#Fidelidade'],
  'Varejo & Cashback': ['#Varejo', '#Cashback'],
  'Travel & Hospitality': ['#Viagens', '#Fidelidade'],
  'LoyaltyTech & IA': ['#LoyaltyTech', '#IA'],
  'CRM & CX': ['#CRM', '#CX'],
  'Global Loyalty': ['#Loyalty', '#Global'],
  'Regulação & Dados': ['#Regulação', '#Dados'],
};

/** Expressões que sugerem apuração presencial, entrevista ou autoria humana inventada (Blueprint §6). */
const FORBIDDEN_CLAIMS: RegExp[] = [
  /\bentrevistamos\b/i,
  /\bconversamos com\b/i,
  /\bnossa reportagem (esteve|ouviu|apurou)\b/i,
  /\bapuramos in loco\b/i,
  /\bem entrevista exclusiva\b/i,
  /\bfontes? (nos|me) (disse|contou|confirmaram?)\b/i,
];

export interface MentionPlan {
  name: string;
  ref: string;
  source: string;
}

export interface LinkedInCopy {
  text: string;
  hook: string;
  link: string;
  hashtags: string[];
  /** Menções com identidade verificada. Vazio ou parcial = o texto cita o nome em texto puro. */
  mentions: MentionPlan[];
  /** Entidades citadas sem identidade verificada: aparecem como texto puro, sem marcação. */
  plainEntities: string[];
  /** `true` quando nenhuma menção marcável existe (fallback texto puro integral). */
  textOnlyFallback: boolean;
  violations: Violation[];
}

export class CopyRefusal extends Error {
  readonly violations: Violation[];
  constructor(violations: Violation[]) {
    super(`copy recusada: ${violations.map((v) => v.rule).join(', ')}`);
    this.name = 'CopyRefusal';
    this.violations = violations;
  }
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function withUtm(url: string, channel: Channel, article: Pick<Article, 'id' | 'editoria'>): string {
  const u = new URL(url);
  u.searchParams.set('utm_source', channel);
  u.searchParams.set('utm_medium', 'social');
  u.searchParams.set('utm_campaign', slug(article.id));
  u.searchParams.set('utm_content', slug(article.editoria));
  return u.toString();
}

function normNumber(n: string): string {
  return n.replace(/[.,]+$/, '').replace(/\./g, '').replace(/,/g, '.');
}

function numbersIn(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map(normNumber);
}

/** Texto autoral do post sem URL, hashtags nem assinatura/crédito, para checar números. */
function stripNonClaims(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(new RegExp(SIGNATURE, 'g'), ' ');
}

/**
 * Regras do motor social. Determinísticas, sem modelo: servem de gate para qualquer texto (gerado
 * por este motor ou vindo de um agente).
 */
export interface ValidateOptions {
  /** Instagram não tem link clicável na legenda: `false` dispensa o link com UTM. Padrão: exige. */
  requireLink?: boolean;
}

export function validateCopy(
  text: string,
  article: Article,
  mentions: MentionPlan[] = [],
  opts: ValidateOptions = {},
): Violation[] {
  const v: Violation[] = [];
  const firstLine = text.split('\n')[0] ?? '';

  if (article.facts.length === 0) {
    v.push({ rule: 'sem_fatos', detail: 'a matéria não traz fatos com fonte; não há o que publicar' });
  }
  for (const f of article.facts) {
    if (!f.source.trim()) v.push({ rule: 'fato_sem_fonte', detail: f.text.slice(0, 60) });
  }

  // 1. Nenhum número que não esteja nas fontes aprovadas (título, deck, fatos).
  const allowed = new Set<string>(
    numbersIn([article.title, article.deck ?? '', ...article.facts.map((f) => f.text)].join(' ')),
  );
  for (const n of numbersIn(stripNonClaims(text))) {
    if (!allowed.has(n)) v.push({ rule: 'numero_inventado', detail: `número "${n}" não consta nos fatos da matéria` });
  }

  // 2. Marcação (@) só para entidade com identidade verificada.
  const verifiedNames = new Set(mentions.map((m) => m.name.toLowerCase()));
  for (const m of text.matchAll(/@\[([^\]]+)\]/g)) {
    const name = (m[1] ?? '').toLowerCase();
    if (!verifiedNames.has(name)) {
      v.push({ rule: 'mencao_nao_verificada', detail: `"${m[1]}" marcado sem identidade verificada` });
    }
  }
  for (const m of mentions) {
    const ent = article.entities?.find((e) => e.name.toLowerCase() === m.name.toLowerCase());
    if (!ent?.verified) v.push({ rule: 'mencao_nao_verificada', detail: `"${m.name}" sem identidade verificada` });
  }

  // 3. Limites de tamanho.
  if (text.length > LINKEDIN_MAX_CHARS) v.push({ rule: 'texto_longo', detail: `${text.length} > ${LINKEDIN_MAX_CHARS}` });
  if (firstLine.length > HOOK_MAX_CHARS) v.push({ rule: 'gancho_longo', detail: `${firstLine.length} > ${HOOK_MAX_CHARS}` });

  // 4. Link rastreado e assinatura institucional.
  if (opts.requireLink !== false && (!/utm_source=/.test(text) || !/utm_campaign=/.test(text))) {
    v.push({ rule: 'link_sem_utm', detail: 'link da matéria sem UTM' });
  }
  if (!text.includes(SIGNATURE)) v.push({ rule: 'sem_assinatura', detail: `falta a assinatura "${SIGNATURE}"` });

  // 5. Sem apuração/autoria humana inventada.
  for (const re of FORBIDDEN_CLAIMS) {
    if (re.test(text)) v.push({ rule: 'autoria_inventada', detail: `expressão proibida: ${re.source}` });
  }

  // 6. Hashtags limitadas.
  const tags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (tags.length > MAX_HASHTAGS) v.push({ rule: 'hashtags_demais', detail: `${tags.length} > ${MAX_HASHTAGS}` });

  // 7. Imagem com crédito (se houver imagem de fonte, o crédito precisa constar).
  if (article.approvedImage?.credit && !text.includes(article.approvedImage.credit)) {
    v.push({ rule: 'sem_credito_imagem', detail: 'crédito da imagem ausente no texto' });
  }
  return v;
}

function partitionEntities(entities: Entity[] = []): { verified: MentionPlan[]; plain: string[] } {
  const verified: MentionPlan[] = [];
  const plain: string[] = [];
  for (const e of entities) {
    if (e.verified) verified.push({ name: e.name, ref: e.verified.ref, source: e.verified.source });
    else plain.push(e.name);
  }
  return { verified, plain };
}

/**
 * Gera o texto LinkedIn de uma matéria só a partir dos fatos aprovados. Não acrescenta números,
 * adjetivos de mercado ou citações. Lança CopyRefusal se alguma regra for violada.
 */
export function generateLinkedInCopy(article: Article): LinkedInCopy {
  const { verified, plain } = partitionEntities(article.entities);
  const link = withUtm(article.url, 'linkedin', article);
  const hook = article.title.trim();
  const bullets = article.facts.slice(0, MAX_FACT_BULLETS).map((f) => `• ${f.text.trim()}`);
  const tags = (HASHTAGS[article.editoria] ?? ['#Fidelidade']).slice(0, MAX_HASHTAGS);

  const lines: string[] = [hook, ''];
  if (article.deck?.trim()) lines.push(article.deck.trim(), '');
  lines.push(...bullets, '');
  // Menção verificada: o texto traz o marcador @[Nome], que o publisher resolve na rede; se a rede não
  // suportar menção, o marcador cai para o nome em texto puro (fallback). Sem verificação, texto puro.
  if (verified.length) {
    lines.push(`Citados: ${verified.map((m) => `@[${m.name}]`).join(', ')}`, '');
  }
  lines.push(`Leia a matéria completa: ${link}`);
  if (article.approvedImage?.credit) lines.push(`Imagem: ${article.approvedImage.credit}`);
  lines.push('', `${SIGNATURE} · ${tags.join(' ')}`);

  const text = lines.join('\n');
  const violations = validateCopy(text, article, verified);
  if (violations.length) throw new CopyRefusal(violations);

  return {
    text,
    hook,
    link,
    hashtags: tags,
    mentions: verified,
    plainEntities: plain,
    textOnlyFallback: verified.length === 0,
    violations,
  };
}

/** Converte marcadores @[Nome] em texto puro (fallback quando a API do mLabs não suporta menção). */
export function toPlainText(text: string): string {
  return text.replace(/@\[([^\]]+)\]/g, '$1');
}
