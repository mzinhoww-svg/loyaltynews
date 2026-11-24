import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Collector, SITEMAP_MAX_PAGES_PER_RUN } from '../collector/collector';
import { collectFromSources } from '../factory/collect';
import { InMemoryEditorialStore } from '../api/store';
import type { Actor, HandlerCtx } from '../api/handlers';
import { reviewSource, setSourceEnabled } from '../api/source-handlers';
import { SourceRegistry, eligibility } from '../sources/registry';
import { SEED_SOURCES } from '../sources/seed';
import { SEED_PROGRAMA_SOURCES } from '../sources/seed-programas';
import { sourceTier } from '../types';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MockFetcher } from '../../fixtures/mock-web.mock';

// DP-51: sites oficiais dos programas de fidelidade no banco de fontes (só páginas públicas, nunca atrás de login). Offline: recortes REAIS dos sitemaps (24/11).
const fx = (n: string) => readFileSync(new URL(`../../fixtures/programas/${n}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ids = SEED_PROGRAMA_SOURCES.map((s) => s.id);
const INERTES = ['dotz-site', 'km-de-vantagens', 'petrobras-premmia'];
const COLETAVEIS = ['smiles-conteudo', 'latampass-novidades', 'latampass-regulamentos', 'livelo-programa', 'esfera-campanhas'];
const LOGIN = /login|entrar|minha-conta|meu-perfil|\/profile|checkout|\/cart|autologin|logout|\/conta\b|senha/i;

describe('cadastro dos sites dos programas', () => {
  it('8 fontes novas (5 coletáveis por sitemap e 3 só cadastro), ids únicos no banco inteiro, todas de programa (emissor primário) e nenhuma habilitada', () => {
    expect(ids.sort()).toEqual([...COLETAVEIS, ...INERTES].sort());
    expect(new Set(SEED_SOURCES.map((s) => s.id)).size).toBe(SEED_SOURCES.length);
    for (const s of SEED_PROGRAMA_SOURCES) {
      expect(s.kind, s.id).toBe('loyalty_program'); expect(sourceTier(s.kind), s.id).toBe('primary');
      expect(SEED_SOURCES.includes(s), `${s.id} está em SEED_SOURCES`).toBe(true);
      expect(s.enabled, `${s.id}: habilitar é do admin no Studio`).toBe(false);
      expect(s.termsStatus, s.id).toBe('pending'); expect(s.urlVerified, s.id).toBe(false);
      expect(eligibility(s).ok, `${s.id}: sem revisão não é elegível`).toBe(false);
      expect(s.robotsRespected, s.id).toBe(true); expect(s.paywall, s.id).toBe('none');
      expect(s.imageRights, `${s.id}: nenhuma imagem de fonte (D08)`).toBeNull();
      expect(s.verification?.researchedBy).toBe('ln-editorial-engineer'); expect(s.verification?.consultedAt).toBe('2026-11-24');
      expect(s.verification?.robots).toBe('permitido'); expect(s.verification!.robotsNote.length, s.id).toBeGreaterThan(40);
    }
  });

  it('só páginas públicas, https e no host da fonte; nenhum endereço de login/conta/checkout; fontes de sitemap com prefixo estreito', () => {
    for (const s of SEED_PROGRAMA_SOURCES) {
      for (const u of [s.listingUrl, s.sitemapUrl, s.feedUrl, s.termsUrl]) if (u) expect(u, `${s.id}: ${u}`).toMatch(/^https:\/\//);
      for (const u of [s.listingUrl, s.sitemapUrl]) if (u) expect(new URL(u).host, `${s.id}: ${u}`).toBe(s.host);
      for (const t of [s.listingUrl, s.sitemapUrl, s.sitemapPathPrefix, s.pathPrefix]) if (t) expect(t, `${s.id}: ${t}`).not.toMatch(LOGIN);
      expect(s.maxRequestsPerHour, s.id).toBeGreaterThanOrEqual(6);
      if (s.sitemapUrl) {
        expect(s.sitemapPathPrefix, `${s.id}: sitemap sem prefixo não é coletado`).toMatch(/^\/[a-z0-9/-]+$/); expect(s.sitemapPathPrefix!.length).toBeGreaterThan(8);
        expect(s.feedUrl, s.id).toBeNull();
      }
    }
    // os 3 sem feed nem sitemap dizem por quê (e o coletor os trata como "sem feed", sem erro)
    for (const id of INERTES) {
      const s = SEED_PROGRAMA_SOURCES.find((x) => x.id === id)!;
      expect(s.feedUrl, id).toBeNull(); expect(s.sitemapUrl ?? null, id).toBeNull();
      expect(s.verification!.notes, id).toMatch(/^NÃO coletável hoje/);
    }
  });

  it('o documento docs/fontes-programas.md cita cada fonte nova, as que ficaram de fora e a regra de nunca entrar atrás de login', () => {
    const doc = readFileSync(new URL('../../docs/fontes-programas.md', import.meta.url), 'utf8');
    for (const id of ids) expect(doc, id).toContain('`' + id + '`');
    for (const fora of ['Azul Fidelidade', 'C6 Átomos', 'Itaú (Iupp)', 'Multiplus', 'Stix']) expect(doc, fora).toContain(fora);
    expect(doc).toMatch(/Nunca atrás de login ou paywall/); expect(doc).toMatch(/nenhuma está habilitada|Nenhuma está habilitada/);
  });

  it('janela de 1 h por HOST: quem divide host com outra fonte tem limite para a rodada conjunta (robots uma vez + sitemap e 5 páginas por fonte)', () => {
    const porHost = new Map<string, typeof SEED_SOURCES>();
    for (const s of SEED_SOURCES) porHost.set(s.host, [...(porHost.get(s.host) ?? []), s]);
    const PAGINAS = SITEMAP_MAX_PAGES_PER_RUN;
    for (const [host, lista] of porHost) {
      if (!lista.some((s) => SEED_PROGRAMA_SOURCES.includes(s)) || lista.length < 2) continue;
      let usadas = 0;
      lista.forEach((s, i) => {
        const precisa = (i === 0 ? 1 : 0) + (s.sitemapUrl ? 1 + PAGINAS : 0);
        if (SEED_PROGRAMA_SOURCES.includes(s)) expect(s.maxRequestsPerHour, `${host}: ${s.id} (já usadas ${usadas}, precisa ${precisa})`).toBeGreaterThanOrEqual(usadas + precisa);
        usadas += Math.min(s.maxRequestsPerHour, precisa);
      });
    }
  });
});

describe('coleta offline com recortes reais dos sitemaps (config real do seed)', () => {
  const N = new Date('2026-11-24T12:00:00Z');
  const chefe: Actor = { userId: 'ensaio-chefe', roles: ['editor_chefe'], mfa: true };
  const admin: Actor = { userId: 'ensaio-admin', roles: ['admin'], mfa: true };
  const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/g)].map((m) => m[1]!).filter((u) => u.split('://').length === 2);
  const page = (u: string) => `<html><head><title>Página ${u.split('/').pop()}</title></head><body><article><h1>Página ${u.split('/').pop()}</h1><p>Texto de ensaio do programa, usado só em teste offline, sem relação com notícia real: ${u}.</p></article></body></html>`;
  const sit = { smiles: fx('smiles-sitemap.sample.xml'), latam: fx('latampass-br-pt.sample.xml'), livelo: fx('livelo-static.sample.xml'), esfera: fx('esfera-static.sample.xml') };

  async function rodada() {
    const routes: Record<string, string> = {
      'https://www.smiles.com.br/robots.txt': 'User-agent: *\nDisallow:/*?*\nDisallow:/*.pdf\n',
      'https://latampass.latam.com/robots.txt': 'User-agent: *\n',
      'https://www.livelo.com.br/robots.txt': 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /autologin\nDisallow: /logout\nDisallow: /redirect-login-page\n',
      'https://www.esfera.com.vc/robots.txt': 'User-agent: *\nDisallow: /cart\nDisallow: /checkout\nDisallow: /profile\nDisallow: /searchresults\nDisallow: /confirmation\nDisallow: /discountutils\n',
      'https://www.smiles.com.br/sitemap.xml': sit.smiles, 'https://latampass.latam.com/br/pt.sitemap.xml': sit.latam,
      'https://www.livelo.com.br/sitemap/static-sitemap-0.xml': sit.livelo, 'https://www.esfera.com.vc/staticSitemap.xml': sit.esfera,
    };
    for (const x of Object.values(sit)) for (const u of locs(x)) routes[u] = page(u);
    const fetcher = new MockFetcher(routes);
    const store = new InMemoryEditorialStore();
    const registry = new SourceRegistry(SEED_PROGRAMA_SOURCES);
    const ctx = (a: Actor): HandlerCtx => ({ actor: a, store, sources: registry, now: () => N, newId: () => 'i' });
    for (const id of ids) {
      expect((await reviewSource(ctx(chefe), { sourceId: id, termsStatus: 'approved', termsNote: 'ENSAIO: revisão simulada em memória; nenhum ato humano real.', urlVerified: true, robotsChecked: true, paywall: 'none' })).status, id).toBe(200);
      expect((await setSourceEnabled(ctx(admin), { sourceId: id, enabled: true })).status, id).toBe(200);
    }
    const collector = new Collector(fetcher, { now: () => N, sleep: async () => undefined, resolver: new FakeResolver({ 'www.smiles.com.br': [[MOCK_PUBLIC_IP]], 'latampass.latam.com': [[MOCK_PUBLIC_IP]], 'www.livelo.com.br': [[MOCK_PUBLIC_IP]], 'www.esfera.com.vc': [[MOCK_PUBLIC_IP]], 'www.dotz.com.br': [[MOCK_PUBLIC_IP]], 'www.ipiranga.com.br': [[MOCK_PUBLIC_IP]], 'www.postospetrobras.com.br': [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON });
    const out = await collectFromSources({ store, registry, collector }, {}); // limite padrão do worker (20): o teto de 5 é que segura
    return { out, fetcher, rep: (id: string) => out.sources.find((s) => s.sourceId === id)! };
  }

  it('cada fonte coletável traz só páginas do seu prefixo público (no máximo 5), sem login/checkout; as 3 de cadastro ficam "sem feed" e nada é requisitado delas', async () => {
    const { out, fetcher, rep } = await rodada();
    const urlsDe = (id: string) => out.items.filter((i) => i.sourceId === id).map((i) => i.evidence.url);
    for (const s of SEED_PROGRAMA_SOURCES.filter((x) => x.sitemapUrl)) {
      const r = rep(s.id); const us = urlsDe(s.id);
      expect(r.status, s.id).toBe('collected');
      expect(us.length, `${s.id}: ao menos 1 página`).toBeGreaterThanOrEqual(1); expect(us.length, `${s.id}: teto de ${SITEMAP_MAX_PAGES_PER_RUN}`).toBeLessThanOrEqual(SITEMAP_MAX_PAGES_PER_RUN);
      for (const u of us) { expect(new URL(u).pathname.startsWith(s.sitemapPathPrefix!), `${s.id}: ${u}`).toBe(true); expect(u).not.toMatch(LOGIN); }
    }
    for (const id of INERTES) { expect(rep(id).status, id).toBe('no_feed'); expect(urlsDe(id)).toEqual([]); }
    expect(fetcher.calls.filter((u) => /dotz|ipiranga|postospetrobras/.test(u)), 'nada requisitado das fontes só-cadastro').toEqual([]);
    expect(fetcher.calls.filter((u) => u.startsWith('http://')), 'só https').toEqual([]);
    expect(fetcher.calls.filter((u) => LOGIN.test(new URL(u).pathname)), 'nenhuma requisição a endereço de login/conta/checkout').toEqual([]);
    // as páginas de LATAM Pass: novidades (1) e regulamentos (4) não se misturam
    expect(urlsDe('latampass-novidades')).toEqual(['https://latampass.latam.com/br/pt/novidades-latam-pass-2027']);
    expect(urlsDe('latampass-regulamentos').every((u) => /\/br\/pt\/regulamento/.test(u))).toBe(true);
    // Livelo: só /juntar-pontos/ (a imprensa e os destinos do mesmo sitemap ficam de fora)
    expect(urlsDe('livelo-programa').every((u) => u.includes('/juntar-pontos/'))).toBe(true);
  });

  it('o orçamento do host vale: nenhuma fonte passa do limite por hora do cadastro e o host dividido (LATAM Pass) cabe na rodada conjunta sem rate_limited', async () => {
    const { out, fetcher } = await rodada();
    const porHost = (h: string) => fetcher.calls.filter((u) => new URL(u).host === h).length;
    expect(porHost('latampass.latam.com')).toBeLessThanOrEqual(14);
    expect(porHost('www.livelo.com.br')).toBeLessThanOrEqual(20);
    expect(porHost('www.smiles.com.br')).toBeLessThanOrEqual(6); expect(porHost('www.esfera.com.vc')).toBeLessThanOrEqual(6);
    const lat = out.sources.filter((s) => s.sourceId.startsWith('latampass'));
    expect(lat.flatMap((s) => s.skipped).some((k) => k.code === 'rate_limited'), 'LATAM Pass: a rodada conjunta cabe').toBe(false);
    expect(out.sources.find((s) => s.sourceId === 'livelo-programa')!.skipped.some((k) => k.code === 'rate_limited')).toBe(false);
  });

  it('Esfera: as URLs corrompidas do sitemap real (host concatenado) são descartadas COM aviso, nunca requisitadas, e as campanhas válidas são coletadas', async () => {
    const { rep, fetcher } = await rodada();
    const r = rep('esfera-campanhas');
    const aviso = r.skipped.find((k) => k.code === 'sitemap_entries_dropped');
    expect(aviso, 'aviso de entradas descartadas').toBeTruthy();
    expect(aviso!.detail).toMatch(/loc_url_embutida 2/); expect(aviso!.detail).toMatch(/esfera\.com\.vchttps:\/\/esfera\.zendesk\.com/);
    expect(r.evidences).toBeGreaterThanOrEqual(1);
    expect(fetcher.calls.some((u) => u.includes('zendesk')), 'zendesk nunca requisitado').toBe(false);
  });
});
