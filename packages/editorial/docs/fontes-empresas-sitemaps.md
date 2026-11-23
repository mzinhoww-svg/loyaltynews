# Sitemaps das fontes de empresas (sondagem do Data + conferência do Editorial, 23/11/2026)

O Data (`ft/intelligence`, `data/fontes-empresas.candidatos.sonda.json`) achou 18 RI/newsrooms/sites oficiais que declaram sitemap no `robots.txt` e nenhum feed RSS/Atom. O Editorial conferiu cada sitemap (1 a 4 leituras por host, User-Agent identificado, ≥ 3 s entre leituras, robots respeitado) e só ligou o `sitemapUrl` quando achou **uma seção de notícias/comunicados com páginas recentes**; sitemap com páginas institucionais ou produtos não vira coleta (a fábrica leria lixo).

## Ligados (coletam por sitemap, desabilitados até a revisão humana)

| Fonte (id) | Sitemap | Prefixo | O que foi visto |
|---|---|---|---|
| Livelo imprensa (`livelo-imprensa`) | `https://www.livelo.com.br/sitemap/static-sitemap-0.xml` | `/imprensa/` | 37 páginas de imprensa; mais recente de 2026-08-26 |
| Bradesco RI (`bradesco-ri`) | `https://www.bradescori.com.br/noticias-sitemap.xml` | `/noticias/` | 50 páginas; mais recente de 2026-11-23 |
| Natura RI (`natura-ri`, **fonte nova**) | `https://ri.natura.com.br/noticias-sitemap.xml` | `/noticias/` | 60 páginas; mais recente de 2026-11-17 |

## Não ligados (e por quê)

| Fonte | Motivo |
|---|---|
| BB RI | `/publicacoes-e-comunicados/` são páginas de seção (13, sem data; a mais recente de 2024), não matérias |
| GPA RI | `/noticia/` tem 307 páginas, mas a mais recente é de 2019 |
| XP RI (investors.xpinc.com) | `/noticia/` tem 5 páginas, incluindo uma de texto de teste ("lorem ipsum") |
| Dotz RI, Inter RI, BV RI, Americanas RI | os sitemaps `post-sitemap.xml` têm 1 ou 2 posts (de 2023 a 2025); comunicados e fatos relevantes não estão no sitemap (carregam por outro módulo do site) |
| Vibra RI | sitemap com governança, finanças e webcasts; sem seção de notícias |
| Mastercard newsroom | sitemap enorme por idioma/região (milhares de URLs `/mea/...`); sem recorte confiável para o Brasil |
| Smiles, LATAM Pass, Esfera, Uber newsroom | sitemaps de produto, páginas comerciais ou de outras regiões; sem seção de notícias |
| Santander RI | segue bloqueado para o nosso coletor (302 → `www.santander.com.br/ri/` → 403); o sitemap do destino só tem blog; acesso `via-provedor` (DP-31/DP-32), desabilitado |

Melhoria possível (não feita): coletar a página de listagem de comunicados dos RI (HTML) em vez de depender do sitemap, e a coleta pelo provedor (Bright Data, Apify etc.) nas fontes que carregam por JavaScript.
