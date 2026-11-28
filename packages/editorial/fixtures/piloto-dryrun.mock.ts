// MOCK — ENSAIO do piloto em dry-run. Nada aqui é matéria, fala, número ou resposta reais das fontes: os hosts são os do cadastro
// (para exercitar elegibilidade, robots, host/pathPrefix e ritmo), mas NENHUMA rede é usada (MockFetcher + resolvedor falso) e
// NENHUM modelo é chamado (RehearsalGateway devolve saídas roteirizadas, marcadas SIMULADO, com custo zero).
import type { Fetcher, FetchOptions, HttpResponse } from '../src/collector/collector';
import type { GatewayRequest, GatewayResponse, ModelGateway } from '../src/gateway';
import { FakeResolver, MOCK_PUBLIC_IP } from './mock-web.mock';

export const DRYRUN_SOURCE_IDS = ['senado-noticias', 'camara-noticias', 'abemf', 'livelo-imprensa', 'abrarec'] as const;
export type DryrunSourceId = (typeof DRYRUN_SOURCE_IDS)[number];

/** Comportamento roteirizado do "modelo" para uma matéria do ensaio (o que o ensaio quer provar sobre os gates). */
export type ScenarioKind =
  | 'limpa'              // deve passar em todos os gates
  | 'copia_literal'      // reproduz trecho da fonte: copy_literal
  | 'numero_sem_fonte'   // número que não está nas evidências: unsupported_claim
  | 'tom_exclamacao'     // "!" no título: tom lint bloqueante
  | 'checagem_reprova'   // o checador reprova uma afirmação
  | 'mesmo_provedor';    // checagem no mesmo provedor do redator: cross_provider_check_failed

export interface DryrunPage {
  /** Id estável da matéria do ensaio (a1..a10). */
  slot: string;
  sourceId: DryrunSourceId;
  url: string;
  title: string;
  paragraphs: string[];
  publishedAt: string;
  scenario: ScenarioKind;
  /** Texto do corpo escrito pelo "redator simulado" (paráfrase própria, nunca copiada da página). */
  draft: { headline: string; resumo: string; body: string; claims: Array<{ id: string; kind: 'fact' | 'number' | 'date'; text: string }> };
}

const aviso = 'Texto FICTÍCIO de ensaio, sem relação com notícia real.';

export const DRYRUN_PAGES: DryrunPage[] = [
  {
    slot: 'a1', sourceId: 'senado-noticias', url: 'https://www12.senado.leg.br/noticias/materias/ensaio/comissao-ficticia-aprova-relatorio-fidelidade', publishedAt: '2026-11-25T10:00:00-03:00', scenario: 'limpa',
    title: 'ENSAIO: comissão fictícia aprova relatório sobre programas de fidelidade',
    paragraphs: [
      aviso,
      'A Comissão de Ensaio, órgão fictício usado só neste teste, aprovou nesta quarta-feira o relatório sobre regras de validade de pontos em programas de fidelidade.',
      'O texto fixa prazo de 90 dias para que as empresas publiquem a política de validade e segue para votação em plenário na semana seguinte.',
    ],
    draft: {
      headline: 'SIMULADO: comissão fictícia aprova relatório sobre validade de pontos',
      resumo: 'SIMULADO — ensaio sem modelo real: relatório fictício dá 90 dias para empresas divulgarem a validade dos pontos.',
      body: 'SIMULADO — texto de ensaio, sem apuração. Segundo a fonte, uma comissão fictícia aprovou um relatório que obriga as empresas de fidelidade a divulgar, em 90 dias, a política de validade dos pontos. O plenário deve votar o texto na semana seguinte.',
      claims: [
        { id: 'c1', kind: 'fact', text: 'Uma comissão fictícia aprovou relatório sobre validade de pontos em programas de fidelidade' },
        { id: 'c2', kind: 'number', text: 'prazo de 90 dias para publicar a política de validade' },
      ],
    },
  },
  {
    slot: 'a2', sourceId: 'senado-noticias', url: 'https://www12.senado.leg.br/noticias/materias/ensaio/plenario-ficticio-debate-cashback', publishedAt: '2026-11-25T09:00:00-03:00', scenario: 'copia_literal',
    title: 'ENSAIO: plenário fictício debate regras de cashback',
    paragraphs: [
      aviso,
      'O plenário fictício do ensaio debateu nesta quarta-feira a proposta que define regras mínimas de transparência para ofertas de cashback no comércio eletrônico brasileiro.',
      'A votação ficou para a sessão seguinte, sem data definida pela mesa.',
    ],
    draft: {
      headline: 'SIMULADO: plenário fictício debate transparência em ofertas de cashback',
      resumo: 'SIMULADO — ensaio sem modelo real: redação que copia a fonte para provar o bloqueio por cópia literal.',
      body: 'SIMULADO — texto de ensaio, sem apuração. O plenário fictício do ensaio debateu nesta quarta-feira a proposta que define regras mínimas de transparência para ofertas de cashback no comércio eletrônico brasileiro. A votação ficou para depois.',
      claims: [{ id: 'c1', kind: 'fact', text: 'O plenário fictício debateu regras de transparência para cashback' }],
    },
  },
  {
    slot: 'a3', sourceId: 'camara-noticias', url: 'https://www.camara.leg.br/noticias/ensaio-1001-comissao-ficticia-ouve-associacao', publishedAt: '2026-11-25T11:00:00-03:00', scenario: 'limpa',
    title: 'ENSAIO: comissão fictícia ouve associação sobre uso de dados em programas de pontos',
    paragraphs: [
      aviso,
      'Uma comissão fictícia da Câmara ouviu nesta terça-feira representantes de uma associação de empresas sobre o uso de dados de consumo em programas de pontos.',
      'O debate durou 2 horas e a comissão pediu um relatório técnico em 30 dias.',
    ],
    draft: {
      headline: 'SIMULADO: comissão fictícia ouve associação sobre dados em programas de pontos',
      resumo: 'SIMULADO — ensaio sem modelo real: audiência fictícia sobre uso de dados termina com pedido de relatório em 30 dias.',
      body: 'SIMULADO — texto de ensaio, sem apuração. De acordo com a fonte, uma comissão fictícia ouviu uma associação de empresas sobre dados de consumo em programas de pontos e pediu um relatório técnico em 30 dias.',
      claims: [
        { id: 'c1', kind: 'fact', text: 'Uma comissão fictícia ouviu uma associação sobre uso de dados em programas de pontos' },
        { id: 'c2', kind: 'number', text: 'relatório técnico em 30 dias' },
      ],
    },
  },
  {
    slot: 'a4', sourceId: 'camara-noticias', url: 'https://www.camara.leg.br/noticias/ensaio-1002-projeto-ficticio-milhas', publishedAt: '2026-11-25T08:30:00-03:00', scenario: 'numero_sem_fonte',
    title: 'ENSAIO: projeto fictício trata de prazo para uso de milhas',
    paragraphs: [
      aviso,
      'Um projeto fictício apresentado no ensaio trata do prazo para uso de milhas acumuladas e prevê que o prazo seja informado ao consumidor no momento do acúmulo.',
      'O autor fictício pediu urgência, e o projeto aguarda despacho da presidência.',
    ],
    draft: {
      headline: 'SIMULADO: proposta fictícia discute validade das milhas',
      resumo: 'SIMULADO — ensaio sem modelo real: redação com número ausente da fonte, para provar o bloqueio de afirmação sem suporte.',
      body: 'SIMULADO — texto de ensaio, sem apuração. Um projeto fictício prevê que o consumidor seja informado do prazo de uso das milhas e, segundo o rascunho, o prazo mínimo seria de 35 meses.',
      claims: [
        { id: 'c1', kind: 'fact', text: 'Um projeto fictício trata do prazo para uso de milhas' },
        { id: 'c2', kind: 'number', text: 'prazo mínimo de 35 meses' },
      ],
    },
  },
  {
    slot: 'a5', sourceId: 'abemf', url: 'https://web.abemf.com.br/noticias/ensaio-associacao-ficticia-publica-guia', publishedAt: '2026-11-24T15:00:00-03:00', scenario: 'limpa',
    title: 'ENSAIO: associação fictícia publica guia de boas práticas para programas de fidelidade',
    paragraphs: [
      aviso,
      'A associação fictícia do ensaio publicou um guia de boas práticas com orientações sobre comunicação de regras e atendimento ao participante de programas de fidelidade.',
      'O guia tem 12 recomendações e fica disponível no site da associação.',
    ],
    draft: {
      headline: 'SIMULADO: guia novo reúne orientações para programas de fidelidade',
      resumo: 'SIMULADO — ensaio sem modelo real: guia fictício reúne 12 recomendações para programas de fidelidade.',
      body: 'SIMULADO — texto de ensaio, sem apuração. A associação fictícia divulgou um guia com 12 recomendações sobre como programas de fidelidade devem comunicar regras e atender participantes.',
      claims: [
        { id: 'c1', kind: 'fact', text: 'A associação fictícia divulgou um guia de boas práticas para programas de fidelidade' },
        { id: 'c2', kind: 'number', text: '12 recomendações' },
      ],
    },
  },
  {
    slot: 'a6', sourceId: 'abemf', url: 'https://web.abemf.com.br/noticias/ensaio-evento-ficticio-fidelidade', publishedAt: '2026-11-24T09:00:00-03:00', scenario: 'tom_exclamacao',
    title: 'ENSAIO: evento fictício reúne empresas de fidelidade',
    paragraphs: [
      aviso,
      'Um evento fictício do ensaio reuniu empresas de fidelidade para discutir tendências do setor em painéis de um dia.',
      'A organização fictícia informou que a próxima edição será anunciada em data a definir.',
    ],
    draft: {
      headline: 'SIMULADO: evento fictício reúne empresas de fidelidade e promete novidades!',
      resumo: 'SIMULADO — ensaio sem modelo real: manchete com exclamação para provar o bloqueio do tom lint.',
      body: 'SIMULADO — texto de ensaio, sem apuração. Um evento fictício reuniu empresas de fidelidade em painéis de um dia, e a organização disse que a próxima edição será anunciada depois.',
      claims: [{ id: 'c1', kind: 'fact', text: 'Um evento fictício reuniu empresas de fidelidade em painéis de um dia' }],
    },
  },
  {
    slot: 'a7', sourceId: 'livelo-imprensa', url: 'https://www.livelo.com.br/imprensa/ensaio-parceria-ficticia-viagens', publishedAt: '2026-11-23T10:00:00-03:00', scenario: 'limpa',
    title: 'ENSAIO: programa fictício anuncia parceria com plataforma de viagens',
    paragraphs: [
      aviso,
      'Um programa de pontos fictício anunciou parceria com uma plataforma de viagens também fictícia, que permitirá trocar pontos por diárias de hotel.',
      'A troca começa em 1º de dezembro de 2026, segundo o comunicado fictício.',
    ],
    draft: {
      headline: 'SIMULADO: programa fictício anuncia parceria para trocar pontos por hospedagem',
      resumo: 'SIMULADO — ensaio sem modelo real: parceria fictícia permite trocar pontos por diárias a partir de 1º de dezembro de 2026.',
      body: 'SIMULADO — texto de ensaio, sem apuração. De acordo com o comunicado fictício, um programa de pontos fechou parceria com uma plataforma de viagens para a troca de pontos por diárias de hotel, a partir de 1º de dezembro de 2026.',
      claims: [
        { id: 'c1', kind: 'fact', text: 'Um programa de pontos fictício fechou parceria com uma plataforma de viagens para trocar pontos por diárias de hotel' },
        { id: 'c2', kind: 'date', text: 'a partir de 1º de dezembro de 2026' },
      ],
    },
  },
  {
    slot: 'a8', sourceId: 'livelo-imprensa', url: 'https://www.livelo.com.br/imprensa/ensaio-campanha-ficticia-cashback', publishedAt: '2026-11-22T10:00:00-03:00', scenario: 'checagem_reprova',
    title: 'ENSAIO: campanha fictícia oferece bônus em compras selecionadas',
    paragraphs: [
      aviso,
      'Uma campanha fictícia oferece bônus de pontos em compras de categorias selecionadas durante o fim de semana do ensaio.',
      'As categorias participantes serão listadas no regulamento fictício da campanha.',
    ],
    draft: {
      headline: 'SIMULADO: campanha fictícia oferece bônus de pontos em categorias selecionadas',
      resumo: 'SIMULADO — ensaio sem modelo real: o checador simulado reprova uma afirmação para provar o bloqueio por checagem.',
      body: 'SIMULADO — texto de ensaio, sem apuração. Uma campanha fictícia dá bônus de pontos em categorias selecionadas, e o regulamento fictício lista as categorias participantes.',
      claims: [
        { id: 'c1', kind: 'fact', text: 'Uma campanha fictícia oferece bônus de pontos em categorias selecionadas' },
        { id: 'c2', kind: 'fact', text: 'O regulamento fictício lista as categorias participantes' },
      ],
    },
  },
  {
    slot: 'a9', sourceId: 'abrarec', url: 'https://abrarec.com.br/blog/ensaio-associacao-ficticia-pesquisa-recompensas', publishedAt: '2026-11-19T10:00:00-03:00', scenario: 'limpa',
    title: 'ENSAIO: associação fictícia divulga pesquisa sobre recompensas',
    paragraphs: [
      aviso,
      'A associação fictícia do ensaio divulgou uma pesquisa sobre percepção de recompensas entre consumidores participantes de programas de fidelidade.',
      'A pesquisa ouviu 800 pessoas e o relatório completo está no site da associação.',
    ],
    draft: {
      headline: 'SIMULADO: associação fictícia divulga pesquisa sobre percepção de recompensas',
      resumo: 'SIMULADO — ensaio sem modelo real: pesquisa fictícia ouviu 800 pessoas sobre recompensas.',
      body: 'SIMULADO — texto de ensaio, sem apuração. Segundo a fonte, a associação fictícia publicou uma pesquisa com 800 pessoas sobre a percepção de recompensas em programas de fidelidade.',
      claims: [
        { id: 'c1', kind: 'fact', text: 'A associação fictícia publicou uma pesquisa sobre percepção de recompensas' },
        { id: 'c2', kind: 'number', text: 'pesquisa com 800 pessoas' },
      ],
    },
  },
  {
    slot: 'a10', sourceId: 'abrarec', url: 'https://abrarec.com.br/blog/ensaio-webinar-ficticio-relacionamento', publishedAt: '2026-11-18T10:00:00-03:00', scenario: 'mesmo_provedor',
    title: 'ENSAIO: webinar fictício discute relacionamento com o cliente',
    paragraphs: [
      aviso,
      'Um webinar fictício discutiu práticas de relacionamento com o cliente em programas de recompensas, com participação de especialistas fictícios.',
      'A gravação ficará disponível por tempo indeterminado no site da associação fictícia.',
    ],
    draft: {
      headline: 'SIMULADO: webinar fictício discute relacionamento com o cliente em recompensas',
      resumo: 'SIMULADO — ensaio sem modelo real: checagem no mesmo provedor do redator, para provar o bloqueio por falta de independência.',
      body: 'SIMULADO — texto de ensaio, sem apuração. A fonte informa que um webinar fictício tratou de como os programas de recompensas se relacionam com seus clientes, e que o vídeo seguirá no site da associação.',
      claims: [{ id: 'c1', kind: 'fact', text: 'Um webinar fictício discutiu relacionamento com o cliente em programas de recompensas' }],
    },
  },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = (p: DryrunPage) => `<html><head><title>${esc(p.title)}</title><link rel="canonical" href="${p.url}"/>
<meta property="article:published_time" content="${p.publishedAt}"/></head>
<body><article><h1>${esc(p.title)}</h1>${p.paragraphs.map((t) => `<p>${esc(t)}</p>`).join('')}</article></body></html>`;

const ROBOTS: Record<string, string> = {
  'www12.senado.leg.br': 'User-agent: *\nDisallow: /noticias/interno/\n',
  'www.camara.leg.br': 'User-agent: *\nDisallow: /admin/\n',
  'web.abemf.com.br': 'User-agent: *\nDisallow: /wp-admin/\n',
  'www.livelo.com.br': 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /autologin\n',
  'abrarec.com.br': 'User-agent: *\nDisallow: /wp-admin/\n',
};

const rss = (items: Array<{ title: string; url: string; at: string }>) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>ENSAIO</title>${items.map((i) => `<item><title>${esc(i.title)}</title><link>${i.url}</link><pubDate>${new Date(i.at).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;

/** Listagens (feed/sitemap) e páginas, só dos itens do ensaio, mais itens extras que o coletor precisa RECUSAR (robots, fora do prefixo). */
export function dryrunRoutes(): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [host, txt] of Object.entries(ROBOTS)) r[`https://${host}/robots.txt`] = txt;
  const of = (id: DryrunSourceId) => DRYRUN_PAGES.filter((p) => p.sourceId === id);
  const feed = (id: DryrunSourceId, url: string) => { r[url] = rss(of(id).map((p) => ({ title: p.title, url: p.url, at: p.publishedAt }))); };
  feed('senado-noticias', 'https://www12.senado.leg.br/noticias/rss.xml');
  feed('camara-noticias', 'https://www.camara.leg.br/noticias/rss/ultimas-noticias');
  feed('abemf', 'https://web.abemf.com.br/feed/');
  feed('abrarec', 'https://abrarec.com.br/feed/');
  // Livelo: sem feed; sitemap com 2 páginas de /imprensa/ e 1 de fora do prefixo (produto), que não pode ser coletada
  r['https://www.livelo.com.br/sitemap/static-sitemap-0.xml'] = `<?xml version="1.0"?><urlset>${of('livelo-imprensa').map((p) => `<url><loc>${p.url}</loc><lastmod>${p.publishedAt.slice(0, 10)}</lastmod></url>`).join('')}<url><loc>https://www.livelo.com.br/produto/ensaio-nao-e-noticia</loc><lastmod>2026-11-25</lastmod></url></urlset>`;
  for (const p of DRYRUN_PAGES) r[p.url] = html(p);
  // item do feed da Agência Senado em área interna: o robots.txt do ensaio proíbe; o coletor deve recusar sem requisitar
  r['https://www12.senado.leg.br/noticias/rss.xml'] = r['https://www12.senado.leg.br/noticias/rss.xml']!.replace('</channel>', `<item><title>ENSAIO: item em área proibida</title><link>https://www12.senado.leg.br/noticias/interno/ensaio-fora-do-robots</link></item></channel>`);
  return r;
}

export const dryrunResolver = (): FakeResolver =>
  new FakeResolver(Object.fromEntries(Object.keys(ROBOTS).map((h) => [h, [[MOCK_PUBLIC_IP]]])));

/** Fetcher sem rede que registra QUANDO (relógio do ensaio) cada requisição foi feita, para provar o espaçamento por host. */
export class TimedMockFetcher implements Fetcher {
  readonly log: Array<{ host: string; url: string; atMs: number }> = [];
  private readonly routes: Map<string, HttpResponse>;
  constructor(routes: Record<string, string>, private readonly clock: () => number) {
    this.routes = new Map(Object.entries(routes).map(([k, v]) => [k, { status: 200, headers: {}, body: v }]));
  }
  async get(url: string, _opts?: FetchOptions): Promise<HttpResponse> {
    this.log.push({ host: new URL(url).host, url, atMs: this.clock() });
    return this.routes.get(url) ?? { status: 404, headers: {}, body: '' };
  }
}

export const SIM_DRAFTER = 'simulado-redator';
export const SIM_CHECKER = 'simulado-checador';
export const SIM_REVIEWER = 'simulado-revisor';

interface EvIn { id: string; sourceId: string; title: string }

/**
 * "Modelo" do ensaio: NÃO chama nada. Escolhe o roteiro pelo título da evidência (ou pela manchete, na revisão); o gateway não recebe URL e devolve saídas no formato das classes de tarefa.
 * `calls` registra tudo o que passou (para o relatório afirmar "0 chamadas a modelo real": só este objeto foi acionado).
 */
export class RehearsalGateway implements ModelGateway {
  readonly calls: Array<{ taskClass: string; articleSlot: string | null; provider: string }> = [];
  constructor(private readonly editoriaOf: (sourceId: string) => string) {}

  async invoke(req: GatewayRequest): Promise<GatewayResponse> {
    const input = req.input as { evidences?: EvIn[]; claims?: Array<{ id: string }>; headline?: string };
    const ev = input.evidences?.[0];
    const page = DRYRUN_PAGES.find((p) => (ev ? ev.title === p.title : input.headline === p.draft.headline));
    const usage = { inputTokens: 0, outputTokens: 0, costMicrosUsd: 0 };
    const done = (provider: string, output: unknown): GatewayResponse => {
      this.calls.push({ taskClass: req.taskClass, articleSlot: page?.slot ?? null, provider });
      // taskId/attempt como o adaptador do OpenBot devolve: é o que liga a linha do piloto (planilha) à tarefa
      const n = this.calls.filter((c) => c.articleSlot === (page?.slot ?? null) && c.taskClass === req.taskClass).length;
      return { ok: true, provider, model: `${provider}-ensaio`, output, usage, taskId: `ensaio-${page?.slot}-${req.taskClass}-${n}`, attempt: 1 };
    };
    if (!page) return { ok: false, refusal: 'model_disabled', detail: 'ensaio: evidência fora do roteiro' };
    switch (req.taskClass) {
      case 'triage': return done(SIM_DRAFTER, { relevant: true, editoria: this.editoriaOf(page.sourceId) });
      case 'context': return done(SIM_DRAFTER, { notes: [] });
      case 'draft': return done(SIM_DRAFTER, { ...page.draft, claims: page.draft.claims.map((c) => ({ ...c, evidenceIds: [ev!.id] })) });
      case 'factcheck': {
        const claims = input.claims ?? [];
        const provider = page.scenario === 'mesmo_provedor' ? SIM_DRAFTER : SIM_CHECKER;
        return done(provider, { verdicts: claims.map((c, i) => ({ claimId: c.id, verdict: page.scenario === 'checagem_reprova' && i === claims.length - 1 ? 'fail' : 'pass' })) });
      }
      case 'review': return done(SIM_REVIEWER, { approve: true, issues: [] });
      default: return { ok: false, refusal: 'model_disabled', detail: `ensaio: sem saída para ${req.taskClass}` };
    }
  }
}
