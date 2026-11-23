/**
 * MOCK — dados sintéticos só para desenvolvimento e testes visuais.
 * Nunca são notícias, eventos ou pessoas reais. Toda interface que os renderiza exibe "MOCK".
 */
import { renderThumbnail, svgToDataUri } from '@ln/ui';
import { EDITORIAS } from '../editorias';
import { normalize } from '../format';
import type {
  Article,
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

const companies: EntitySummary[] = [
  { slug: 'mock-empresa-1', name: 'Empresa de Teste (MOCK)', segment: 'Programas de fidelidade', mock: true },
];
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
    return articles.find((a) => a.slug === slug) ?? null;
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
    return events;
  },
  async getEvent(slug) {
    return events.find((e) => e.slug === slug) ?? null;
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
};
