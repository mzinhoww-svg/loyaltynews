import type { Source, SourceVerification } from '../types';

/**
 * Sites OFICIAIS dos programas de fidelidade (DP-51, 24/11/2026): além de RI e sala de imprensa, o banco de fontes passa a ter o site do próprio programa,
 * SÓ nas páginas públicas (conteúdo do programa, novidades, regulamentos, campanhas). Conferido pelo Editorial em 24/11/2026: robots.txt de cada host,
 * sitemap, visibilidade do texto sem login e a falta de cláusula de automação/reprodução nas páginas de termos lidas. Regras que valem para todas:
 *  - nunca atrás de login ou paywall: só entram prefixos públicos do sitemap (`sitemapPathPrefix`); se uma página pedir login o coletor para (`gated`);
 *  - até 5 páginas por rodada por fonte de sitemap (SITEMAP_MAX_PAGES_PER_RUN), respeitando robots.txt, 3 s entre requisições e o limite por hora;
 *  - a janela de 1 h é do HOST: fontes do mesmo host (LATAM Pass, Livelo) precisam de limite que cubra a rodada conjunta (teste confere);
 *  - TODAS nascem `enabled: false` e `termsStatus: 'pending'`: quem habilita é o admin no Studio (o proprietário quer todas habilitadas no staging);
 *  - quatro sites NÃO têm feed nem sitemap utilizável hoje (SPA, sitemap em outro host ou sem seção de conteúdo): entram no banco como cadastro
 *    (`status: no_feed` na coleta, sem erro) até haver feed, sitemap ou leitura via provedor (decisão do proprietário). Nada é coletado deles.
 * Não entraram (não verificáveis ou bloqueados; NÃO contornado): Azul Fidelidade/TudoAzul, C6 Átomos, Itaú (Iupp), Multiplus (encerrado), Inter Loop,
 * Stix. Ver docs/fontes-programas.md.
 */
const VER = (robotsNote: string, notes: string, level: SourceVerification['level'] = 'parcial'): SourceVerification => ({
  researchedBy: 'ln-editorial-engineer', level, robots: 'permitido', robotsNote, termsExcerpt: null,
  termsFetchedAt: '2026-11-24', consultedAt: '2026-11-24',
  imageRightsNote: 'Nenhuma imagem de fonte é usada (D08: sem base de direito registrada); os termos lidos não tratam de imagens do site.',
  notes,
});

export const SEED_PROGRAMA_SOURCES: Source[] = [
  {
    id: 'smiles-conteudo',
    name: 'Smiles — Te levo de milhas (conteúdo do programa)',
    kind: 'loyalty_program', editorias: ['programas', 'pontos', 'travel'],
    host: 'www.smiles.com.br', pathPrefix: null,
    listingUrl: 'https://www.smiles.com.br/te-levo-de-milhas/pilulas-financeiras', feedUrl: null,
    sitemapUrl: 'https://www.smiles.com.br/sitemap.xml', sitemapPathPrefix: '/te-levo-de-milhas/',
    termsUrl: 'https://www.smiles.com.br/regulamento-uso-app', termsStatus: 'pending', urlVerified: false, robotsRespected: true,
    paywall: 'none', enabled: false, imageRights: null, maxRequestsPerHour: 6,
    verification: VER(
      'robots.txt 200 (24/11): o grupo * só proíbe URLs com parâmetro de consulta (/*?*) e PDF (/*.pdf); sem Crawl-delay; sitemap declarado https://www.smiles.com.br/sitemap.xml. /te-levo-de-milhas/ permitido.',
      'Sitemap com 4.266 URLs, todas com lastmod (a mais recente de 18/11/2026) e 1,6 MB (perto do limite de 2 MB do fetcher: se passar disso a leitura falha com erro, sem coletar nada). O hub /te-levo-de-milhas/ tem 25 páginas (22 com lastmod desde 15/10): destinos, pílulas financeiras e mercado de fidelidade; é o conteúdo editorial do programa. As páginas de promoção e de Clube são comerciais e ficam de fora do prefixo. Páginas de amostra com texto visível sem login. Termos lidos (regulamento-uso-app e privacidade): sem cláusula sobre automação ou reprodução de conteúdo; classe D provisória (DP-51 aceita o risco).',
    ),
  },
  {
    id: 'latampass-novidades',
    name: 'LATAM Pass — novidades do programa',
    kind: 'loyalty_program', editorias: ['programas', 'pontos', 'travel'],
    host: 'latampass.latam.com', pathPrefix: null,
    listingUrl: 'https://latampass.latam.com/br/pt/novidades-latam-pass-2027', feedUrl: null,
    sitemapUrl: 'https://latampass.latam.com/br/pt.sitemap.xml', sitemapPathPrefix: '/br/pt/novidades',
    termsUrl: 'https://latampass.latam.com/br/pt/regulamentos-gerais/termos-e-condicoes', termsStatus: 'pending', urlVerified: false, robotsRespected: true,
    paywall: 'none', enabled: false, imageRights: null, maxRequestsPerHour: 14,
    verification: VER(
      'robots.txt 200 (24/11): grupo * sem regras de bloqueio; sem Crawl-delay; sitemap declarado https://latampass.latam.com/sitemap.xml (índice por país); usamos só o filho do Brasil (br/pt).',
      'Sitemap do Brasil: 126 URLs, todas com o mesmo lastmod (24/11), então a ordem por data não distingue páginas: por isso o prefixo é estreito (hoje 1 página: /br/pt/novidades-latam-pass-2027, 200, texto visível sem login). Limite 14/h (1 robots + 2 × (1 sitemap + 5 páginas) = 13) porque o host é dividido com latampass-regulamentos (janela de 1 h por host). Termos (termos-e-condicoes, 3 mil caracteres): sem cláusula sobre automação ou reprodução; classe D provisória (DP-51).',
    ),
  },
  {
    id: 'latampass-regulamentos',
    name: 'LATAM Pass — regulamentos do programa',
    kind: 'loyalty_program', editorias: ['programas', 'pontos', 'travel'],
    host: 'latampass.latam.com', pathPrefix: null,
    listingUrl: 'https://latampass.latam.com/br/pt/regulamentos-gerais', feedUrl: null,
    sitemapUrl: 'https://latampass.latam.com/br/pt.sitemap.xml', sitemapPathPrefix: '/br/pt/regulamento',
    termsUrl: 'https://latampass.latam.com/br/pt/regulamentos-gerais/termos-e-condicoes', termsStatus: 'pending', urlVerified: false, robotsRespected: true,
    paywall: 'none', enabled: false, imageRights: null, maxRequestsPerHour: 14,
    verification: VER(
      'robots.txt 200 (24/11): grupo * sem regras de bloqueio; sem Crawl-delay; mesmo host de latampass-novidades.',
      'Prefixo /br/pt/regulamento cobre regulamento-clube, regulamentos-gerais, termos-e-condicoes e políticas de cookies (4 páginas hoje; texto visível sem login). Mudança de regra do programa é fato noticiável: a fábrica reescreve com a fonte e o link, nunca reproduz o regulamento. Classe D provisória (DP-51).',
    ),
  },
  {
    id: 'livelo-programa',
    name: 'Livelo — site do programa (como juntar pontos)',
    kind: 'loyalty_program', editorias: ['programas', 'pontos', 'bancos'],
    host: 'www.livelo.com.br', pathPrefix: null,
    listingUrl: 'https://www.livelo.com.br/juntar-pontos', feedUrl: null,
    sitemapUrl: 'https://www.livelo.com.br/sitemap/static-sitemap-0.xml', sitemapPathPrefix: '/juntar-pontos/',
    termsUrl: 'https://www.livelo.com.br/regulamentos', termsStatus: 'pending', urlVerified: false, robotsRespected: true,
    paywall: 'none', enabled: false, imageRights: null, maxRequestsPerHour: 20,
    verification: VER(
      'robots.txt 200 (23/11, reconferido na pesquisa do piloto): Allow /; Disallow só /api/, /autologin, /logout, /redirect-login-page; sem Crawl-delay; sitemap https://www.livelo.com.br/sitemap/sitemap.xml (índice) e static-sitemap-0.xml (669 URLs).',
      'DP-49/DP-51: a Livelo não tem paywall, só login (área da conta); a coleta fica nas páginas públicas e NUNCA atrás do login (o coletor para em gated). Prefixo /juntar-pontos/: 25 páginas públicas de parceiros e instituições financeiras (regras de acúmulo), com lastmod recente. O mesmo sitemap e o mesmo host de livelo-imprensa: o limite de 20/h cobre a rodada conjunta das duas (a imprensa, de 6/h, roda antes no cadastro). Amostras com texto visível sem login. Termos: /regulamentos (links; sem cláusula de automação nas páginas lidas); classe D (DP-28/DP-51).',
    ),
  },
  {
    id: 'esfera-campanhas',
    name: 'Esfera — campanhas do programa',
    kind: 'loyalty_program', editorias: ['programas', 'bancos', 'varejo'],
    host: 'www.esfera.com.vc', pathPrefix: null,
    listingUrl: 'https://www.esfera.com.vc/', feedUrl: null,
    sitemapUrl: 'https://www.esfera.com.vc/staticSitemap.xml', sitemapPathPrefix: '/campanha-',
    termsUrl: 'https://esfera.zendesk.com/hc/pt-br/categories/52066824093331-Regulamentos', termsStatus: 'pending', urlVerified: false, robotsRespected: true,
    paywall: 'none', enabled: false, imageRights: null, maxRequestsPerHour: 6,
    verification: VER(
      'robots.txt 200 (24/11): o grupo * só proíbe /cart, /checkout, /profile, /searchresults, /confirmation e /discountutils; sem Crawl-delay; sitemap declarado https://www.esfera.com.vc/sitemap.xml (índice de sitemaps de categoria/produto); usamos o staticSitemap.xml.',
      'staticSitemap.xml: 109 URLs sem lastmod (a ordem é a do arquivo), 36 em /campanha-*. Algumas URLs do arquivo vêm corrompidas (host concatenado: "https://www.esfera.com.vchttps://esfera.zendesk.com/…"): o coletor as descarta e avisa (sitemap_entries_dropped). As páginas de campanha são de aplicação de página única com pouco texto (cerca de 700 caracteres na amostra): rende pouco. Termos: regulamentos no Zendesk da Esfera (outro host, só link; não lido). Classe D provisória (DP-51).',
    ),
  },
  {
    id: 'dotz-site',
    name: 'Dotz — site do programa',
    kind: 'loyalty_program', editorias: ['programas', 'varejo'],
    host: 'www.dotz.com.br', pathPrefix: null,
    listingUrl: 'https://www.dotz.com.br/home', feedUrl: null, sitemapUrl: null, sitemapPathPrefix: null,
    termsUrl: null, termsStatus: 'pending', urlVerified: false, robotsRespected: true,
    paywall: 'none', enabled: false, imageRights: null, maxRequestsPerHour: 6,
    verification: VER(
      'robots.txt 200 (24/11): grupo * com "Disallow:" vazio (nada bloqueado); sem sitemap declarado.',
      'NÃO coletável hoje: sem feed; o site é uma aplicação de página única (63 caracteres de texto visível no HTML); o sitemap.xml tem só 14 páginas estáticas de 2023 e no domínio sem www (dotz.com.br), que o coletor recusa por não ser o host da fonte; /blog devolve o mesmo casco. Fica no banco como cadastro até haver feed, sitemap ou leitura via provedor (decisão do proprietário). Termos do site não localizados.',
    ),
  },
  {
    id: 'km-de-vantagens',
    name: 'Km de Vantagens (Ipiranga) — página do programa',
    kind: 'loyalty_program', editorias: ['programas', 'varejo'],
    host: 'www.ipiranga.com.br', pathPrefix: '/wps/portal/pt-br/ipiranga/km-de-vantagens',
    listingUrl: 'https://www.ipiranga.com.br/wps/portal/pt-br/ipiranga/km-de-vantagens', feedUrl: null, sitemapUrl: null, sitemapPathPrefix: null,
    termsUrl: null, termsStatus: 'pending', urlVerified: false, robotsRespected: true,
    paywall: 'none', enabled: false, imageRights: null, maxRequestsPerHour: 6,
    verification: VER(
      'robots.txt 200 em www.ipiranga.com.br (24/11): grupo * com Allow / e Disallow de /*? e de áreas técnicas do portal; a página do programa não é bloqueada. kmdevantagens.com.br redireciona para esta página.',
      'NÃO coletável hoje: uma única página institucional do programa (texto visível de 11 mil caracteres, sem login); o sitemap declarado fica em outro host (portal.ipiranga, 252 URLs de portal, sem seção de notícias) e não há feed. Fica como cadastro até haver feed ou seção de novidades. Termos do programa não localizados nesta rodada.',
    ),
  },
  {
    id: 'petrobras-premmia',
    name: 'Premmia (Petrobras) — página do programa',
    kind: 'loyalty_program', editorias: ['programas', 'varejo'],
    host: 'www.postospetrobras.com.br', pathPrefix: '/ganhe-mais-com',
    listingUrl: 'https://www.postospetrobras.com.br/ganhe-mais-com/premmia', feedUrl: null, sitemapUrl: null, sitemapPathPrefix: null,
    termsUrl: null, termsStatus: 'pending', urlVerified: false, robotsRespected: true,
    paywall: 'none', enabled: false, imageRights: null, maxRequestsPerHour: 6,
    verification: VER(
      'robots.txt 200 em www.postospetrobras.com.br (24/11): o grupo * só traz Allow de arquivos estáticos; sem Disallow na página do programa; sem sitemap declarado. petrobraspremmia.com.br redireciona para cá (e o robots.txt do endereço antigo dá 404).',
      'NÃO coletável hoje: uma página do programa (3,4 mil caracteres de texto visível, sem login); sem feed e sem sitemap declarado. Fica como cadastro até haver feed, sitemap ou seção de novidades. Termos do programa não localizados nesta rodada.',
    ),
  },
];
