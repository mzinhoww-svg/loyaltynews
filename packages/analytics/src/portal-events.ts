import { z } from 'zod';
import { EditoriaSlug } from '@ln/contracts';
import { CollectEventSchema, DEVICE_CLASSES, REFERRER_CATEGORIES, classifyReferrer, deviceClass, normalizePath } from './event';

// CONTRATO ÚNICO dos eventos do portal (Integration, 26/11/2026).
//
// Um só vocabulário para o que o portal mede: `page_view`, `article_read` e `search`. Cada evento tem nome, propriedades
// fechadas e a hora em que dispara; nada de identificador de pessoa, sessão, cookie, IP, user agent ou texto livre sem
// tratamento. Qualquer campo fora da lista é RECUSADO (`.strict()`), e nomes que cheiram a dado pessoal são recusados
// antes mesmo do schema, com código próprio.
//
// Estado: contrato definido e testado; a rota `POST /api/analytics/collect` ainda fala o formato antigo (`pageview`).
// `fromLegacyCollect` traduz o formato antigo para este contrato, para a migração não quebrar o cliente atual.
// O que falta para ligar em produção está em `packages/analytics/docs/eventos-portal.md`.

export const PORTAL_EVENT_NAMES = ['page_view', 'article_read', 'search'] as const;
export type PortalEventName = (typeof PORTAL_EVENT_NAMES)[number];

/**
 * Campos proibidos por nome. A lista é conservadora de propósito: recusa antes de olhar o valor. Um campo legítimo
 * que caia aqui deve ser renomeado (ex.: `editoria`, não `nome`).
 */
export const PII_FIELDS = [
  // `name` NÃO entra na lista: no contrato ele é o nome do evento (page_view, article_read, search). `nome` (pessoa) entra.
  'email', 'e-mail', 'nome', 'telefone', 'phone', 'celular', 'cpf', 'cnpj', 'documento', 'rg',
  'token', 'cookie', 'ip', 'senha', 'password', 'session', 'session_id', 'sessionid',
  'user_id', 'userid', 'autor', 'author', 'contato', 'endereco', 'endereço',
] as const;

/** Um evento do contrato, com o que ele carrega e quando dispara. Serve de documentação viva e de teste. */
export interface PortalEventSpec {
  name: PortalEventName;
  /** Propriedades aceitas, na ordem do schema. */
  properties: readonly string[];
  /** Quando o cliente dispara. */
  when: string;
  /** Regra de dado pessoal. */
  pii: 'nenhum';
}

export const PORTAL_EVENTS: readonly PortalEventSpec[] = [
  {
    name: 'page_view',
    properties: ['path', 'referrer?', 'device?'],
    when: 'Uma vez por navegação de página do portal, depois do consentimento de medição. `path` é o caminho normalizado (sem query, sem fragmento, identificadores viram `:id`).',
    pii: 'nenhum',
  },
  {
    name: 'article_read',
    properties: ['articleId', 'slug', 'editoria', 'readSeconds'],
    when: 'Uma vez por matéria por sessão, quando o leitor passa de 30 s de leitura ativa OU de 75% do texto, o que vier primeiro. Não dispara em prévia, paywall ou leitura de robô.',
    pii: 'nenhum',
  },
  {
    name: 'search',
    properties: ['query', 'resultCount', 'editoria?'],
    when: 'Uma vez por busca executada (Enter ou botão), com o termo já redigido e truncado e o total de resultados. Não dispara em busca vazia nem em sugestão automática.',
    pii: 'nenhum',
  },
];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

export const PageViewEventSchema = z
  .object({
    name: z.literal('page_view'),
    path: z.string().min(1).max(300),
    referrer: z.enum(REFERRER_CATEGORIES).optional(),
    device: z.enum(DEVICE_CLASSES).optional(),
  })
  .strict();

export const ArticleReadEventSchema = z
  .object({
    name: z.literal('article_read'),
    articleId: z.uuid(),
    slug: z.string().regex(SLUG_RE),
    editoria: EditoriaSlug,
    readSeconds: z.number().int().min(3).max(3600),
  })
  .strict();

export const SearchEventSchema = z
  .object({
    name: z.literal('search'),
    query: z.string().min(2).max(120),
    resultCount: z.number().int().min(0).max(1000),
    editoria: EditoriaSlug.optional(),
  })
  .strict();

export const PORTAL_EVENT_SCHEMAS = {
  page_view: PageViewEventSchema,
  article_read: ArticleReadEventSchema,
  search: SearchEventSchema,
} as const;

export const PortalEventSchema = z.discriminatedUnion('name', [PageViewEventSchema, ArticleReadEventSchema, SearchEventSchema]);
export type PortalEvent = z.infer<typeof PortalEventSchema>;

export type PortalEventParse =
  | { ok: true; event: PortalEvent }
  | { ok: false; code: 'campo_pessoal'; fields: string[] }
  | { ok: false; code: 'evento_invalido'; details: unknown };

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
/** Telefone: 10–11 dígitos contíguos, ou DDD entre parênteses com 8–9 dígitos. Evita casar intervalo de anos. */
const PHONE_RE = /\b\d{10,11}\b|\(\d{2}\)\s?\d{4,5}[\s-]?\d{4}/;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/**
 * Termo de busca é o único texto livre do contrato. Regra: aparar, colapsar espaços, cortar em 120 caracteres e, se
 * parecer e-mail, CPF, telefone ou UUID, virar `:redigido`. Nome de pessoa não é detectável por padrão; por isso o
 * termo nunca é ligado a sessão, conta ou IP — é só um termo de busca agregável.
 */
export function redactSearchQuery(raw: string): string {
  const q = raw.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!q) return q;
  if (EMAIL_RE.test(q) || CPF_RE.test(q) || PHONE_RE.test(q) || UUID_RE.test(q)) return ':redigido';
  return q;
}

/** Interpreta um evento cru: recusa campo pessoal pelo nome, valida o schema e aplica as normalizações do contrato. */
export function parsePortalEvent(raw: unknown): PortalEventParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, code: 'evento_invalido', details: 'corpo não é objeto' };
  const pessoais = Object.keys(raw).filter((k) => (PII_FIELDS as readonly string[]).includes(k.toLowerCase()));
  if (pessoais.length) return { ok: false, code: 'campo_pessoal', fields: pessoais };

  const p = PortalEventSchema.safeParse(raw);
  if (!p.success) return { ok: false, code: 'evento_invalido', details: p.error.issues.map((i) => i.path.join('.') || '(raiz)') };
  const e = p.data;

  if (e.name === 'page_view') {
    const path = normalizePath(e.path);
    if (!path) return { ok: false, code: 'evento_invalido', details: ['path'] };
    return { ok: true, event: { ...e, path } };
  }
  if (e.name === 'search') {
    const query = redactSearchQuery(e.query);
    if (query.length < 2) return { ok: false, code: 'evento_invalido', details: ['query'] };
    return { ok: true, event: { ...e, query } };
  }
  return { ok: true, event: e };
}

/**
 * Traduz o formato antigo da rota (`{ t: 'pageview', path, ref?, w? }`) para o contrato. Devolve `null` quando o
 * evento não é aproveitável. `ownHosts` classifica referência interna, como no handler atual.
 */
export function fromLegacyCollect(raw: unknown, ownHosts: readonly string[] = []): PortalEvent | null {
  const p = CollectEventSchema.safeParse(raw);
  if (!p.success) return null;
  const path = normalizePath(p.data.path);
  if (!path) return null;
  return { name: 'page_view', path, referrer: classifyReferrer(p.data.ref, ownHosts), device: deviceClass(p.data.w) };
}
