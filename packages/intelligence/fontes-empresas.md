# Fontes de empresas (RI e sites oficiais) — sonda de acessibilidade (DP-28/DP-29)

Para o Editorial cadastrar e para o fluxo humano de habilitação (Studio). Gerado em 2026-11-23 por `scripts/probe-sources.mjs` (dados em `data/fontes-empresas.candidatos.sonda.json`). **A sonda não habilita nada, não verifica conteúdo e não lê os termos de cada fonte** (J-14 caso a caso; a DP-28 aceita o risco do proprietário para fontes de mercado, exceto classe C).

## Regras seguidas
- `robots.txt` consultado antes de cada página; se proíbe ou não pôde ser lido, a página **não** foi buscada.
- **Uma requisição por URL**, pausa de 2 s, User-Agent identificado, sem repetir, sem trocar de User-Agent, sem rotas alternativas. 403/429/CAPTCHA = "bloqueada", ponto final.
- Classe C (Azul, GOL, ABECS, IATA, Nubank, Accor, Marriott, Salesforce, HubSpot, Zendesk, oneworld, ABAV) fora da lista.
- Quatro páginas "parciais ou casca" foram abertas **uma vez** no navegador do OpenBot (renderização JavaScript) para ver se há conteúdo: Stix, BRB RI, Vibra RI e Esfera.

## Resultado (24 candidatas)
- `acessivel`: 18
- `bloqueada_http`: 1
- `robots_inacessivel_nao_buscada`: 3
- `acessivel_requer_navegador`: 2

## Reavaliação pedida (Editorial registrara "inacessível" em 22/11)
| Fonte | Hoje (23/11, para o User-Agent identificado) | Leitura |
|---|---|---|
| Livelo (imprensa) | HTTP 200, 13339 caracteres de texto estático, robots permite, 1 sitemap declarado | **Acessível.** A página lista as manchetes da própria Livelo. Pode ter sido o User-Agent do coletor ou mudança do site; reavaliar no cadastro. |
| Magalu RI | HTTP 200, 5739 caracteres, robots.txt ausente | **Acessível.** Sem robots.txt (nada a respeitar além da cortesia: uma requisição, espaçada). |
| Santander RI | HTTP 200, 2307 caracteres, robots permite | **Acessível.** Texto curto: a lista de comunicados provavelmente está em páginas internas (não visitadas). |

Observação honesta: "acessível" vale para **esta** leitura (uma requisição). Se o coletor do Editorial recebe 403 com o User-Agent dele, **não** contornar: registrar bloqueada e seguir por RSS/sitemap/newsletter pública.

## Tabela completa
| Fonte | Tipo | Estado | HTTP | Texto (caract.) | Renderização | Sitemaps no robots | Feeds declarados | Observação |
|---|---|---|---|---|---|---|---|---|
| Livelo — imprensa | imprensa | acessivel | 200 | 13339 | estatica | 1 | 0 |  |
| Magalu — Relações com Investidores | ri | acessivel | 200 | 5739 | estatica | 0 | 0 |  |
| Santander Brasil — Relações com Investidores | ri | acessivel | 200 | 2307 | estatica | 0 | 0 |  |
| Itaú Unibanco — Relações com Investidores | ri | acessivel | 200 | 5569 | estatica | 5 | 0 |  |
| Bradesco — Relações com Investidores | ri | acessivel | 200 | 3231 | estatica | 1 | 0 |  |
| Banco do Brasil — Relações com Investidores | ri | acessivel | 200 | 2543 | estatica | 1 | 0 |  |
| LATAM Airlines Group — Investor Relations | ri | bloqueada_http | 403 | 58 | — | 0 | 0 | HTTP 403: não repetir nem contornar |
| Dotz — Relações com Investidores | ri | acessivel | 200 | 1965 | estatica | 1 | 0 |  |
| GPA (Pão de Açúcar) — Relações com Investidores | ri | acessivel | 200 | 1746 | estatica | 1 | 0 |  |
| Raia Drogasil — Relações com Investidores | ri | acessivel | 200 | 4584 | estatica | 0 | 0 |  |
| Natura &Co — Relações com Investidores | ri | robots_inacessivel_nao_buscada | — | — | — | 0 | 0 | robots.txt não pôde ser lido (rede, DNS, TLS ou HTTP de erro): por precaução não buscada; confirmar o host real da fonte |
| Banco Inter — Relações com Investidores | ri | robots_inacessivel_nao_buscada | — | — | — | 0 | 0 | robots.txt não pôde ser lido (rede, DNS, TLS ou HTTP de erro): por precaução não buscada; confirmar o host real da fonte |
| XP Inc. — Relações com Investidores | ri | robots_inacessivel_nao_buscada | — | — | — | 0 | 0 | robots.txt não pôde ser lido (rede, DNS, TLS ou HTTP de erro): por precaução não buscada; confirmar o host real da fonte |
| BRB — Relações com Investidores | ri | acessivel | 200 | 1395 | parcial_ou_casca | 0 | 0 |  |
| Banco BV — Relações com Investidores | ri | acessivel | 200 | 1997 | estatica | 1 | 0 |  |
| Vibra Energia — Relações com Investidores (Premmia) | ri | acessivel | 200 | 1002 | parcial_ou_casca | 1 | 0 |  |
| Americanas — Relações com Investidores | ri | acessivel | 200 | 2259 | estatica | 1 | 0 |  |
| Mastercard — newsroom América Latina | imprensa | acessivel | 200 | 123749 | estatica | 1 | 0 |  |
| Uber — newsroom Brasil | imprensa | acessivel | 200 | 3240 | estatica | 1 | 0 |  |
| Stix — site oficial | site_oficial | acessivel_requer_navegador | 200 | 25 | js_provavel | 0 | 0 |  |
| Esfera — site oficial | site_oficial | acessivel | 200 | 858 | parcial_ou_casca | 1 | 0 |  |
| Dotz — site oficial | site_oficial | acessivel_requer_navegador | 200 | 61 | js_provavel | 0 | 0 |  |
| LATAM Pass — site oficial | site_oficial | acessivel | 200 | 4642 | estatica | 1 | 0 |  |
| Smiles — site oficial | site_oficial | acessivel | 200 | 7789 | estatica | 1 | 0 |  |

## O que isto significa para o cadastro
- **Feeds RSS/Atom**: nenhuma das 24 páginas declara `<link rel="alternate" type="application/rss+xml">`. Para coleta, o caminho legítimo é **sitemap** (declarado no robots.txt de 14 fontes) e as **seções de comunicados** dos RIs, com coleta espaçada. O LATAM IR teria RSS segundo o Editorial (22/11); a página principal respondeu 403 aqui: tentar o feed com o coletor e, se 403, registrar bloqueada.
- **Bloqueadas**: LATAM IR (HTTP 403, não repetido). Natura, Inter e XP: o `robots.txt` **não pôde ser lido** (rede/DNS/TLS) — o host candidato pode estar errado; confirmar o endereço real do RI antes de concluir qualquer coisa (por precaução a página não foi buscada).
- **Só no navegador**: Dotz (site; já capturado no seed) e Stix. **Stix**: a página atual ("Stix.com.br | Em Evolução", 489 caracteres) não descreve um programa de fidelidade; não serve como fonte editorial e merece revisão humana.
- **Achado extra**: o título da página da Esfera diz "Esfera: O programa de pontos e recompensas do Santander" (em HTML estático). Isso sustenta uma relação Santander→Esfera com citação literal; **não** entrou no conjunto verificável v2 (entraria numa v3, com nova verificação, parecer do QA e nova carga).
- **Mastercard newsroom** (123 mil caracteres) e **Uber newsroom** respondem com texto estático; viram candidatas a fonte editorial de mercado após revisão humana.

## Limites
Uma leitura por URL em 23/11/2026; não é verificação de conteúdo; termos de uso de cada fonte **não** foram lidos aqui (a DP-28 aceita o risco, mas a revisão caso a caso vale para qualquer fonte com proibição expressa); "tipo" das candidatas é triagem, não fato.
