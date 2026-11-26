/**
 * MOCK — dados sintéticos só para desenvolvimento e testes visuais.
 * Nunca são notícias, eventos ou pessoas reais. Toda interface que os renderiza exibe "MOCK".
 */
import { renderThumbnail, svgToDataUri } from '@ln/ui';
import { EDITORIAS } from '../editorias';
import { normalize } from '../format';
import { filterDirectory, KIND_LABEL } from '../intelligence-source';
import type {
  Article,
  CompanyListItem,
  CompanyProfile,
  CompanyRelation,
  MoveEntry,
  MoveReading,
  PersonProfile,
  PersonRole,
  ContentType,
  EntitySummary,
  EventItem,
  MoveItem,
  Page,
  PortalSource,
  TrendingWindow,
} from '../types';

/** Imagem sintética gerada por código (template do design system, com selo MOCK): nunca foto real (Security R7). */
const tpl = (title: string, editoria: string) => svgToDataUri(renderThumbnail({ title, editoria, mock: true }).svg);

const TYPES: ContentType[] = ['noticia', 'analise', 'flash', 'entrevista', 'opiniao'];

const articles: Article[] = EDITORIAS.flatMap((ed, i) =>
  [0, 1].map((n): Article => {
    const idx = i * 2 + n;
    const contentType = TYPES[idx % TYPES.length] as ContentType;
    const day = String(20 - (idx % 18)).padStart(2, '0');
    return {
      slug: `mock-${ed.slug}-${n + 1}`,
      title: `[MOCK] Matéria de teste ${n + 1} em ${ed.name}`,
      subtitle: 'Subtítulo de teste. Conteúdo sintético sem valor editorial.',
      summary: 'Resumo de teste (MOCK). Esta matéria não existe; serve para validar layout e navegação.',
      editoriaSlug: ed.slug,
      contentType,
      authorLabel: 'Redação Loyalty News',
      publishedAt: `2026-11-${day}T10:00:00-03:00`,
      updatedAt: n === 0 ? `2026-11-${day}T15:30:00-03:00` : undefined,
      readingMinutes: 3 + (idx % 5),
      // idx 0: ilustração conceitual (rótulo obrigatório); idx 2: foto com crédito; demais: sem imagem.
      image:
        idx === 0
          ? { src: tpl('Ilustração conceitual de teste', ed.name), alt: 'Ilustração conceitual: cena abstrata de teste (MOCK)', credit: 'Loyalty News', label: 'Ilustração conceitual' }
          : idx === 2
            ? { src: tpl('Imagem de teste com crédito', ed.name), alt: 'Imagem de teste (MOCK)', credit: 'Template de teste (MOCK)', label: null }
            : undefined,
      body: [
        { type: 'heading', text: 'O que aconteceu' },
        { type: 'paragraph', text: 'Parágrafo de teste (MOCK). Nenhum fato real é afirmado aqui.' },
        { type: 'heading', text: 'Por que isso importa' },
        { type: 'paragraph', text: 'Outro parágrafo de teste (MOCK) para validar tipografia e espaçamento.' },
        { type: 'quote', text: 'Citação de teste, sem autor real.', attribution: 'MOCK' },
      ],
      sources: [{ label: 'Fonte de teste (MOCK)', url: 'https://example.com/mock-fonte' }],
      corrections: n === 0 ? [{ at: `2026-11-${day}T16:00:00-03:00`, text: 'Correção de teste (MOCK).' }] : [],
      tags: ['mock', ed.slug],
      mock: true,
    };
  }),
).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

const events: EventItem[] = [
  {
    slug: 'mock-evento-1',
    title: '[MOCK] Evento de teste presencial',
    startsAt: '2026-12-04T09:00:00-03:00',
    timezone: 'America/Sao_Paulo',
    city: 'São Paulo',
    online: false,
    organizer: 'Organizador de teste (MOCK)',
    officialUrl: 'https://example.com/mock-evento-1',
    sourceUrl: 'https://example.com/mock-fonte-evento',
    status: 'validado',
    mock: true,
  },
  {
    slug: 'mock-evento-2',
    title: '[MOCK] Webinar de teste',
    startsAt: '2026-12-11T15:00:00-03:00',
    timezone: 'America/Sao_Paulo',
    online: true,
    organizer: 'Organizador de teste (MOCK)',
    officialUrl: 'https://example.com/mock-evento-2',
    sourceUrl: 'https://example.com/mock-fonte-evento',
    status: 'validado',
    mock: true,
  },
];

const moves: MoveItem[] = [
  {
    id: 'mock-move-1',
    personName: 'Pessoa de Teste (MOCK)',
    companyName: 'Empresa de Teste (MOCK)',
    fromRole: 'Cargo anterior de teste',
    toRole: 'Cargo novo de teste',
    announcedAt: '2026-11-18T09:00:00-03:00',
    sourceUrl: 'https://example.com/mock-move',
    confirmed: true,
    mock: true,
  },
];

// Entity Intelligence MOCK: três organizações sintéticas ligadas entre si (domínio .invalid; nunca empresas reais).
const MOCK_SRC = (n: string) => ({ name: `Fonte de teste ${n} (MOCK)`, url: `https://fonte-${n}.invalid/pagina`, retrievedAt: '2026-11-20T12:00:00.000Z' });
const ORG = {
  a: { id: '00000000-0000-4000-8000-00000000000a', name: 'Empresa de Teste (MOCK)', kind: 'company' as const },
  b: { id: '00000000-0000-4000-8000-00000000000b', name: 'Programa de Teste (MOCK)', kind: 'program' as const },
  c: { id: '00000000-0000-4000-8000-00000000000c', name: 'Associação de Teste (MOCK)', kind: 'association' as const },
};
const rel = (id: string, type: CompanyRelation['type'], direction: 'from' | 'to', other: (typeof ORG)[keyof typeof ORG], n: string): CompanyRelation => ({
  id, type, direction, other, validFrom: '2026-11-20', validatedAt: '2026-11-20T12:00:00.000Z', source: MOCK_SRC(n), mock: true,
});
const companyProfiles: CompanyProfile[] = [
  { ...ORG.a, legalName: 'Empresa de Teste S.A. (MOCK)', source: MOCK_SRC('a'), peopleAvailable: false, mock: true,
    relations: [rel('00000000-0000-4000-8000-0000000000ab', 'parent_of', 'from', ORG.b, 'ab'), rel('00000000-0000-4000-8000-0000000000ac', 'other', 'from', ORG.c, 'ac')] },
  { ...ORG.b, legalName: 'Programa de Teste (MOCK)', source: MOCK_SRC('b'), peopleAvailable: false, mock: true,
    relations: [rel('00000000-0000-4000-8000-0000000000ab', 'parent_of', 'to', ORG.a, 'ab')] },
  { ...ORG.c, legalName: 'Associação de Teste (MOCK)', source: MOCK_SRC('c'), peopleAvailable: false, mock: true,
    relations: [rel('00000000-0000-4000-8000-0000000000ac', 'other', 'to', ORG.a, 'ac')] },
];
const companyItems: CompanyListItem[] = companyProfiles.map((c) => ({
  id: c.id, name: c.name, legalName: c.legalName, kind: c.kind, relationCount: c.relations.length, validatedAt: c.source.retrievedAt, mock: true,
}));
// Pessoas, cargos e um Move MOCK (sintéticos; nunca pessoas reais).
const P1 = { id: '00000000-0000-4000-8000-0000000000f1', name: 'Pessoa de Teste Um (MOCK)' };
const P2 = { id: '00000000-0000-4000-8000-0000000000f2', name: 'Pessoa de Teste Dois (MOCK)' };
const role = (id: string, title: string, org: { id: string; name: string }, validFrom: string, validTo: string | null, n: string): PersonRole => ({
  id, title, company: { id: org.id, name: org.name }, validFrom, validTo, validatedAt: '2026-11-20T12:00:00.000Z', source: MOCK_SRC(n), mock: true,
});
const p1Old = role('00000000-0000-4000-8000-0000000000e1', 'Diretora de Parcerias (MOCK)', ORG.b, '2026-10-01', '2026-11-20', 'p1a');
const p1New = role('00000000-0000-4000-8000-0000000000e2', 'Diretora-Geral (MOCK)', ORG.b, '2026-11-20', null, 'p1b');
const p2Role = role('00000000-0000-4000-8000-0000000000e3', 'Presidente (MOCK)', ORG.c, '2026-11-20', null, 'p2');
const reading = (r: PersonRole): MoveReading => ({ title: r.title, company: r.company, validFrom: r.validFrom, validTo: r.validTo, validatedAt: r.validatedAt ?? r.source.retrievedAt, source: r.source });
const mockMoves: MoveEntry[] = [
  { id: '00000000-0000-4000-8000-0000000000d1', kind: 'title_change', basis: 'observed_diff', person: P1, effectiveDate: null, observedOn: '2026-11-20',
    before: reading(p1Old), after: reading(p1New), mock: true },
];
const personProfiles: PersonProfile[] = [
  { ...P1, profileUrl: null, source: MOCK_SRC('p1'), currentRoles: [p1New], history: [p1Old], moves: mockMoves, mock: true },
  { ...P2, profileUrl: null, source: MOCK_SRC('p2'), currentRoles: [p2Role], history: [], moves: [], mock: true },
];

const companies: EntitySummary[] = companyItems.map((c) => ({ slug: c.id, name: c.name, segment: KIND_LABEL[c.kind], lastReviewedAt: c.validatedAt, mock: true }));
const people: EntitySummary[] = [{ slug: 'mock-pessoa-1', name: 'Pessoa de Teste (MOCK)', mock: true }];

function paginate<T>(all: T[], page = 1, pageSize = 12): Page<T> {
  const p = Math.max(1, page);
  return { items: all.slice((p - 1) * pageSize, p * pageSize), page: p, pageSize, total: all.length };
}

export const mockSource: PortalSource = {
  kind: 'mock',
  async getHighlights() {
    return articles.slice(0, 6);
  },
  async getTrending(_w: TrendingWindow) {
    return articles.slice(0, 6);
  },
  async getLatest(q) {
    let list = articles;
    if (q?.editoriaSlug) list = list.filter((a) => a.editoriaSlug === q.editoriaSlug);
    if (q?.contentType) list = list.filter((a) => a.contentType === q.contentType);
    return paginate(list, q?.page, q?.pageSize);
  },
  async getArticle(slug) {
    const article = articles.find((a) => a.slug === slug);
    return article ? { article } : { article: null };
  },
  async getRelated(article, limit = 3) {
    return articles.filter((a) => a.slug !== article.slug && a.editoriaSlug === article.editoriaSlug).concat(
      articles.filter((a) => a.slug !== article.slug && a.editoriaSlug !== article.editoriaSlug),
    ).slice(0, limit);
  },
  async search(q, page) {
    const n = normalize(q.trim());
    if (!n) return paginate([], page);
    return paginate(
      articles.filter((a) => normalize(`${a.title} ${a.summary} ${a.tags.join(' ')}`).includes(n)),
      page,
    );
  },
  async listEvents() {
    return { items: events };
  },
  async getEvent(slug) {
    const event = events.find((e) => e.slug === slug);
    return event ? { event } : { event: null };
  },
  async listMoves() {
    return moves;
  },
  async listCompanies() {
    return companies;
  },
  async listPeople() {
    return people;
  },
  async getAudience() {
    // Mesmo no mock, métricas de audiência nunca são numéricas (regra 2 do fast-track).
    return {
      realtime: [{ label: 'Usuários ativos', value: null, state: 'unavailable', source: 'GA4', window: 'últimos 30 min' }],
      historical: [{ label: 'Sessões', value: null, state: 'unavailable', source: 'GA4', window: '30 dias' }],
    };
  },
  async getAd() {
    return null;
  },
  async getSiteConfig() {
    return null;
  },
  async getCompanyDirectory(filter) {
    return filterDirectory(companyItems, filter);
  },
  async getCompany(id) {
    const company = companyProfiles.find((c) => c.id === id);
    return company ? { status: 'ok', company } : { status: 'not_found' };
  },
  async getPeopleDirectory(filter = {}) {
    const q = filter.q ? normalize(filter.q) : '';
    const items = personProfiles
      .map((p) => ({ id: p.id, name: p.name, roles: p.currentRoles, mock: true }))
      .filter((p) => (!q || normalize(p.name).includes(q)) && (!filter.companyId || p.roles.some((r) => r.company.id === filter.companyId)));
    return { status: 'ok', items, total: items.length, available: true };
  },
  async getPerson(id) {
    const person = personProfiles.find((p) => p.id === id);
    return person ? { status: 'ok', person } : { status: 'not_found' };
  },
  async getMovesFeed(filter = {}) {
    const items = mockMoves.filter(
      (m) => (!filter.personId || m.person.id === filter.personId) &&
        (!filter.companyId || [m.before?.company.id, m.after?.company.id].includes(filter.companyId)),
    );
    return { status: 'ok', items, total: items.length, available: true };
  },
  async getMove(id) {
    const move = mockMoves.find((m) => m.id === id);
    return move ? { status: 'ok', move } : { status: 'not_found' };
  },
};
