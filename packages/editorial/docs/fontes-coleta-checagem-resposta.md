# Resposta da Editorial à checagem de coleta das 93 fontes (25/11/2026)

Entrada: `fast-track/fontes-coleta-checagem.md` (loyalty-news-scraping-benchmark, commit 74c0192). Tudo abaixo foi lido ao vivo em 25/11/2026 com o agente `LoyaltyNewsBot`, só leitura pública, robots.txt respeitado, 3,5 s ou mais por host, parada em 403/429/desafio. Nenhuma chamada tarifada, nenhuma chave, nada contornado. Código: `packages/editorial/src/sources/seed*.ts`; testes: `fontes-checagem-coleta.test.ts` (cadastro) e `fontes-checagem-sitemap.test.ts` (coleta offline).

## 1. As 24 fontes "só listagem"

**Cadastradas (9 das 24):**

| Fonte | O que foi cadastrado | O que a leitura mostrou |
|---|---|---|
| ABAV | feed do blog `https://abav.com.br/blog/feed/` | 13 itens, último de 28/03/2025: **baixa frequência** |
| EDPB | feed `https://www.edpb.europa.eu/rss.xml_en` | 10 itens, último de 19/11/2026 |
| ANATEL | sitemap `https://www.gov.br/anatel/sitemap-index.xml`, prefixo `/anatel/pt-br/assuntos/noticias/` | 4 filhos .xml.gz; 1.692 URLs de notícia, a mais recente de 19/11/2026 |
| Ministério do Turismo | sitemap `https://www.gov.br/turismo/sitemap-index.xml`, prefixo `/turismo/pt-br/assuntos/noticias/` | 11 filhos .xml.gz (11 leituras por rodada no host `www.gov.br`, que é compartilhado); 2.667 URLs de notícia, a mais recente de 24/11/2026 |
| Dinheirama | sitemap `https://investimentos.com.br/sitemap-artigos.xml` direto, prefixo `/artigos/` | o índice tem lastmod e o coletor leria só páginas e simuladores; 517 artigos, o último de 29/10/2026: **baixa frequência** |
| IDV | sitemap `https://www.idv.org.br/sitemap_index.xml`, prefixo `/noticia/` | filho de notícias de 28/10/2026; feed parado desde 2022; a página `/noticia/` entra no sitemap e pode ser lida como notícia (a triagem recusa): **baixa frequência** |
| Nubank (sala de imprensa) | sitemap `https://nu.com/sitemap/institutional.xml`, prefixo `/pt/sala-de-imprensa/` | 1.200 URLs de imprensa, a mais recente de 23/11/2026. **`pathPrefix` da fonte passou de `/en/newsroom` para `null`**: o sitemap fica em `/sitemap/` e o coletor o recusaria; as páginas continuam limitadas pelo prefixo do sitemap |
| Accor (sala de imprensa do grupo) | sitemap `https://group.accor.com/api/sitemap`, prefixo `/en/news-stories/` **e `sitemapPathExclude`** `^/en/news-stories/page/[0-9]+/?$` | 425 URLs com lastmod real; 35 são listagens com lastmod renovado, que passariam à frente das matérias; 245 matérias completas no HTML, em inglês, a mais recente de 24/11/2026. Limite por hora 8. **Os termos do site vedam extração: habilitar exige aceite do proprietário ou do jurídico (nota do QA 10)** |
| Meu Bolso em Dia | **host passou para `meubolsoemdia.com.br`** e sitemap `https://meubolsoemdia.com.br/sitemap.xml`, prefixo `/Materias/` | o site responde sem www (200, sem redirecionar) e o sitemap lista só URLs sem www, que o coletor recusaria com o host antigo (há teste mostrando a recusa) |

**Não cadastradas, com o motivo gravado em `verification.notes` (15):**

| Fonte | Motivo |
|---|---|
| ABECS, ABRAS, Magazine Luiza RI | nenhum feed, sitemap ou link alternate; robots.txt permite (ABRAS e Magalu: robots 404, sem regras) |
| Administradores.com | o robots declara sitemap, mas o site devolve HTTP 400 ao nosso agente |
| Azul RI, GOL RI, Banco do Brasil RI | sitemap WordPress só com páginas estáticas (sem item por comunicado; a lista é dinâmica); tentativa de feed devolveu 403 e parei |
| Febraban | sitemap de 857 URLs sem lastmod e fora de ordem de data; e as páginas `/noticia/` são **casca de aplicação** (o HTML traz só o título genérico "FEBRABAN - Notícias", sem texto nem data nas 3 lidas). Ordenar pelo número da URL não as tornaria coletáveis: **não implementei regra de ordenação** |
| MCTI, Senacon (MJ) | fora do padrão dos outros sites gov.br: `sitemap-index.xml` dá 404 e o `sitemap.xml.gz` da raiz dá 403 |
| oneworld | o índice aponta para outro host (globalsiteseo.com); `/sitemap.xml` tem último lastmod de 2022 |
| Zendesk | sitemaps sem lastmod; feed parado desde 03/2024 |
| Dotz, Km de Vantagens, Premmia | já tinham o motivo registrado em 24/11 (não coletáveis hoje); sem mudança. Observação: o robots.txt do Premmia respondeu 403 ao nosso agente nesta leitura, e a de 24/11 tinha dado 200 |

## 2. Feeds parados e ANPD

| Fonte | Conclusão |
|---|---|
| ABEMF | feed relido: 11 itens, último de 22/10/2026; sem URL nova. **Baixa frequência** |
| A4A | feed relido: último de 23/10/2026 (sitemap de 29/10, sem notícia nova); sem URL nova. **Baixa frequência** |
| Million Mile Secrets | último item de 25/07/2024 (sitemap de 30/07/2024): o site **parou de publicar em 2024**; tratar como inativa |
| One Mile at a Time | ativo (o "2013" veio do lastmod de um filho do índice). **O robots.txt proíbe o feed (`Disallow: */feed/`)**: um feed `/feed/` chegou a ser cadastrado e o QA 10 reprovou; foi **removido**. Cadastrado o `https://onemileatatime.com/news-sitemap.xml` com prefixo `/news/` (5.688 URLs, a mais recente de 25/11/2026), permitido pelo robots; limite por hora 8 |
| RD Station | ativo: `blog-sitemap.xml` e `glossary-sitemap.xml` com lastmod de 25/11/2026; a checagem leu outro filho |
| The Wise Marketer | ativo: `post-sitemap10.xml` com lastmod de 24/11/2026; a checagem leu o `post-sitemap2.xml` (2012) |
| ANPD | o "sem itens" veio de a checagem ler um filho só do índice: os dois filhos têm 1.395 e 54 URLs sob `/anpd/pt-br/assuntos/noticias/`, a mais recente de 25/11/2026 11:44. **Não conferi com o coletor real**, só o conteúdo dos sitemaps |

Não existe campo de "baixa frequência" no cadastro: a marcação está em `verification.notes` de cada fonte (e nada impede a coleta).

## 3. URLs de Itaú RI e ICO

- **Itaú RI** (`itau-ri`): `listingUrl` era `null`; agora `https://www.itau.com.br/relacoes-com-investidores/` (página oficial de RI, achada por busca). A busca indica que os fatos relevantes passaram, em 05/2026, a ser publicados em portal de terceiro (`mzgroup.com.br/fatos-relevantes/`), que o coletor não lê: **a conferir**. O site continua devolvendo 403 (Access Denied) ao nosso agente, robots.txt inclusive: nada foi contornado; segue **inacessível, desabilitado e `urlVerified` falso**. Só dá para coletar com decisão do proprietário sobre a via de provedor (DP-31/DP-32) ou com uma fonte alternativa.
- **ICO** (`ico-uk`): `listingUrl` era `null`; agora `https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/`. O ICO declara um feed em `https://ico.org.uk/global/rss-feeds/news-and-blogs/`, que **não** entrou em `feedUrl` porque não foi conferido: o Cloudflare devolve 403 ("Just a moment") ao nosso agente, robots.txt inclusive. Segue **inacessível e desabilitado**.

## 4. Limites e dependências

- Os cadastros novos valem após o deploy (a definição das fontes é código); habilitar é no Studio (admin, com MFA), como antes. Nenhuma fonte foi habilitada por mim.
- As 7 fontes com sitemap novo (OMAAT incluído) foram exercitadas **offline** (testes com servidor simulado); os 2 feeds novos (ABAV, EDPB) e os sitemaps foram só **lidos ao vivo**. Todas as URLs novas foram conferidas contra o robots.txt ao vivo com o parser real do coletor em 25/11/2026: só o feed do OMAAT era proibido.
- O host `www.gov.br` é compartilhado por todos os órgãos: o turismo sozinho lê 11 filhos por rodada. Se a janela horária do host apertar, é o primeiro lugar para reduzir.
- **Regra nova de código (branch `ft/editorial-sitemap-regras`):** `Source.sitemapPathExclude` (até 10 expressões regulares, até 120 caracteres, testadas contra o caminho da URL; o `SourceRegistry` recusa as que não compilam). Usada por Accor (listagens `page/N`) e IDV (a própria `/noticia/`); o aviso `sitemap_no_items` passa a contar "N excluídas" quando há exclusão. O texto antigo dos avisos não muda quando não há.
- **Limite por hora (`maxRequestsPerHour`) subiu** onde a rodada nova não cabia (com 6 a 5ª página sairia em `rate_limited`): `anatel` e `mtur` de 6 para 64; `anac`, `cvm` e `anpd` de 40 para 64 (o host `www.gov.br` passou a ter 5 órgãos: a rodada conjunta no pior caso é 1 robots + 5 × (índice + filhos + 5 páginas) = 61 requisições, a 3 s ou mais cada, ou seja, uns 3 minutos por rodada); `dinheirama`, `guia-bolso-blog`, `nubank-newsroom` e `one-mile-at-a-time` de 6 para 8; `idv` de 6 para 10. O teste `blogs-sitemap.test.ts` foi ajustado de propósito (lista de fontes por sitemap, prefixo com maiúscula como `/Materias/`, e 34 → 61 requisições) e o `fontes-checagem-coleta.test.ts` cobre as quatro fontes de host próprio.
