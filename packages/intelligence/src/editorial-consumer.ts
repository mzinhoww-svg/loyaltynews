/**
 * Consumidor Editorial → Intelligence.
 * Transforma matérias PUBLICADAS (packages/editorial) em observações de cargo `role-observation/1` e chama a ingestão.
 *
 * Interface estrutural: não importa @ln/editorial (acoplamento zero); o Editorial entrega `PublishedArticle` (um
 * subconjunto do que já tem em Evidence/Draft) e, opcionalmente, as `RoleMention` já extraídas pelo seu estágio
 * (humano ou regra). Se vierem só o texto, aplica-se `extractRoleMentions` (regras determinísticas, baixa
 * cobertura de propósito: prefere deixar passar a inventar vínculo).
 *
 * Regras:
 *  - Só matéria `published`. Rascunho/revisão: ignorado.
 *  - Flag `intelligencePessoas` desligada (padrão): só ORGANIZAÇÕES são registradas; nenhuma pessoa é criada.
 *  - Ligada: cada menção vira uma observação (nome, cargo, empresa; fonte pública = a matéria). Moves nascem `detected`
 *    e dependem de revisão antes de aparecer no portal.
 *  - Idempotente: mesma URL + mesmo hash de conteúdo não é ingerida duas vezes.
 *  - `announced` só quando a própria matéria anuncia a mudança; sem isso, primeira vista é linha de base, não Move.
 */
import type { Db } from './db';
import { DEFAULT_CONFIG, type IntelligenceConfig } from './config';
import { INGEST_SCHEMA_VERSION, ingestBatch, type IngestReport } from './ingest';
import { addEvidence, upsertOrganization } from './repo';

export interface PublishedArticle {
  id: string;
  status: 'published' | string;
  /** URL canônica pública da matéria/fonte. */
  url: string;
  sourceName: string;
  /** ISO 8601 com fuso: instante da coleta. */
  fetchedAt: string;
  publishedAt?: string | null;
  contentSha256?: string;
  headline?: string;
  /** Texto saneado da matéria (usado só se não vierem `mentions`). */
  text?: string;
  isMock?: boolean;
}

export interface RoleMention {
  personName: string;
  publicProfileUrl?: string;
  orgName: string;
  title: string;
  kind: 'present' | 'left';
  /** A própria matéria anuncia a mudança (nomeação, saída, troca). */
  announced?: boolean;
  /** AAAA-MM-DD, só se a matéria traz a data de vigência. */
  effectiveDate?: string;
  /** Trecho da matéria que sustenta a menção (até 500 caracteres). */
  excerpt: string;
}

export interface ArticleRoleInput {
  article: PublishedArticle;
  mentions?: RoleMention[];
}

export type ConsumeResult =
  | { status: 'skipped'; reason: 'not_published' | 'already_ingested' | 'no_mentions' | 'invalid_article'; issues?: string[] }
  | {
      status: 'organizations_only';
      reason: 'flag_intelligencePessoas_off';
      organizations: number;
      persons_skipped: number;
    }
  | { status: 'ingested'; mentions: number; processed: number; rejected: number; moves: number; reports: IngestReport[] };

const MAX_EXCERPT = 500;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Menções → lotes `role-observation/1` (um lote por menção: cada uma carrega o próprio trecho como evidência). */
export function mentionsToBatches(article: PublishedArticle, mentions: RoleMention[]) {
  const observedAt = article.publishedAt ?? article.fetchedAt;
  return mentions.map((m) => ({
    schemaVersion: INGEST_SCHEMA_VERSION,
    evidence: {
      sourceUrl: article.url,
      sourceName: article.sourceName,
      retrievedAt: article.fetchedAt,
      ...(article.contentSha256 ? { contentHash: article.contentSha256 } : {}),
      excerpt: clip(m.excerpt, MAX_EXCERPT),
      ...(article.isMock ? { isMock: true } : {}),
    },
    observations: [
      {
        personName: m.personName,
        ...(m.publicProfileUrl ? { publicProfileUrl: m.publicProfileUrl } : {}),
        orgName: m.orgName,
        title: m.title,
        kind: m.kind,
        observedAt,
        ...(m.announced ? { announcement: m.effectiveDate ? { effectiveDate: m.effectiveDate } : {} } : {}),
      },
    ],
  }));
}

export async function consumeArticle(db: Db, input: ArticleRoleInput, cfg: IntelligenceConfig = DEFAULT_CONFIG): Promise<ConsumeResult> {
  const { article } = input;
  if (article.status !== 'published') return { status: 'skipped', reason: 'not_published' };
  const issues: string[] = [];
  if (!/^https?:\/\/\S+$/i.test(article.url ?? '')) issues.push('url');
  if (!article.sourceName?.trim()) issues.push('sourceName');
  if (!article.fetchedAt || Number.isNaN(Date.parse(article.fetchedAt))) issues.push('fetchedAt');
  if (issues.length) return { status: 'skipped', reason: 'invalid_article', issues };

  const mentions = input.mentions ?? extractRoleMentions(article.text ?? '');
  if (mentions.length === 0) return { status: 'skipped', reason: 'no_mentions' };

  if (article.contentSha256) {
    const dup = await db.query(`SELECT 1 FROM intelligence.evidence WHERE source_url = $1 AND content_hash = $2 LIMIT 1`, [article.url, article.contentSha256]);
    if (dup.rows[0]) return { status: 'skipped', reason: 'already_ingested' };
  }

  if (!cfg.personIngestion) {
    // Flag desligada (J-01): só organizações. Nenhuma pessoa, cargo ou Move é criado.
    const evidenceId = await addEvidence(db, {
      sourceUrl: article.url, sourceName: article.sourceName, retrievedAt: article.fetchedAt,
      contentHash: article.contentSha256, excerpt: clip(article.headline ?? mentions[0]!.excerpt, MAX_EXCERPT), isMock: article.isMock,
    });
    const names = [...new Set(mentions.map((m) => m.orgName.trim()).filter(Boolean))].sort();
    for (const legalName of names) await upsertOrganization(db, { legalName, evidenceId, observedAt: article.publishedAt ?? article.fetchedAt });
    return { status: 'organizations_only', reason: 'flag_intelligencePessoas_off', organizations: names.length, persons_skipped: mentions.length };
  }

  const reports: IngestReport[] = [];
  for (const batch of mentionsToBatches(article, mentions)) reports.push(await ingestBatch(db, batch, cfg));
  const items = reports.flatMap((r) => r.items);
  const processed = items.filter((i) => i.status === 'processed').length;
  return {
    status: 'ingested', mentions: mentions.length, processed, rejected: mentions.length - processed,
    moves: reports.reduce((n, r) => n + r.counts.moves, 0), reports,
  };
}

// ---------------------------------------------------------------------------------------------
// Extrator determinístico (regras). Cobertura baixa de propósito; nunca infere o que a frase não diz.
// ---------------------------------------------------------------------------------------------

const CAP = '[A-ZÀ-Ú][a-zà-ú]+';
const NAME = `${CAP}(?: (?:d[aeo]s?|e) ${CAP}| ${CAP}){1,4}`;
const ORG = `[A-ZÀ-Ú][\\wÀ-ú.&'-]*(?: [A-ZÀ-Ú0-9][\\wÀ-ú.&'-]*)*`;
const TITLE = `[a-zà-ú]+(?: (?:d[aeo]s?|e|em) [A-Za-zÀ-ú]+| [A-Za-zÀ-ú]+)*?`;
// 'de' fica de fora: faz parte do cargo ("diretora de Marketing"); sem ele a empresa nunca é confundida com a área.
const PREP = '(?:da|do|na|no|em)';

const APPOINT = new RegExp(
  `(${NAME}) (?:foi nomead[oa] |é o novo |é a nova |assume |assumiu |passa a ser )(?:como |o cargo de |a |o )?(${TITLE}) ${PREP} (${ORG})`,
);
const DEPART = new RegExp(
  `(${NAME}) (?:deixa |deixou |deixará |sai d[ao] |saiu d[ao] |renunciou a[oà] )(?:o cargo de |a |o )?(${TITLE}) ${PREP} (${ORG})`,
);

const upper1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const trimOrg = (s: string) => {
  const t = s.replace(/[,;:]+$/, '').trim();
  return t.endsWith('S.A.') ? t : t.replace(/\.+$/, '');
};

/** Menções de cargo em frases de anúncio ("X foi nomeada diretora de Y da Empresa Z"). Só frases que a matéria afirma. */
export function extractRoleMentions(text: string): RoleMention[] {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú])/);
  const out: RoleMention[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    for (const [re, kind] of [[APPOINT, 'present'], [DEPART, 'left']] as const) {
      const m = re.exec(sentence);
      if (!m) continue;
      const mention: RoleMention = {
        personName: m[1]!.trim(), title: upper1(m[2]!.trim()), orgName: trimOrg(m[3]!), kind, announced: true, excerpt: clip(sentence.trim(), MAX_EXCERPT),
      };
      const key = `${mention.personName}|${mention.orgName}|${mention.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(mention);
    }
  }
  return out;
}
