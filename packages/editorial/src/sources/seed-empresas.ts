import type { Source } from '../types';

/**
 * Fontes de empresas (RI/newsroom) acrescentadas pela sondagem do Data (ft/intelligence) e conferidas pelo Editorial em 23/11/2026.
 * TODAS desabilitadas até a revisão humana. Só entra aqui fonte com seção de notícias verificada no sitemap.
 */
export const SEED_EMPRESA_SOURCES: Source[] = [
  {
    "id": "natura-ri",
    "name": "Natura &Co — Relações com Investidores (notícias)",
    "kind": "investor_relations",
    "editorias": [
      "varejo",
      "mercado"
    ],
    "host": "ri.natura.com.br",
    "pathPrefix": null,
    "listingUrl": "https://ri.natura.com.br/noticias/",
    "feedUrl": null,
    "sitemapUrl": "https://ri.natura.com.br/noticias-sitemap.xml",
    "sitemapPathPrefix": "/noticias/",
    "termsUrl": null,
    "termsStatus": "pending",
    "urlVerified": false,
    "robotsRespected": true,
    "paywall": "unknown",
    "enabled": false,
    "imageRights": null,
    "maxRequestsPerHour": 6,
    "notes": "DP-28: fonte de empresa (classe D: termos de conteúdo não lidos; o Data não leu os termos). Coleta por sitemap de notícias.",
    "verification": {
      "researchedBy": "ln-editorial-engineer",
      "level": "parcial",
      "robots": "permitido",
      "robotsNote": "robots.txt permite (sondagem do Data, ft/intelligence data/fontes-empresas.candidatos.sonda.json); sitemap declarado: https://ri.natura.com.br/sitemap_index.xml. Sem Crawl-delay conhecido.",
      "termsExcerpt": null,
      "termsFetchedAt": null,
      "consultedAt": "2026-11-23",
      "imageRightsNote": "Nenhuma base de direito de imagem registrada (regra D08).",
      "notes": "Sitemap de notícias conferido em 2026-11-23 (1 leitura): 60 páginas em /noticias/, a mais recente de 2026-11-17. Termos de uso ainda não lidos: a revisão humana decide (DP-28)."
    }
  }
];
