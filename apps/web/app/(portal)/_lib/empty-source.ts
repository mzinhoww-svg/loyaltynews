import type { PortalSource, Page } from './types';

const emptyPage = <T>(page = 1, pageSize = 12): Page<T> => ({ items: [], page, pageSize, total: 0 });

/**
 * Fonte padrão enquanto não há conteúdo real: tudo vazio.
 * As páginas mostram estado vazio honesto; nada é inventado.
 */
export const emptySource: PortalSource = {
  kind: 'empty',
  async getHighlights() {
    return [];
  },
  async getTrending() {
    return [];
  },
  async getLatest(q) {
    return emptyPage(q?.page, q?.pageSize);
  },
  async getArticle() {
    return { article: null };
  },
  async getRelated() {
    return [];
  },
  async search(_q, page) {
    return emptyPage(page);
  },
  async listEvents() {
    return { items: [] };
  },
  async getEvent() {
    return { event: null };
  },
  async listMoves() {
    return [];
  },
  async listCompanies() {
    return [];
  },
  async listPeople() {
    return [];
  },
  async getAudience() {
    // Nunca métricas fictícias: tudo indisponível até integração real (GA4 etc.).
    return {
      realtime: [
        { label: 'Usuários ativos', value: null, state: 'unavailable', source: 'GA4', window: 'últimos 30 min' },
      ],
      historical: [
        { label: 'Sessões', value: null, state: 'unavailable', source: 'GA4', window: '30 dias' },
        { label: 'Usuários', value: null, state: 'unavailable', source: 'GA4', window: '30 dias' },
        { label: 'Visualizações', value: null, state: 'unavailable', source: 'GA4', window: '30 dias' },
        { label: 'LinkedIn', value: null, state: 'unavailable', source: 'API / importação validada' },
        { label: 'The Loyal', value: null, state: 'unavailable', source: 'Provedor de e-mail' },
      ],
    };
  },
  async getAd() {
    return null;
  },
  async getSiteConfig() {
    return null;
  },
  async getCompanyDirectory() {
    return { status: 'ok', items: [], total: 0, kinds: [] };
  },
  async getCompany() {
    return { status: 'not_found' };
  },
};
