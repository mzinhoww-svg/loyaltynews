# Fontes secundárias (DP-29): blogs especializados e imprensa de nicho — levantamento de 23/11/2026

Levantamento **somente-leitura** feito pela Frente 06: para cada candidato, 1 leitura do `robots.txt` (antes de qualquer outra página), da home, do feed (anunciado na home ou `/feed`) e, quando há link, da página de termos/direitos. User-Agent identificado (`LoyaltyNewsSourceVerifier/1.0`), ≥ 3 s entre leituras do mesmo host, nenhuma repetição e **nenhum contorno** de 403/402/CAPTCHA/robots. Não é parecer jurídico.

**A classe (A–E) é MECÂNICA:** um script procura vedação ou permissão de reprodução/cópia/automação no texto dos termos que achou. Pode errar nos dois sentidos (ex.: uma cláusula sobre "robots" que trata de outra coisa). O **revisor humano lê o termo** no Studio antes de habilitar; o trecho citado em cada fonte é literal da página (extraído por código).

## Resultado

- Candidatos pesquisados: **72**. Alcançados (robots + home 200): **55**; bloqueados para o nosso UA e registrados como inacessíveis: **11**; não alcançados (DNS/tempo esgotado; URL a revisar, fora do cadastro): **6**.
- Cadastradas em `src/sources/seed-blogs.ts`: **66** (todas desabilitadas). Com feed conferido: **39**. Classes das alcançadas: A=0, B=0, C=20, D=33, E=13.
- Somando as 40 fontes do cadastro anterior (Senado, Câmara, EDPB, órgãos, empresas, associações), o cadastro passa de 40 para **106** fontes.

## Regras do uso (DP-28/DP-29)

- Blog é fonte **secundária**: serve de pauta e contexto. A fábrica **só aprova** matéria com pelo menos uma evidência de **fonte primária** (RI, regulador, governo, associação, sala de imprensa) e todo número, data ou citação precisa estar numa evidência primária (gates `needs_primary_anchor` / `unanchored_claim`). A âncora vem dos links do próprio post que apontam para fontes primárias **habilitadas**; sem âncora a matéria fica bloqueada antes de chamar o modelo (ver `docs/dp29-reescrita-e-autoral.md`).
- Reescrita, nunca reprodução: para fonte secundária o gate de cópia é mais rígido (6 palavras iguais seguidas; 20% de 5-gramas).
- Habilitação: classes **A, B e D** pelo fluxo humano (DP-28/DP-29). **Classe C** só com revisão caso a caso registrada ("CASO A CASO (DP-28)"). **Classe E / inacessível** não é aprovável.
- Sinal de atenção separado: "bloqueia agentes de IA" = o `robots.txt` da fonte proíbe GPTBot, ClaudeBot etc. O nosso coletor tem User-Agent próprio e a regra para ele é a que vale, mas o proprietário deve saber (ver coluna IA).

## Fontes cadastradas

| id | Fonte | Tipo | Editorias | Classe | Feed (itens; mais recente) | Termos lidos | IA bloqueada | Trecho dos termos (literal) |
|---|---|---|---|---|---|---|---|---|
| `passageiro-de-primeira` | [Passageiro de Primeira](https://passageirodeprimeira.com/) | blog | pontos, programas, travel | D | [feed](https://passageirodeprimeira.com/feed/) (30; 2026-11-23) | — | 5 agentes | — |
| `melhores-destinos` | [Melhores Destinos](https://www.melhoresdestinos.com.br/) | blog | travel, pontos, programas | D | [feed](https://www.melhoresdestinos.com.br/feed) (10; 2026-11-23) | — | não | — |
| `pontos-pra-voar` | [Pontos pra Voar](https://pontospravoar.com/) | blog | pontos, programas, travel | D | [feed](https://pontospravoar.com/feed/) (20; 2026-11-23) | — | 3 agentes | — |
| `mestre-das-milhas` | [Mestre das Milhas](https://mestredasmilhas.com/) | blog | pontos, programas | C | [feed](https://mestredasmilhas.com/feed/) (10; 2026-11-16) | [termos](https://mestredasmilhas.com/termos-de-uso/) | 5 agentes | “A reprodução total ou parcial sem autorização prévia é proibida.” |
| `viaje-na-viagem` | [Viaje na Viagem](https://www.viajenaviagem.com/) | blog | travel | D | [feed](https://www.viajenaviagem.com/feed/) (10; 2026-09-17) | [termos](https://www.viajenaviagem.com/termos-de-uso/?utm_source=menusite&utm_medium=termos) | não | — |
| `passagens-promo` | [Passagens Promo](https://passagenspromo.com.br/) | blog | travel, pontos | D | sitemap declarado | [termos](https://passagenspromo.com.br/termos-de-uso/) | não | — |
| `melhores-cartoes` | [Melhores Cartões](https://www.melhorescartoes.com.br/) | blog | bancos, pontos | D | [feed](https://www.melhorescartoes.com.br/rss.xml) (10; 2026-11-23) | — | não | — |
| `dinheirama` | [Dinheirama](https://investimentos.com.br/) | blog | bancos, mercado | D | — | — | não | — |
| `seu-dinheiro` | [Seu Dinheiro](https://www.seudinheiro.com/) | trade_media | bancos, mercado | D | [feed](https://www.seudinheiro.com/feed/) (10; 2026-11-23) | [termos](https://www.seudinheiro.com/2026/internacional/trump-fala-de-tudo-e-nem-o-brasil-escapa-o-que-voce-precisa-saber-sobre-as-novas-ameacas-do-republicano-ccgg/) | não | — |
| `infomoney` | [InfoMoney](https://www.infomoney.com.br/) | trade_media | bancos, mercado | D | [feed](https://www.infomoney.com.br/feed/) (10; 2026-11-23) | [termos](https://www.infomoney.com.br/economia/condicoes-de-credito-ficaram-mais-restritivas-no-3o-trimestre-diz-pesquisa-do-bc/) | não | — |
| `exame` | [Exame](https://exame.com/) | trade_media | mercado, varejo, bancos | C | [feed](https://exame.com/feed/) (25; 2026-11-23) | [termos](https://exame.com/institucional/termos-de-uso/) | não | “Copiar, armazenar ou divulgar o Conteúdo para qualquer outra finalidade que não para uso pessoal é estritamente proibido sem a autorização por escrito da exame.” |
| `brazil-journal` | [Brazil Journal](https://braziljournal.com/) | trade_media | mercado, bancos, varejo | C | [feed](https://braziljournal.com/feed) (15; 2026-11-23) | [termos](https://braziljournal.com/termos-de-uso) | não | “Condições de uso É proibido usar, reproduzir, modificar, traduzir, publicar, transmitir, distribuir, executar, exibir, licenciar, vender, fazer scrapping ou engenharia reversa do site e do conteúdo pa” |
| `panrotas` | [Panrotas](https://www.panrotas.com.br/) | trade_media | travel, mercado | D | [feed](https://www.panrotas.com.br/feed/) (500; 2026-11-22) | — | não | — |
| `aeroflap` | [Aeroflap](https://aeroflap.com.br/) | trade_media | travel | E | — | bloqueada | 4 agentes | home HTTP 403 (bloqueio/desafio) |
| `guia-bolso-blog` | [Meu Bolso em Dia / Educação financeira](https://www.meubolsoemdia.com.br/) | blog | bancos | D | — | [termos](https://pefmbddiag.blob.core.windows.net/cdn-pi/termos_consentimento.pdf) | não | — |
| `meio-e-mensagem` | [Meio & Mensagem](https://www.meioemensagem.com.br/) | trade_media | mercado, crm, varejo | D | [feed](https://www.meioemensagem.com.br/feed) (30; 2026-11-23) | — | não | — |
| `mercado-e-consumo` | [Mercado & Consumo](https://mercadoeconsumo.com.br/) | trade_media | varejo, crm, mercado | D | [feed](https://mercadoeconsumo.com.br/feed/) (10; 2026-11-23) | — | não | — |
| `proxxima` | [Propmark / Proxxima](https://propmark.com.br/) | trade_media | crm, mercado | D | [feed](https://propmark.com.br/feed/) (10; 2026-11-23) | — | não | — |
| `ecommerce-brasil` | [E-Commerce Brasil](https://www.ecommercebrasil.com.br/) | trade_media | varejo, crm, tech | D | sitemap declarado | — | não | — |
| `mundo-do-marketing` | [Mundo do Marketing](https://mundodomarketing.com.br/) | trade_media | crm, mercado, varejo | D | sitemap declarado | [termos](https://mundodomarketing.com.br/termos-de-uso) | não | — |
| `consumidor-moderno` | [Consumidor Moderno](https://consumidormoderno.com.br/) | trade_media | crm, varejo | D | [feed](https://consumidormoderno.com.br/feed/) (12; 2026-11-19) | — | não | — |
| `mobile-time` | [Mobile Time](https://www.mobiletime.com.br/) | trade_media | tech, crm, bancos | D | sitemap declarado | — | não | — |
| `startse` | [StartSe](https://www.startse.com/) | trade_media | tech, mercado | E | [feed](https://www.startse.com/rss.xml) (40; 2026-11-20) | [termos](https://docs.startse.com/politica-de-privacidade) | não | — |
| `rd-station-blog` | [RD Station (blog)](https://www.rdstation.com/blog/) | company_blog | crm | D | sitemap declarado | — | não | — |
| `rock-content-blog` | [Rock Content (blog)](https://rockcontent.com/br/blog/) | company_blog | crm | E | — | bloqueada | não | robots.txt HTTP 402 |
| `opinion-box-blog` | [Opinion Box (blog)](https://blog.opinionbox.com/) | company_blog | crm | D | [feed](https://blog.opinionbox.com/feed/) (10; 2026-10-20) | [termos](https://www.opinionbox.com/termo-de-uso/) | não | — |
| `take-blip-blog` | [Blip (blog)](https://www.blip.ai/blog/) | company_blog | crm, tech | D | [feed](https://www.blip.ai/blog/feed/) (10; 2026-10-27) | — | não | — |
| `sebrae-noticias` | [Sebrae (notícias)](https://sebrae.com.br/empreendedores/conteudos) | association | varejo, mercado | D | sitemap declarado | — | não | — |
| `tecmundo-negocios` | [Canaltech](https://canaltech.com.br/) | trade_media | tech | D | sitemap declarado | — | não | — |
| `tiinside` | [TI Inside](https://tiinside.com.br/) | trade_media | tech, bancos | D | [feed](https://tiinside.com.br/feed/) (30; 2026-11-19) | [termos](https://tiinside.com.br/politica-de-uso-e-privacidade/) | 5 agentes | — |
| `finsiders` | [Finsiders Brasil](https://finsidersbrasil.com.br/) | trade_media | bancos, tech | C | [feed](https://finsidersbrasil.com.br/feed/) (10; 2026-11-20) | [termos](https://finsidersbrasil.com.br/termos-de-uso/) | 4 agentes | “Não copie, modifique, distribua, venda ou alugue qualquer parte dos nossos serviços ou softwares.” |
| `mobile-marketing-br` | [Startups.com.br](https://startups.com.br/) | trade_media | tech, mercado | D | [feed](https://startups.com.br/feed/) (10; 2026-11-23) | [termos](https://startups.com.br/negocios/legaltech/) | 4 agentes | — |
| `administradores` | [Administradores.com](https://www.administradores.com.br/) | trade_media | mercado, crm | E | — | [termos](https://app.administradores.com.br/termos-de-uso) | 1 agentes | — |
| `one-mile-at-a-time` | [One Mile at a Time](https://onemileatatime.com/) | blog | global, programas, travel | C | sitemap declarado | [termos](https://onemileatatime.com/terms-of-use/) | não | “content or information, or otherwise access the Site, using automated means (such as harvesting bots, robots, spiders, or scrapers) without our prior permission;” |
| `the-points-guy` | [The Points Guy](https://thepointsguy.com/) | blog | global, programas, pontos | C | [feed](https://thepointsguy.com/feed) (20; 2026-11-23) | [termos](https://thepointsguy.com/legal/terms-of-use) | não | “Using any of the services or information provided for commercial uses is strictly prohibited.” |
| `view-from-the-wing` | [View from the Wing](https://viewfromthewing.com/) | blog | global, programas, travel | D | [feed](https://viewfromthewing.com/feed/) (10; 2026-11-23) | — | 3 agentes | — |
| `upgraded-points` | [Upgraded Points](https://upgradedpoints.com/) | blog | global, pontos | C | sitemap declarado | [termos](https://upgradedpoints.com/terms-and-conditions/) | não | “Except for this limited license, you may not copy, reproduce, distribute, modify, perform, display, publish, create derivative works from, sell, or otherwise exploit any Content or the Collective Work” |
| `frequent-miler` | [Frequent Miler](https://frequentmiler.com/) | blog | global, pontos | D | [feed](https://frequentmiler.com/feed/) (20; 2026-11-23) | — | 3 agentes | — |
| `doctor-of-credit` | [Doctor of Credit](https://www.doctorofcredit.com/) | blog | global, bancos | E | — | bloqueada | não | robots.txt HTTP 403 |
| `head-for-points` | [Head for Points](https://www.headforpoints.com/) | blog | global, programas | E | — | bloqueada | não | robots.txt HTTP 403 |
| `point-hacks` | [Point Hacks](https://www.pointhacks.com.au/) | blog | global, programas | C | [feed](https://www.pointhacks.com.au/feed/) (20; 2026-11-19) | [termos](https://www.pointhacks.com.au/terms-conditions/) | não | “Except as permitted by the Copyright Act 1968, you may not reproduce, transmit, disseminate, sell, or publish information on this Website without our prior written permission, provided that you may us” |
| `executive-traveller` | [Executive Traveller](https://www.executivetraveller.com/) | trade_media | global, travel | E | — | bloqueada | 1 agentes | home HTTP 403 (bloqueio/desafio) |
| `loyalty-lobby` | [Loyalty Lobby](https://loyaltylobby.com/) | blog | global, programas | E | — | bloqueada | 7 agentes | home HTTP 403 (bloqueio/desafio) |
| `million-mile-secrets` | [Million Mile Secrets](https://millionmilesecrets.com/) | blog | global, pontos | C | [feed](https://millionmilesecrets.com/feed/) (10; 2024-07-25) | [termos](https://millionmilesecrets.com/terms-of-use/) | não | “Using any of the services or information provided for commercial uses is strictly prohibited.” |
| `skift` | [Skift](https://skift.com/) | trade_media | global, travel, mercado | C | [feed](https://skift.com/feed/) (10; 2026-11-23) | [termos](https://skift.com/terms/) | 5 agentes | “This section applies to ordinary browsing, standard search-engine indexing, and other routine automated access;” |
| `phocuswire` | [PhocusWire](https://www.phocuswire.com/) | trade_media | global, travel, tech | E | — | bloqueada | não | robots.txt HTTP 403 |
| `travel-weekly` | [Travel Weekly](https://www.travelweekly.com/) | trade_media | global, travel | E | — | bloqueada | não | robots.txt HTTP 403 |
| `simple-flying` | [Simple Flying](https://simpleflying.com/) | trade_media | global, travel | C | [feed](https://simpleflying.com/feed/) (10; 2026-11-23) | [termos](https://simpleflying.com/boeing-built-737-max-ability-take-off-overweight-cant-legally-operationally/) | 5 agentes | “If you believe any such image is under your copyright and was used without permission, then please email us at legal@valnetinc.com with sufficient written evidence.” |
| `loyalty360` | [Loyalty360](https://loyalty360.org/) | trade_media | global, programas, crm | E | — | bloqueada | não | robots.txt HTTP 403 |
| `loyalty-magazine` | [Loyalty Magazine](https://www.loyaltymagazine.com/) | trade_media | global, programas, crm | D | [feed](https://www.loyaltymagazine.com/feed/) (30; 2026-10-30) | — | não | — |
| `wise-marketer` | [The Wise Marketer](https://thewisemarketer.com/) | trade_media | global, programas, crm | C | sitemap declarado | [termos](https://thewisemarketer.com/terms-of-use/) | não | “Prohibited Activities With regards to our Websites, you may not: copy, distribute or otherwise remove or make available material from our Websites without the express written permission of WMG;” |
| `retail-dive` | [Retail Dive](https://www.retaildive.com/) | trade_media | global, varejo | C | [feed](https://www.retaildive.com/feeds/news/) (10; 2026-11-23) | [termos](https://www.informatechtarget.com/terms-of-use/) | não | “(b) reverse engineer, decompile, modify, translate, disassemble (except to the extent that this restriction is expressly prohibited by law) or create derivative works based upon the Services, includin” |
| `modern-retail` | [Modern Retail](https://www.modernretail.co/) | trade_media | global, varejo | D | [feed](https://www.modernretail.co/feed/) (10; 2026-11-23) | [termos](https://www.modernretail.co/terms-conditions/) | não | — |
| `payments-dive` | [Payments Dive](https://www.paymentsdive.com/) | trade_media | global, bancos, tech | C | [feed](https://www.paymentsdive.com/feeds/news/) (10; 2026-11-23) | [termos](https://www.informatechtarget.com/terms-of-use/) | não | “(b) reverse engineer, decompile, modify, translate, disassemble (except to the extent that this restriction is expressly prohibited by law) or create derivative works based upon the Services, includin” |
| `banking-dive` | [Banking Dive](https://www.bankingdive.com/) | trade_media | global, bancos | C | [feed](https://www.bankingdive.com/feeds/news/) (10; 2026-11-20) | [termos](https://www.informatechtarget.com/terms-of-use/) | não | “(b) reverse engineer, decompile, modify, translate, disassemble (except to the extent that this restriction is expressly prohibited by law) or create derivative works based upon the Services, includin” |
| `marketing-dive` | [Marketing Dive](https://www.marketingdive.com/) | trade_media | global, crm, mercado | C | [feed](https://www.marketingdive.com/feeds/news/) (10; 2026-11-23) | [termos](https://www.informatechtarget.com/terms-of-use/) | não | “(b) reverse engineer, decompile, modify, translate, disassemble (except to the extent that this restriction is expressly prohibited by law) or create derivative works based upon the Services, includin” |
| `finextra` | [Finextra](https://www.finextra.com/) | trade_media | global, bancos, tech | E | — | bloqueada | 5 agentes | home HTTP 403 (bloqueio/desafio) |
| `pymnts` | [PYMNTS](https://www.pymnts.com/) | trade_media | global, bancos, varejo | D | [feed](https://www.pymnts.com/feed/) (10; 2026-11-23) | [termos](https://www.pymnts.com/news/artificial-intelligence/2026/ai-copyright-rulings-put-data-governance-on-the-institutional-agenda/) | não | — |
| `the-paypers` | [The Paypers](https://thepaypers.com/) | trade_media | global, bancos, tech | D | sitemap declarado | — | não | — |
| `customerthink` | [CustomerThink](https://customerthink.com/) | blog | global, crm | D | [feed](https://customerthink.com/feed/) (20; 2026-11-21) | [termos](https://customerthink.com/terms-of-use/) | não | — |
| `cmswire` | [CMSWire](https://www.cmswire.com/) | trade_media | global, crm, tech | C | sitemap declarado | [termos](https://www.simplermedia.com/policies/terms-of-use/) | 2 agentes | “General Terms of Use The RSS feeds may not be spliced into or otherwise redistributed by third-party RSS providers.” |
| `simple-flying-2` | [Airline Geeks](https://airlinegeeks.com/) | blog | global, travel | C | [feed](https://airlinegeeks.com/feed/) (10; 2026-11-20) | [termos](https://airlinegeeks.com/terms-of-use/) | não | “Nothing on the Site may be copied, reproduced, uploaded, publicly displayed, republished, translated, or distributed in anyway without the express written authorization of AG.” |
| `nerdwallet-travel` | [NerdWallet (viagens e cartões)](https://www.nerdwallet.com/) | blog | global, bancos, pontos | C | sitemap declarado | [termos](https://www.nerdwallet.com/terms-of-use) | não | “f) Access, monitor or copy any content or information of the Site using any robot, scripts, spider, scraper, or other automated means or for any purpose or any manual process to collect information or” |
| `boarding-area` | [BoardingArea](https://boardingarea.com/) | blog | global, programas, travel | C | [feed](https://boardingarea.com/feed/) (20; 2026-11-23) | [termos](https://boardingarea.com/terms-legal/) | 3 agentes | “Your Use of Our Content is Restricted: (a) Unless expressly permitted, you may not copy, reproduce, distribute, publish, enter into a database, display, perform, modify, create derivative works from, ” |
| `travel-codex` | [Travel Codex](https://www.travelcodex.com/) | blog | global, programas | D | [feed](http://www.travelcodex.com/feed/) (20; 2026-11-16) | — | 3 agentes | — |
| `mile-high-pass` | [Mile Value](https://milevalue.com/) | blog | global, pontos | E | — | bloqueada | não | robots.txt HTTP 403 |

## Não alcançados (fora do cadastro)

DNS, conexão ou tempo esgotado na leitura. Provável URL errada ou site fora do ar; precisa de revisão manual antes de reentrar:

- `pontos-pelo-mundo` — Pontos pelo Mundo (https://pontospelomundo.com.br/): fetch failed
- `aeroin` — AEROIN (https://www.aeroin.net/): terminated
- `mobills-blog` — Mobills (blog) (https://blog.mobills.com.br/): fetch failed
- `supermercado-moderno` — Supermercado Moderno (https://www.supermercadomoderno.com.br/): fetch failed
- `loyalty-brasil-blog` — Zeta / Eloyalty & fidelidade (busca) (https://www.clubedofidelidade.com.br/): fetch failed
- `points-miles-martinis` — Points, Miles & Martinis (https://www.pointsmilesandmartinis.com/): fetch failed

## Prontas para a revisão humana (sugestão de ordem)

- **Classe D com feed conferido (23):** `passageiro-de-primeira`, `melhores-destinos`, `pontos-pra-voar`, `viaje-na-viagem`, `melhores-cartoes`, `seu-dinheiro`, `infomoney`, `panrotas`, `meio-e-mensagem`, `mercado-e-consumo`, `proxxima`, `consumidor-moderno`, `opinion-box-blog`, `take-blip-blog`, `tiinside`, `mobile-marketing-br`, `view-from-the-wing`, `frequent-miler`, `loyalty-magazine`, `modern-retail`, `pymnts`, `customerthink`, `travel-codex`. Revisão = ler o termo, conferir robots, uma matéria e o paywall; a DP-29 aceita o risco.
- **Classe D sem feed (10):** `passagens-promo`, `dinheirama`, `guia-bolso-blog`, `ecommerce-brasil`, `mundo-do-marketing`, `mobile-time`, `rd-station-blog`, `sebrae-noticias`, `tecmundo-negocios`, `the-paypers`. Só coletáveis se declararem sitemap (cadastrado quando o robots.txt o declara) ou depois de feed/sitemap verificado.
- **Classe C (20), só caso a caso (DP-28):** `mestre-das-milhas`, `exame`, `brazil-journal`, `finsiders`, `one-mile-at-a-time`, `the-points-guy`, `upgraded-points`, `point-hacks`, `million-mile-secrets`, `skift`, `simple-flying`, `wise-marketer`, `retail-dive`, `payments-dive`, `banking-dive`, `marketing-dive`, `cmswire`, `simple-flying-2`, `nerdwallet-travel`, `boarding-area`.
- **Classe E / inacessível (13), não aprováveis:** `aeroflap`, `startse`, `rock-content-blog`, `administradores`, `doctor-of-credit`, `head-for-points`, `executive-traveller`, `loyalty-lobby`, `phocuswire`, `travel-weekly`, `loyalty360`, `finextra`, `mile-high-pass`. Caminho legítimo: feed/newsletter pública ou autorização do titular; nunca contornar.

Pré-requisito: blog só gera matéria se houver fonte **primária habilitada** que ele linke (âncora). Habilitar primeiro Senado, Câmara e as fontes de empresa/associação desejadas.

## Como habilitar (resumo)

Studio → Fontes da Fábrica: (1) **revisão** por pessoa diferente do pesquisador (`ln-editorial-engineer`): abrir o termo, o `robots.txt`, uma matéria, conferir paywall e registrar a nota ("DP-28/DP-29, classe X, risco aceito"); (2) **habilitação** por `admin` ou `editor_chefe`. Fontes com paywall (`metered`/`login`) não são aprováveis. O `paywall` está `unknown` em todas até o revisor conferir.

Limitações: a pesquisa leu **uma** página de termos por fonte (as duas primeiras que o rodapé linkava) e não renderizou JavaScript; blogs cujo termo só carrega por JavaScript saem como D ou E. Nenhuma matéria foi lida além da contagem e da data dos itens do feed.
