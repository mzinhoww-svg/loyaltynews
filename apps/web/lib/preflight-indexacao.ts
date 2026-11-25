/**
 * Pré-voo de indexação do portal (achado 1 da auditoria de produção de 25/11).
 *
 * O release 1 está no ar em www.loyaltynews.com.br com noindex, robots `Disallow: /`, sitemap vazio e canonical/og:url em
 * loyaltynews.vertraweb.app. Se o release 2 desligar o noindex sem trocar antes a URL pública, o Google recebe páginas
 * indexáveis com canonical para OUTRO domínio e um sitemap sem nenhuma URL: risco de não indexar o domínio próprio.
 *
 * A ORDEM é obrigatória e não se inverte:
 *   1. NEXT_PUBLIC_SITE_URL=https://www.loyaltynews.com.br no build + sitemap com URLs + canonical auto-referente;
 *   2. só então PORTAL_INDEXAVEL=1 (desliga noindex, robots e X-Robots-Tag).
 * Este módulo é a régua dessa ordem: recebe o que o site devolveu e aponta cada incoerência. Sem dependências, para rodar
 * igual no vitest e no script de pré-voo.
 */

export interface RespostaIndexacao {
  robots: string;
  sitemap: string;
  /** HTML das páginas a conferir (home, uma listagem, um perfil, uma editoria). */
  paginas: { url: string; html: string }[];
}

export interface ProblemaIndexacao {
  regra: 'robots' | 'sitemap' | 'canonical' | 'noindex';
  mensagem: string;
}

const origin = (u: string): string | null => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

export function locsDoSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
}

export function sitemapsDoRobots(txt: string): string[] {
  return txt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^sitemap:/i.test(l))
    .map((l) => l.replace(/^sitemap:\s*/i, '').trim());
}

export function robotsBloqueiaTudo(txt: string): boolean {
  const linhas = txt.split(/\r?\n/).map((l) => l.trim().toLowerCase());
  return linhas.some((l) => l === 'disallow: /' || l === 'disallow:/');
}

function canonicals(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi)].map((m) => {
    const href = m[0].match(/href=["']([^"']+)["']/i);
    return href ? href[1]! : '';
  });
}

function noindexNoHtml(html: string): boolean {
  const metas = [...html.matchAll(/<meta\b[^>]*name=["']robots["'][^>]*>/gi)].map((m) => m[0]);
  return metas.some((m) => /content=["'][^"']*noindex/i.test(m));
}

/**
 * Confere a fotografia de um site que JÁ se diz indexável (PORTAL_INDEXAVEL=1). Qualquer problema é razão para não abrir o
 * índice: a ordem é sempre sitemap+canonical primeiro, noindex depois.
 */
export interface OpcoesPreflight {
  /** Etapa A do go-live: sitemap e canonical já corretos, noindex AINDA ligado de propósito. */
  etapaA?: boolean;
}

export function auditarIndexacao(esperado: string, r: RespostaIndexacao, opcoes: OpcoesPreflight = {}): ProblemaIndexacao[] {
  const problemas: ProblemaIndexacao[] = [];
  const base = origin(esperado);
  if (!base) throw new Error(`URL de produção inválida: ${esperado}`);

  // Na etapa A o bloqueio por robots é esperado (o noindex ainda está ligado); nas demais, é falha.
  if (robotsBloqueiaTudo(r.robots) && !opcoes.etapaA) {
    problemas.push({ regra: 'robots', mensagem: 'robots.txt ainda tem "Disallow: /": o site continua fechado ao rastreamento.' });
  }
  const bloqueado = robotsBloqueiaTudo(r.robots);
  const declarados = sitemapsDoRobots(r.robots);
  // No robots fechado da etapa A não há linha Sitemap: (a referência entra junto com a abertura, na etapa B).
  if (!declarados.length && !(opcoes.etapaA && bloqueado)) {
    problemas.push({ regra: 'robots', mensagem: 'robots.txt não declara nenhum Sitemap:.' });
  }
  for (const s of declarados) {
    if (/vertraweb\.app/i.test(s)) {
      problemas.push({ regra: 'robots', mensagem: `robots.txt aponta o sitemap para o host de staging: ${s}` });
    }
  }

  const locs = locsDoSitemap(r.sitemap);
  if (!locs.length) {
    problemas.push({ regra: 'sitemap', mensagem: 'sitemap.xml está vazio (0 <loc>): indexar agora deixaria o portal sem URLs declaradas.' });
  }
  for (const u of locs) {
    if (origin(u) !== base) problemas.push({ regra: 'sitemap', mensagem: `URL do sitemap fora do domínio de produção: ${u}` });
  }

  for (const p of r.paginas) {
    const esperadoPagina = origin(p.url) === base ? p.url : null;
    if (!esperadoPagina) {
      problemas.push({ regra: 'canonical', mensagem: `Página conferida fora do domínio de produção: ${p.url}` });
      continue;
    }
    const cs = canonicals(p.html).filter(Boolean);
    // Barra final não muda a página (a home canônica é o domínio sem barra): normaliza só isso antes de comparar.
    const semBarra = (u: string) => u.replace(/\/+$/, '');
    if (cs.length !== 1) {
      problemas.push({ regra: 'canonical', mensagem: `${p.url}: esperado 1 canonical, encontrado ${cs.length}.` });
    } else if (semBarra(cs[0]!) !== semBarra(esperadoPagina)) {
      problemas.push({ regra: 'canonical', mensagem: `${p.url}: canonical aponta para ${cs[0]} em vez de si mesma.` });
    }
    if (noindexNoHtml(p.html) && !opcoes.etapaA) {
      problemas.push({ regra: 'noindex', mensagem: `${p.url}: ainda traz meta robots noindex.` });
    }
  }
  return problemas;
}
