/**
 * Releitura agendada das páginas OFICIAIS de diretoria/administração: detecta Moves por DUAS leituras (a do cadastro e a de agora).
 *
 * DESLIGADO por padrão (`enabled: false`) e só roda com a ingestão de pessoas ligada (`personIngestion`, J-01). Sem as duas coisas, não lê nada.
 * Ritmo baixo: no máximo `maxPagesPerCycle` páginas por ciclo, cada página só se a última validação for mais velha que `intervalHours`
 * (a "última validação" vem do próprio banco; não há tabela de estado). O leitor é injetado (leitura direta com robots, depois provedor DP-32).
 *
 * Regras (as mesmas do produto):
 *  - O texto da página é EFÊMERO: só se grava o fato (nome + cargo), a fonte, o link e a data; nunca a página.
 *  - Ausência NÃO é saída. Citação que sumiu vira "revisão" (relatório), nunca `left`. Única exceção: cargo ÚNICO (Diretor-Presidente/CEO/
 *    Presidente) cuja posição continua na página com OUTRO nome validado => saída do antigo (Move `detected`, revisão humana antes do portal)
 *    e o novo entra como linha de base (primeira leitura da pessoa não é Move).
 *  - Página suspeita (leitura falhou, curta, outro host, poucas citações conhecidas) => nenhuma alteração.
 *  - Só leitura de fonte pública oficial (`sourceLevel: oficial`). LinkedIn/The Org nunca entram aqui.
 */
import { createHash } from 'node:crypto';
import type { Db } from './db';
import type { IntelligenceConfig } from './config';
import { ingestBatch, type RoleObservationBatch } from './ingest';
import { type SeedDataset, SECONDARY_HOSTS, roleTitle } from './seed-load';

export interface RereadConfig {
  /** Padrão false: nada é lido nem gravado. */
  enabled: boolean;
  /** Intervalo mínimo entre leituras da mesma página (piso 24 h). */
  intervalHours: number;
  /** Teto de páginas por ciclo (ritmo baixo). */
  maxPagesPerCycle: number;
  /** Fração mínima das citações conhecidas que precisa estar na página para ela valer como "a mesma página". */
  minFoundRatio: number;
}
export const DEFAULT_REREAD_CONFIG: Readonly<RereadConfig> = Object.freeze({ enabled: false, intervalHours: 168, maxPagesPerCycle: 5, minFoundRatio: 0.5 });

/** `sep` = o que a página põe entre o nome e o cargo (ex.: " ", " | ", " , "); só existe quando a citação é exatamente "Nome<sep>Cargo". */
export interface RereadRole { personName: string; orgName: string; title: string; quote: string; exclusive: boolean; sep?: string }
export interface RereadSource { id: string; name: string; url: string; roles: RereadRole[] }

export interface PageRead { ok: boolean; text?: string; finalUrl?: string; failure?: string }
export type PageReader = (url: string) => Promise<PageRead>;

export type PageStatus = 'not_due' | 'read_failed' | 'page_suspect' | 'unchanged' | 'changed' | 'review';
export interface PageReport { id: string; status: PageStatus; known: number; found: number; missing: number; moves: number; reasons?: string[] }
export interface RereadReport { ran: boolean; skipped?: 'disabled' | 'person_ingestion_disabled'; pages: PageReport[]; moves: number }

/** Cargos únicos (só um titular por vez): o único caso em que a troca de nome na página vira saída do antigo. */
const EXCLUSIVE = /^(diretor[a]?[- ]presidente|presidente|chief executive officer|ceo)\b/i;

/** Páginas a reler = fontes oficiais dos cargos do conjunto (v4/v5). Fonte secundária e cargo do conselho não entram (nada a reler/inferir). */
export function rereadSourcesFromSeed(ds: SeedDataset): RereadSource[] {
  const orgName = new Map(ds.organizations.map((o) => [o.key, o.legalName]));
  const out = new Map<string, RereadSource>();
  for (const r of ds.roles ?? []) {
    if (r.sourceLevel !== 'oficial') continue;
    const src = ds.sources.find((s) => s.id === r.sourceId);
    if (!src || SECONDARY_HOSTS.test(hostOf(src.url))) continue;
    const s = out.get(src.id) ?? { id: src.id, name: src.name, url: src.url, roles: [] };
    const title = roleTitle(r); // o MESMO cargo que o carregador grava (cargo do conselho leva o órgão)
    const q = r.quote.toLowerCase();
    const ti = q.lastIndexOf(r.title.toLowerCase());
    const sep = q.startsWith(r.personName.toLowerCase()) && ti >= r.personName.length && ti + r.title.length === r.quote.length ? r.quote.slice(r.personName.length, ti) : undefined;
    s.roles.push({
      personName: r.personName, orgName: orgName.get(r.orgKey) ?? r.orgKey, title, quote: r.quote,
      exclusive: r.body !== 'conselho' && EXCLUSIVE.test(r.title) && sep !== undefined, sep,
    });
    out.set(src.id, s);
  }
  return [...out.values()];
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const squash = (s: string) => decodeEntities(s).normalize('NFC').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

const NAMED: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ccedil: 'ç', Ccedil: 'Ç', ntilde: 'ñ' };
for (const [b, list] of Object.entries({ a: 'acute:á grave:à circ:â tilde:ã', e: 'acute:é circ:ê', i: 'acute:í', o: 'acute:ó circ:ô tilde:õ', u: 'acute:ú' })) {
  for (const p of list.split(' ')) { const [k, ch] = p.split(':') as [string, string]; NAMED[b + k] = ch; NAMED[b.toUpperCase() + k] = ch.toUpperCase(); }
}
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, k: string) => NAMED[k] ?? m);
}

/** Palavras de cabeçalho/menu que aparecem antes do nome nas tabelas "Nome | Cargo" e nunca fazem parte de um nome. */
const STOP = new Set(['membros', 'membro', 'cargo', 'nome', 'diretoria', 'designação', 'mandato', 'conselho', 'administração', 'executiva', 'estatutária', 'composição', 'home', 'governança', 'corporativa', 'board', 'officers', 'executive', 'management', 'officer', 'members', 'cargos', 'data', 'eleição', 'prazo', 'início', 'término']);
/** Tratamentos/honoríficos: nunca fazem parte do nome ("Dr. João Silva" e "João Silva" são o mesmo titular; sem isso a troca de tratamento viraria falsa saída). */
const HONORIFIC = new Set(['dr', 'dra', 'sr', 'sra', 'srta', 'prof', 'profa', 'eng', 'enga', 'mr', 'mrs', 'ms', 'miss', 'sir', 'dna', 'don', 'doña']);
const PARTICLE = new Set(['de', 'da', 'do', 'dos', 'das', 'di', 'del', 'van', 'von', 'y', 'e', 'la', 'le']);

/**
 * Titular atual de um cargo ÚNICO: as palavras que vêm imediatamente antes do cargo na página (formato "Nome Cargo" ou "Nome | Cargo").
 * Devolve null se o cargo não aparece ou se o que vem antes não parece um nome (2 a 6 palavras iniciadas em maiúscula, partículas permitidas).
 */
export function currentHolder(pageText: string, title: string, sep = ' '): string | null {
  const text = decodeEntities(pageText).replace(/\s+/g, ' ');
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const titleRe = esc(title).replace(/[-‑]/g, '[-‑]');
  // o separador é o mesmo que a citação conhecida usa entre o nome e o cargo (" ", " | ", " , "): evita ler menu/cabeçalho como nome
  const sepRe = sep.trim() === '' ? '\\s+' : `\\s*${esc(sep.trim())}\\s*`;
  const re = new RegExp(`((?:[^\\s|,;:()]+\\s+){0,8}[^\\s|,;:()]+)${sepRe}${titleRe}(?![\\p{L}])`, 'giu');
  for (const m of text.matchAll(re)) {
    const name = nameFrom(m[1]!);
    if (name) return name;
  }
  return null;
}

function nameFrom(before: string): string | null {
  const words = before.trim().split(/\s+/);
  const picked: string[] = [];
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i]!;
    const bare = w.replace(/[|,;:]/g, '');
    if (!bare) break;
    const isName = /^\p{Lu}[\p{L}'’.-]*$/u.test(bare) && !STOP.has(bare.toLowerCase()) && !HONORIFIC.has(bare.toLowerCase().replace(/.$/, ''));
    const isPart = PARTICLE.has(bare.toLowerCase());
    if (!isName && !isPart) break;
    picked.unshift(bare);
  }
  while (picked.length && PARTICLE.has(picked[0]!.toLowerCase())) picked.shift();
  return picked.length >= 2 && picked.length <= 6 ? picked.join(' ') : null;
}

async function lastValidatedAt(db: Db, url: string): Promise<Date | null> {
  const r = await db.query<{ v: string | Date | null }>(
    `SELECT max(r.validated_at) AS v FROM intelligence.role_assignment r JOIN intelligence.evidence e ON e.id = r.evidence_id
      WHERE e.source_url = $1 AND r.valid_to IS NULL AND r.certainty = 'declared'`, [url]);
  return r.rows[0]?.v ? new Date(r.rows[0].v) : null;
}

/** Um ciclo: relê as páginas vencidas (até o teto), compara com o cadastro e ingere pelo contrato role-observation/1. Nunca lança por página ruim. */
export async function runRereadCycle(
  db: Db,
  sources: RereadSource[],
  deps: { read: PageReader; cfg: IntelligenceConfig; config?: Partial<RereadConfig>; now?: () => Date },
): Promise<RereadReport> {
  const conf = { ...DEFAULT_REREAD_CONFIG, ...deps.config };
  if (!conf.enabled) return { ran: false, skipped: 'disabled', pages: [], moves: 0 };
  if (!deps.cfg.personIngestion) return { ran: false, skipped: 'person_ingestion_disabled', pages: [], moves: 0 };
  const now = deps.now?.() ?? new Date();
  const intervalMs = Math.max(conf.intervalHours, 24) * 3_600_000;
  const pages: PageReport[] = [];
  let reads = 0, moves = 0;
  for (const src of sources) {
    const base = { id: src.id, known: src.roles.length, found: 0, missing: 0, moves: 0 };
    const last = await lastValidatedAt(db, src.url);
    if (last && now.getTime() - last.getTime() < intervalMs) { pages.push({ ...base, status: 'not_due' }); continue; }
    if (reads >= conf.maxPagesPerCycle) { pages.push({ ...base, status: 'not_due', reasons: ['teto de páginas do ciclo'] }); continue; }
    reads++;
    let page: PageRead;
    try { page = await deps.read(src.url); } catch { page = { ok: false, failure: 'exceção na leitura' }; }
    if (!page.ok || !page.text) { pages.push({ ...base, status: 'read_failed', reasons: [page.failure ?? 'sem texto'] }); continue; }
    if (page.finalUrl && hostOf(page.finalUrl) !== hostOf(src.url)) { pages.push({ ...base, status: 'page_suspect', reasons: ['a página respondeu de outro host'] }); continue; }
    if (page.text.length < 800) { pages.push({ ...base, status: 'page_suspect', reasons: ['texto curto (bloqueio ou página dependente de JavaScript)'] }); continue; }
    const text = squash(page.text);
    const found = src.roles.filter((r) => text.includes(squash(r.quote)));
    const missing = src.roles.filter((r) => !found.includes(r));
    // Página com poucos cargos conhecidos (até 2) não tem como atingir a fração mínima: vale se o cargo único continua na página, na MESMA forma "Nome<sep>Cargo".
    const slotKept = src.roles.length <= 2 && missing.some((r) => r.exclusive && currentHolder(page.text ?? '', r.title, r.sep) !== null);
    if (found.length / src.roles.length < conf.minFoundRatio && !slotKept) { pages.push({ ...base, found: found.length, missing: missing.length, status: 'page_suspect', reasons: ['poucas citações conhecidas na página'] }); continue; }

    const retrievedAt = now.toISOString();
    const hash = `sha256:${createHash('sha256').update(page.text).digest('hex')}`;
    const batch = (excerpt: string, observations: RoleObservationBatch['observations']): RoleObservationBatch => ({
      schemaVersion: 'role-observation/1',
      evidence: { sourceUrl: src.url, sourceName: src.name, retrievedAt, contentHash: hash, excerpt: excerpt.slice(0, 500), isMock: false },
      observations,
    });
    let pageMoves = 0;
    const reasons: string[] = [];
    for (const r of found) {
      await ingestBatch(db, batch(r.quote, [{ personName: r.personName, orgName: r.orgName, title: r.title, kind: 'present', observedAt: retrievedAt }]), deps.cfg);
    }
    for (const r of missing) {
      const holder = r.exclusive ? currentHolder(page.text, r.title, r.sep) : null;
      if (holder && squash(holder) !== squash(r.personName)) {
        const q = `${holder} ${r.title}`;
        const rep = await ingestBatch(db, batch(q, [
          { personName: r.personName, orgName: r.orgName, title: r.title, kind: 'left', observedAt: retrievedAt },
          { personName: holder, orgName: r.orgName, title: r.title, kind: 'present', observedAt: retrievedAt },
        ]), deps.cfg);
        pageMoves += rep.counts.moves;
        reasons.push(`cargo único "${r.title}" (${r.orgName}): titular diferente na página; saída registrada para revisão`);
      } else reasons.push(`citação não encontrada: ${r.orgName} / ${r.title} (sem alteração; revisão humana)`);
    }
    moves += pageMoves;
    pages.push({ ...base, found: found.length, missing: missing.length, moves: pageMoves, reasons: reasons.length ? reasons : undefined, status: pageMoves ? 'changed' : missing.length ? 'review' : 'unchanged' });
  }
  return { ran: true, pages, moves };
}
