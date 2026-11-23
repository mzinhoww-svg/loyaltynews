# Fontes de empresas (RI e sites oficiais) — sonda de acessibilidade (DP-28/DP-29)

Para o Editorial cadastrar e para o fluxo humano de habilitação (Studio). Sonda refeita em 2026-11-23 por `scripts/probe-sources.mjs` depois do parecer do QA 2 (dados em `data/fontes-empresas.candidatos.sonda.json`). **A sonda não habilita nada, não verifica conteúdo e não lê os termos de cada fonte** (J-14 caso a caso; a DP-28 aceita o risco do proprietário para fontes de mercado, exceto classe C).

## Regras seguidas (revisadas após o parecer do QA 2 sobre 480250c)
- **Redirecionamento NÃO é seguido**: a sonda registra o 3xx e o destino; o destino só é lido se for cadastrado como candidata própria, com o seu robots.txt. Nesta rodada 4 candidatas redirecionaram (Santander RI e RD Saúde para OUTRO host; Uber e Smiles para outro caminho do mesmo host) e os 4 destinos foram sondados como candidatas separadas (`*-destino`). Um destino pode, por sua vez, redirecionar: o estado dele diz.
- **robots.txt pelo RFC 9309**: grupos por User-Agent, curinga `*` e âncora `$` em qualquer posição, regra mais longa vence, empate favorece Allow. Nenhuma decisão anterior mudou com o novo analisador (conferido de novo para as 28 URLs).
- **Página de desafio/CAPTCHA com HTTP 200** vira `bloqueada_desafio` (título de desafio, cabeçalho `cf-mitigated`, marcadores de WAF e frase de verificação humana, em página de qualquer tamanho; widget de captcha só em página vazia ou curta que fale em verificação). Nunca contornado.
- `robots.txt` consultado antes de cada página; se proíbe ou não pôde ser lido, a página **não** foi buscada. **Uma requisição por URL**, pausa de 2 s, User-Agent identificado, sem repetir, sem trocar de User-Agent, sem rotas alternativas. 403/429/CAPTCHA = "bloqueada", ponto final.
- Classe C (Azul, GOL, ABECS, IATA, Nubank, Accor, Marriott, Salesforce, HubSpot, Zendesk, oneworld, ABAV) fora da lista.
- Quatro páginas "parciais ou casca" foram abertas **uma vez** no navegador do OpenBot (renderização JavaScript) para ver se há conteúdo: Stix, BRB RI, Vibra RI e Esfera.

## Resultado (28 candidatas)
- `acessivel`: 21
- `redirecionada`: 4
- `bloqueada_http`: 1
- `acessivel_requer_navegador`: 2

## Reavaliação pedida (Editorial registrara "inacessível" em 22/11)
| Fonte | Hoje (23/11, para o User-Agent identificado) | Leitura |
|---|---|---|
| Livelo (imprensa) | HTTP 200, 13339 caracteres de texto estático, robots permite, 1 sitemap declarado | **Acessível.** A página lista as manchetes da própria Livelo. Pode ter sido o User-Agent do coletor ou mudança do site; reavaliar no cadastro. |
| Magalu RI | HTTP 200, 5739 caracteres, robots.txt ausente | **Acessível.** Sem robots.txt (nada a respeitar além da cortesia: uma requisição, espaçada). |
| Santander RI | `ri.santander.com.br` responde **redirecionamento (HTTP 302) para `https://www.santander.com.br/ri/`**, que **não foi seguido**; o destino, sondado como candidata própria (`santander-ri-destino`) com robots próprio, responde HTTP 200, 2307 caracteres | **Acessível pelo endereço de destino.** Cadastrar `www.santander.com.br/ri/` (o host antigo só redireciona). |

Observação honesta: "acessível" vale para **esta** leitura (uma requisição). Se o coletor do Editorial recebe 403 com o User-Agent dele, **não** contornar: registrar bloqueada e seguir por RSS/sitemap/newsletter pública.

## Tabela completa
| Fonte | Tipo | Estado | HTTP | Texto (caract.) | Renderização | Sitemaps no robots | Feeds declarados | Observação |
|---|---|---|---|---|---|---|---|---|
| Livelo — imprensa | imprensa | acessivel | 200 | 13339 | estatica | 1 | 0 |  |
| Magalu — Relações com Investidores | ri | acessivel | 200 | 5739 | estatica | 0 | 0 |  |
| Santander Brasil — Relações com Investidores | ri | redirecionada | 302 | — | — | 0 | 0 | → https://www.santander.com.br/ri/. HTTP 302: redirecionamento NÃO seguido; o destino é outra candidata, com o próprio robots.txt |
| Itaú Unibanco — Relações com Investidores | ri | acessivel | 200 | 5569 | estatica | 5 | 0 |  |
| Bradesco — Relações com Investidores | ri | acessivel | 200 | 3231 | estatica | 1 | 0 |  |
| Banco do Brasil — Relações com Investidores | ri | acessivel | 200 | 2543 | estatica | 1 | 0 |  |
| LATAM Airlines Group — Investor Relations | ri | bloqueada_http | 403 | 58 | — | 0 | 0 | HTTP 403: não repetir nem contornar |
| Dotz — Relações com Investidores | ri | acessivel | 200 | 1965 | estatica | 1 | 0 |  |
| GPA (Pão de Açúcar) — Relações com Investidores | ri | acessivel | 200 | 1746 | estatica | 1 | 0 |  |
| Raia Drogasil — Relações com Investidores | ri | redirecionada | 302 | — | — | 0 | 0 | → https://ri.rdsaude.com.br/default.aspx. HTTP 302: redirecionamento NÃO seguido; o destino é outra candidata, com o próprio robots.txt |
| Natura — Relações com Investidores | ri | acessivel | 200 | 3165 | estatica | 1 | 0 |  |
| Inter&Co — Investor Relations | ri | acessivel | 200 | 3253 | estatica | 1 | 0 |  |
| XP Inc. — Investor Relations | ri | acessivel | 200 | 2978 | estatica | 1 | 0 |  |
| BRB — Relações com Investidores | ri | acessivel | 200 | 1395 | parcial_ou_casca | 0 | 0 |  |
| Banco BV — Relações com Investidores | ri | acessivel | 200 | 1997 | estatica | 1 | 0 |  |
| Vibra Energia — Relações com Investidores (Premmia) | ri | acessivel | 200 | 1002 | parcial_ou_casca | 1 | 0 |  |
| Americanas — Relações com Investidores | ri | acessivel | 200 | 2259 | estatica | 1 | 0 |  |
| Mastercard — newsroom América Latina | imprensa | acessivel | 200 | 123749 | estatica | 1 | 0 |  |
| Uber — newsroom Brasil | imprensa | redirecionada | 301 | — | — | 1 | 0 | → https://www.uber.com/BR/pt-BR/newsroom/. HTTP 301: redirecionamento NÃO seguido; o destino é outra candidata, com o próprio robots.txt |
| Stix — site oficial | site_oficial | acessivel_requer_navegador | 200 | 25 | js_provavel | 0 | 0 |  |
| Esfera — site oficial | site_oficial | acessivel | 200 | 858 | parcial_ou_casca | 1 | 0 |  |
| Dotz — site oficial | site_oficial | acessivel_requer_navegador | 200 | 61 | js_provavel | 0 | 0 |  |
| LATAM Pass — site oficial | site_oficial | acessivel | 200 | 4642 | estatica | 1 | 0 |  |
| Smiles — site oficial | site_oficial | redirecionada | 302 | — | — | 1 | 0 | → https://www.smiles.com.br/home. HTTP 302: redirecionamento NÃO seguido; o destino é outra candidata, com o próprio robots.txt |
| Santander Brasil — RI (destino do redirecionamento de ri.santander.com.br) | ri | acessivel | 200 | 2307 | estatica | 3 | 0 |  |
| Raia Drogasil / RD Saúde — RI (destino do redirecionamento de ri.rd.com.br) | ri | acessivel | 200 | 4584 | estatica | 0 | 0 |  |
| Uber — newsroom Brasil (destino do redirecionamento) | imprensa | acessivel | 200 | 3240 | estatica | 1 | 0 |  |
| Smiles — site oficial (destino do redirecionamento) | site_oficial | acessivel | 200 | 7789 | estatica | 1 | 0 |  |

## O que isto significa para o cadastro
- **Feeds RSS/Atom**: nenhuma das 28 páginas declara `<link rel="alternate" type="application/rss+xml">`. Para coleta, o caminho legítimo é **sitemap** (declarado no robots.txt de 20 fontes) e as **seções de comunicados** dos RIs, com coleta espaçada. O LATAM IR teria RSS segundo o Editorial (22/11); a página principal respondeu 403 aqui: tentar o feed com o coletor e, se 403, registrar bloqueada.
- **Redirecionamentos**: cadastrar o destino, não a origem (ver os 4 casos acima). O Editorial deve aplicar a mesma regra no coletor: ler o robots.txt do host de destino antes de buscar.
- **Bloqueadas**: LATAM IR (HTTP 403, não repetido). **Natura, Inter e XP**: o host candidato estava errado (robots.txt ilegível); com os hosts corrigidos (ri.natura.com.br, investors.inter.co/en/, investors.xpinc.com/en/) as três respondem HTTP 200 com texto estático, robots permite e 1 sitemap declarado cada.
- **Só no navegador**: Dotz (site; já capturado no seed) e Stix. **Stix**: a página atual ("Stix.com.br | Em Evolução", 489 caracteres) não descreve um programa de fidelidade; não serve como fonte editorial e merece revisão humana.
- **Achado extra**: o título da página da Esfera diz "Esfera: O programa de pontos e recompensas do Santander" (em HTML estático). Isso sustenta uma relação Santander→Esfera com citação literal (seed v3).
- **Mastercard newsroom** (123749 caracteres) e **Uber newsroom** respondem com texto estático; viram candidatas a fonte editorial de mercado após revisão humana.

## Limites
Uma leitura por URL em 23/11/2026; não é verificação de conteúdo; termos de uso de cada fonte **não** foram lidos aqui (a DP-28 aceita o risco, mas a revisão caso a caso vale para qualquer fonte com proibição expressa); "tipo" das candidatas é triagem, não fato.

## Adendo (fase 2): páginas de diretoria/administração lidas para cargos (seed v4)
10 organizações, páginas oficiais de RI/governança (ver `STAGING_LOAD_PLAN.md`, "Carga v4", e `data/captures/*.meta.json` para URL, data, método e sha256): Bradesco (`bradescori.com.br`), Banco do Brasil (`ri.bb.com.br`), Banco Santander (Brasil) (`santander.com.br/ri`), Dotz (`ri.dotz.com.br`), BRB (`ri.brb.com.br`), Banco BV (`ri.bv.com.br`), GPA (`gpari.com.br`), LATAM (`ir.latam.com`, só pelo leitor em modo navegador do provedor: HTTP direto dá 403), Raia Drogasil (`ri.rdsaude.com.br`) e Uber (`investor.uber.com`). Descobertas por busca restrita ao domínio (Exa, só links). **Fora:** ABEMF (página sem dirigentes nomeados) e Azul (classe C da DP-28; não usada).
