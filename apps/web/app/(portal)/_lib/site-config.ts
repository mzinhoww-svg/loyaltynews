import { createApiHttp, isRawListItem, mapListItem, type RawListItem } from './api-source';
import type { HomeBlock, SiteConfig, SiteEvent, SiteMenuItem, SiteSeo } from './types';

/**
 * Configuração do site publicada no Studio (`GET /api/publico/site`): home por blocos, menus, SEO e links internos.
 * O payload é tratado como DADO NÃO CONFIÁVEL: cada parte é validada e saneada aqui; parte inválida vira `null`
 * (vale o padrão do portal, nunca conteúdo inventado) e nada lança.
 */

const RESERVED = /^\/(api|studio|_next)(\/|$)/i;
const INTERNAL = /^\/(?!\/)[A-Za-z0-9._~\-/%?#=&:@+,;]*$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 500): string | undefined => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : undefined);
const validDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** Caminho interno do portal (fora de /api, /studio e /_next) ou URL http(s). Qualquer outra coisa (javascript:, //host, data:) é recusada. */
export function safeDestino(v: unknown): string | null {
  const s = str(v, 500);
  if (!s) return null;
  if (INTERNAL.test(s)) return RESERVED.test(s) ? null : s;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}
export const isExternal = (href: string) => /^https?:\/\//i.test(href);

function parseMenu(v: unknown): SiteMenuItem[] | null {
  if (!isObj(v) || !Array.isArray(v.itens)) return null;
  const items: SiteMenuItem[] = [];
  for (const raw of v.itens.slice(0, 12)) {
    if (!isObj(raw)) continue;
    const label = str(raw.rotulo, 40);
    const href = safeDestino(raw.destino);
    if (!label || !href) continue;
    const children = (Array.isArray(raw.filhos) ? raw.filhos : []).slice(0, 10).flatMap((f) => {
      if (!isObj(f)) return [];
      const l = str(f.rotulo, 40);
      const h = safeDestino(f.destino);
      return l && h ? [{ label: l, href: h }] : [];
    });
    items.push({ label, href, children });
  }
  return items.length ? items : null;
}

function parseSeo(v: unknown): SiteSeo | null {
  if (!isObj(v)) return null;
  const title = str(v.tituloPadrao, 70);
  const description = str(v.descricaoPadrao, 200);
  if (!title || !description) return null;
  const ogImage = safeDestino(v.imagemOgUrl);
  const ld = isObj(v.jsonLd) ? v.jsonLd : null;
  const orgName = ld ? str(ld.name, 120) : undefined;
  const orgUrl = ld ? safeDestino(ld.url) : null;
  const logo = ld ? safeDestino(ld.logo) : null;
  const sameAs = ld && Array.isArray(ld.sameAs) ? ld.sameAs.slice(0, 10).flatMap((u) => { const d = safeDestino(u); return d && isExternal(d) ? [d] : []; }) : [];
  return {
    title,
    description,
    ogImage: ogImage && isExternal(ogImage) ? ogImage : undefined,
    // Fail-safe: qualquer valor diferente de "indexar" conta como noindex.
    noindex: v.indexacao !== 'indexar',
    organization: orgName && orgUrl && isExternal(orgUrl) ? { name: orgName, url: orgUrl, logo: logo && isExternal(logo) ? logo : undefined, sameAs } : undefined,
  };
}

const cards = (v: unknown) => (Array.isArray(v) ? v.filter(isRawListItem).map((i) => mapListItem(i as RawListItem)) : []);

function parseEvent(v: unknown): SiteEvent | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 120);
  const title = str(v.titulo, 200);
  if (!id || !title || !validDate(v.inicio)) return null;
  const url = safeDestino(v.url);
  return {
    id,
    title,
    startsAt: v.inicio,
    endsAt: validDate(v.fim) ? v.fim : undefined,
    place: str(v.local, 200),
    url: url && isExternal(url) ? url : undefined,
    sponsored: v.patrocinado === true,
  };
}

function parseHome(v: unknown): SiteConfig['home'] {
  if (!isObj(v) || !Array.isArray(v.blocos)) return null;
  const blocks: HomeBlock[] = [];
  for (const b of v.blocos.slice(0, 20)) {
    if (!isObj(b)) continue;
    const id = str(b.id, 40);
    if (!id) continue;
    const title = str(b.titulo, 80);
    switch (b.tipo) {
      case 'destaque':
        blocks.push({ type: 'destaque', id, title, articles: cards(b.materias) });
        break;
      case 'lista_editoria': {
        const editoriaSlug = str(b.editoria, 40);
        if (editoriaSlug) blocks.push({ type: 'lista_editoria', id, title, editoriaSlug, articles: cards(b.materias) });
        break;
      }
      case 'ultimas':
        blocks.push({ type: 'ultimas', id, title, articles: cards(b.materias) });
        break;
      case 'agenda':
        blocks.push({ type: 'agenda', id, title, events: (Array.isArray(b.eventos) ? b.eventos : []).flatMap((e) => { const ev = parseEvent(e); return ev ? [ev] : []; }) });
        break;
      case 'publicidade': {
        const position = str(b.posicao, 40);
        if (position) blocks.push({ type: 'publicidade', id, position });
        break;
      }
      default:
        break; // tipo desconhecido: ignorado
    }
  }
  return blocks.length ? { version: typeof v.versao === 'number' ? v.versao : 0, blocks } : null;
}

function parseInternalLinks(v: unknown): SiteConfig['internalLinks'] {
  if (!Array.isArray(v)) return [];
  const out: SiteConfig['internalLinks'] = [];
  const seen = new Set<string>();
  for (const r of v.slice(0, 100)) {
    if (!isObj(r)) continue;
    const term = str(r.termo, 60);
    const href = safeDestino(r.destino);
    if (!term || term.length < 2 || !href || isExternal(href) || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push({ term, href });
  }
  return out;
}

/** Valida o envelope `{ data: … }` de `/api/publico/site`; formato inesperado ⇒ `null` (padrão do portal). */
export function parseSiteConfig(raw: unknown): SiteConfig | null {
  if (!isObj(raw) || !isObj(raw.data)) return null;
  const d = raw.data;
  const menus = isObj(d.menus) ? d.menus : {};
  return {
    home: parseHome(d.home),
    menus: { main: parseMenu(menus.principal), footer: parseMenu(menus.rodape) },
    seo: parseSeo(d.seo),
    internalLinks: parseInternalLinks(d.linksInternos),
  };
}

const TTL_OK_MS = 60_000;
const TTL_FAIL_MS = 15_000;

/** Cliente de `/api/publico/site` com cache curto em memória (a API já cacheia 60 s; evita 1 chamada por página). */
export function createSiteSlice(baseUrl: string, fetchImpl: typeof fetch = fetch): { getSiteConfig(): Promise<SiteConfig | null> } {
  const { get, logFalha } = createApiHttp(baseUrl, fetchImpl);
  let cache: { until: number; value: SiteConfig | null } | undefined;
  return {
    async getSiteConfig() {
      const now = Date.now();
      if (cache && cache.until > now) return cache.value;
      let value: SiteConfig | null = null;
      const res = await get('/api/publico/site', 'site');
      if (res?.ok) {
        try {
          value = parseSiteConfig(await res.json());
          if (!value) logFalha('site', 'resposta inválida');
        } catch {
          logFalha('site', 'resposta inválida');
        }
      } else if (res) {
        logFalha('site', `status ${res.status}`);
      }
      cache = { until: now + (value ? TTL_OK_MS : TTL_FAIL_MS), value };
      return value;
    },
  };
}

export type LinkedPart = string | { text: string; href: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Links internos publicados: transforma a PRIMEIRA ocorrência de cada termo (sem diferenciar maiúsculas, palavra inteira)
 * em link para o destino interno. `used` é compartilhado entre os parágrafos da mesma matéria. Termos mais longos primeiro,
 * e trechos já transformados em link não são revarridos.
 */
export function linkTerms(text: string, rules: readonly { term: string; href: string }[], used: Set<string>): LinkedPart[] {
  let parts: LinkedPart[] = [text];
  for (const rule of [...rules].sort((a, b) => b.term.length - a.term.length)) {
    const key = rule.term.toLowerCase();
    if (used.has(key)) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(rule.term)}(?![\\p{L}\\p{N}])`, 'iu');
    const next: LinkedPart[] = [];
    let done = false;
    for (const p of parts) {
      if (done || typeof p !== 'string') {
        next.push(p);
        continue;
      }
      const m = re.exec(p);
      if (!m) {
        next.push(p);
        continue;
      }
      done = true;
      used.add(key);
      if (m.index > 0) next.push(p.slice(0, m.index));
      next.push({ text: m[0], href: rule.href });
      if (m.index + m[0].length < p.length) next.push(p.slice(m.index + m[0].length));
    }
    parts = next;
  }
  return parts;
}
