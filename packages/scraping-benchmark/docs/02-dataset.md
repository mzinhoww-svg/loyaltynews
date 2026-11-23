# 02 — Dataset de 100 URLs reais (v1.1)

Fonte: 43 feeds/sitemaps públicos lidos diretamente em 23/11/2026, custo zero (scripts/build-dataset.ts). Nenhuma URL inventada: todas vêm de um feed. Seleção determinística por round-robin entre feeds (scripts/select-dataset.ts) e correção de recência pela data real (scripts/fix-recency.ts, v1.1: 6 trocas registradas em data/dataset-v1.1-changes.json).

Arquivo versionado: `packages/scraping-benchmark/data/dataset.json`. Campos: domínio, país, idioma, data, tipo, dificuldade, método e fonte de descoberta, condição de acesso, paywall, necessidade de JS (null = não verificado), histórico de erros, título de referência (do feed).

## Distribuição

| Categoria | Recente (≤ 30 d) | Histórico (> 30 d) | Problema | Total |
|---|---:|---:|---:|---:|
| financeiro | 18 | 7 | 0 | 25 |
| fintech | 11 | 4 | 5 | 20 |
| aviacao-fidelidade | 12 | 8 | 0 | 20 |
| tecnologia | 14 |  | 0 | 15 |
| restritivo | 0 | 0 | 15 | 15 |
| internacional | 5 | 0 | 0 | 5 |
| **Total** | 60 | 20 | 20 | 100 |

Domínios distintos: 30. Idiomas: pt 79, en 21. Paywall (parcial): 8 — fora do denominador 'elegível' (DP-32: não furar paywall).

**Problema** = 15 de portais tecnicamente restritivos (paywall poroso, 403 ao UA, anti-bot, robots contra bots de IA) + 5 do BCB (páginas SPA). **Desvio registrado**: a primeira versão usou a página antiga do feed como 'histórico', mas em sites de alto volume ela tinha mediana de 4 dias; a v1.1 reclassifica pela data real.

**Amostra de referência**: o título e a data de referência vêm do feed (fonte independente do extrator). A revisão humana/independente da qualidade fica para o QA 3 (não feita por este bot).

## Experimento A — descoberta (RSS/Atom/sitemap, custo US$ 0)

| Fonte | Página | Status | Tipo | Itens | Únicos | Dup. | Com data | ≤ 7 d | ms |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| https://www.infomoney.com.br/feed/ | recente | 200 | rss | 10 | 10 | 0 | 10 | 10 | 456 |
| https://www.infomoney.com.br/feed/?paged=60 | historico | 200 | rss | 10 | 10 | 0 | 10 | 10 | 907 |
| https://www.moneytimes.com.br/feed/ | recente | 200 | rss | 10 | 10 | 0 | 10 | 10 | 43 |
| https://www.moneytimes.com.br/feed/?paged=60 | historico | 200 | rss | 10 | 10 | 0 | 10 | 0 | 336 |
| https://www.seudinheiro.com/feed/ | recente | 200 | rss | 10 | 10 | 0 | 10 | 10 | 43 |
| https://www.seudinheiro.com/feed/?paged=60 | historico | 200 | rss | 10 | 10 | 0 | 10 | 0 | 446 |
| https://exame.com/feed/ | recente | 200 | rss | 25 | 25 | 0 | 25 | 25 | 50 |
| https://www.gov.br/cvm/pt-br/assuntos/noticias/2026/rss.xml | recente | 200 | rss | 15 | 15 | 0 | 15 | 0 | 1231 |
| https://www12.senado.leg.br/noticias/rss.xml | recente | 200 | rss | 15 | 15 | 0 | 15 | 15 | 197 |
| https://www.mercadoeconsumo.com.br/feed/ | recente | 200 | rss | 10 | 10 | 0 | 10 | 10 | 1080 |
| https://www.mercadoeconsumo.com.br/feed/?paged=60 | historico | 200 | rss | 10 | 10 | 0 | 10 | 0 | 1753 |
| https://finsidersbrasil.com.br/feed/ | recente | 200 | rss | 10 | 10 | 0 | 10 | 10 | 90 |
| https://finsidersbrasil.com.br/feed/?paged=40 | historico | 200 | rss | 10 | 10 | 0 | 10 | 10 | 21 |
| https://www.mobiletime.com.br/feed/ | recente | 200 | rss | 20 | 20 | 0 | 20 | 20 | 66 |
| https://www.mobiletime.com.br/feed/?paged=60 | historico | 200 | rss | 20 | 20 | 0 | 20 | 0 | 630 |
| https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/noticias?ano=2026 | recente | 200 | atom | 10 | 10 | 0 | 10 | 0 | 679 |
| https://www.finextra.com/rss/headlines.aspx | recente | 403 | unknown | 0 | 0 | 0 | 0 | 0 | 48 |
| https://www.paymentsdive.com/feeds/news/ | recente | 200 | rss | 10 | 10 | 0 | 10 | 10 | 532 |
| https://www.pymnts.com/feed/ | recente | 200 | rss | 10 | 10 | 0 | 10 | 10 | 65 |
| https://passageirodeprimeira.com/feed/ | recente | 200 | rss | 30 | 30 | 0 | 30 | 30 | 243 |
| https://passageirodeprimeira.com/feed/?paged=80 | historico | 200 | rss | 30 | 30 | 0 | 30 | 0 | 229 |
| https://www.melhoresdestinos.com.br/feed | recente | 200 | rss | 10 | 10 | 0 | 10 | 10 | 107 |
| https://www.melhoresdestinos.com.br/feed?paged=80 | historico | 200 | rss | 10 | 10 | 0 | 10 | 10 | 20 |
| https://aeroin.net/feed/ | recente | 404 | unknown | 0 | 0 | 0 | 0 | 0 | 1979 |
| https://aeroin.net/feed/?paged=80 | historico | 404 | unknown | 0 | 0 | 0 | 0 | 0 | 1522 |
| https://www.iata.org/api/rss/pressrelease | recente | 200 | rss | 50 | 50 | 0 | 50 | 2 | 246 |
| https://www.airlines.org/feed/ | recente | 200 | rss | 10 | 10 | 0 | 10 | 0 | 34 |
| https://www.pontospravoar.com/feed | recente | 200 | rss | 20 | 20 | 0 | 20 | 20 | 816 |
| https://www.pontospravoar.com/feed?paged=60 | historico | 0 | unknown | 0 | 0 | 0 | 0 | 0 | 30038 |
| https://tecnoblog.net/feed/ | recente | 200 | rss | 50 | 50 | 0 | 50 | 50 | 108 |
| https://tecnoblog.net/feed/?paged=80 | historico | 200 | rss | 50 | 50 | 0 | 50 | 50 | 322 |
| https://olhardigital.com.br/feed/ | recente | 200 | rss | 10 | 10 | 0 | 10 | 10 | 77 |
| https://canaltech.com.br/rss/ | recente | 200 | rss | 50 | 50 | 0 | 50 | 50 | 1140 |
| https://brasscom.org.br/feed/ | recente | 200 | rss | 21 | 21 | 0 | 21 | 0 | 65 |
| https://ir.latam.com/rss/pressrelease.aspx | recente | 200 | rss | 9 | 9 | 0 | 9 | 0 | 880 |
| https://www.camara.leg.br/noticias/rss/ultimas-noticias | recente | 200 | rss | 20 | 20 | 0 | 20 | 20 | 250 |
| https://feeds.folha.uol.com.br/mercado/rss091.xml | recente | 200 | rss | 100 | 100 | 0 | 100 | 100 | 114 |
| https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/ | recente | 200 | rss | 20 | 20 | 0 | 20 | 20 | 86 |
| https://www.bloomberglinea.com.br/arc/outboundfeeds/rss/?outputType=xml | recente | 200 | rss | 100 | 100 | 0 | 100 | 10 | 91 |
| https://valor.globo.com/rss/valor | recente | 200 | rss | 100 | 100 | 0 | 100 | 100 | 51 |
| https://thepointsguy.com/feed/ | recente | 200 | rss | 20 | 20 | 0 | 20 | 20 | 155 |
| https://simpleflying.com/feed/ | recente | 200 | rss | 10 | 10 | 0 | 10 | 10 | 557 |
| https://onemileatatime.com/feed/ | recente | 200 | rss | 25 | 25 | 0 | 25 | 25 | 193 |

Fontes com itens: 39 de 43. Falhas: finextra (403 ao UA), aeroin.net/feed (404), pontospravoar página antiga (erro de rede). Exa Search não foi medido nesta rodada (o Data já validou a descoberta restrita ao domínio).

## Lista

| ID | Categoria | Recência | Domínio | Idioma | Data | Acesso | Histórico de erro |
|---|---|---|---|---|---|---|---|
| u101 | financeiro | historico | [seudinheiro.com](https://www.seudinheiro.com/2026/economia/mega-sena-acumula-de-novo-premio-200-milhoes-dia-de-sorte-brilha-sozinha-loterias-lotofacil-quina-rsgp/) | pt | 2026-10-21 | publico |  |
| u002 | financeiro | historico | [mercadoeconsumo.com.br](https://mercadoeconsumo.com.br/20/10/2026/gestao/renata-araujo-e-a-nova-secretaria-geral-da-aneel-e-a-primeira-mulher-a-ocupar-o-cargo/) | pt | 2026-10-20 | publico |  |
| u102 | financeiro | historico | [seudinheiro.com](https://www.seudinheiro.com/2026/carreiras/premio-leva-5-universitarios-brasileiros-a-china-o-que-eles-fizeram-para-ganhar-a-viagem-miql/) | pt | 2026-10-21 | publico |  |
| u004 | financeiro | historico | [seudinheiro.com](https://www.seudinheiro.com/2026/empresas/bradesco-bbdc4-chega-ao-balanco-com-quase-r-10-bilhoes-a-mais-no-caixa-mas-ainda-precisa-convencer-que-a-virada-veio-para-ficar-miql/) | pt | 2026-10-21 | publico |  |
| u103 | financeiro | historico | [seudinheiro.com](https://www.seudinheiro.com/2026/carreiras/o-conselho-do-ceo-do-btg-pactual-para-quem-quer-crescer-na-carreira-mesmo-sem-estar-pronto-miql/) | pt | 2026-10-21 | publico |  |
| u006 | financeiro | historico | [mercadoeconsumo.com.br](https://mercadoeconsumo.com.br/20/10/2026/produtos/sandisk-lanca-cartoes-de-memoria-e-unidades-usb-c-para-oculos-de-realidade-virtual-da-meta/) | pt | 2026-10-20 | publico |  |
| u007 | financeiro | recente | [exame.com](https://exame.com/brasil/camara-deve-votar-hoje-o-ajuste-fiscal-entenda-a-proposta-do-governo-lula/) | pt | 2026-11-23 | publico |  |
| u008 | financeiro | recente | [gov.br](https://www.gov.br/cvm/pt-br/assuntos/noticias/2026/aberta-consulta-publica-para-tornar-obrigatorio-pronunciamento-tecnico-cpc-34-exploracao-e-avaliacao-de-recursos-minerais) | pt | 2026-11-06 | publico |  |
| u009 | financeiro | recente | [infomoney.com.br](https://www.infomoney.com.br/economia/ipc-s-fica-estavel-em-038-na-3a-quadrissemana-de-novembro-diz-fgv/) | pt | 2026-11-23 | publico |  |
| u010 | financeiro | recente | [mercadoeconsumo.com.br](https://mercadoeconsumo.com.br/23/11/2026/noticias/vendedor-de-loja-fazendo-live-a-china-ja-testou-e-a-licao-vai-alem-da-camera/) | pt | 2026-11-23 | publico |  |
| u011 | financeiro | recente | [moneytimes.com.br](https://www.moneytimes.com.br/rd-saude-radl3-brava-energia-brav3-jbs-jbss32-e-outros-destaques-desta-segunda-feira-mlem/) | pt | 2026-11-23 | publico |  |
| u012 | financeiro | recente | [seudinheiro.com](https://www.seudinheiro.com/2026/empresas/rd-saude-radl3-vai-as-compras-empresa-aprova-recompra-de-ate-r-600-milhoes-em-acoes-lmrs/) | pt | 2026-11-23 | publico |  |
| u013 | financeiro | recente | [www12.senado.leg.br](https://www12.senado.leg.br/noticias/videos/2026/11/cdh-foi-ao-rio-de-janeiro-acompanhar-caso-do-menino-desaparecido-edson-davi) | pt | 2026-11-23 | publico |  |
| u014 | financeiro | recente | [exame.com](https://exame.com/pop/kate-bishop-de-gaviao-arqueiro-e-confirmada-em-vingadores-doutor-destino/) | pt | 2026-11-23 | publico |  |
| u015 | financeiro | recente | [gov.br](https://www.gov.br/cvm/pt-br/assuntos/noticias/2026/cvm-inicia-consulta-publica-relacionada-a-revisao-de-pronunciamento-tecnico-cpc-31) | pt | 2026-11-06 | publico |  |
| u016 | financeiro | recente | [infomoney.com.br](https://www.infomoney.com.br/mercados/taxas-de-juros-acompanham-alta-do-dolar-com-fiscal-no-foco/) | pt | 2026-11-23 | publico |  |
| u017 | financeiro | recente | [mercadoeconsumo.com.br](https://mercadoeconsumo.com.br/23/11/2026/artigos/varejo-e-consumo-no-japao-servem-de-inspiracao/) | pt | 2026-11-23 | publico |  |
| u018 | financeiro | recente | [moneytimes.com.br](https://www.moneytimes.com.br/plano-de-investimentos-da-petrobras-2027-2031-deve-superar-us120-bi-dizem-fontes/) | pt | 2026-11-23 | publico |  |
| u019 | financeiro | recente | [seudinheiro.com](https://www.seudinheiro.com/2026/colunistas/a-alegria-do-clt-a-estrategia-do-totalpass-e-uma-semana-mais-curta-de-aversao-a-risco-julw/) | pt | 2026-11-23 | publico |  |
| u020 | financeiro | recente | [www12.senado.leg.br](https://www12.senado.leg.br/noticias/videos/2026/11/diligencia-da-cdh-em-bacabal-no-maranhao-acompanhou-busca-por-criancas-desaparecidas) | pt | 2026-11-23 | publico |  |
| u021 | financeiro | recente | [exame.com](https://exame.com/inteligencia-artificial/alexandr-wang-superinteligencia-claude-riemann/) | pt | 2026-11-23 | publico |  |
| u022 | financeiro | historico | [gov.br](https://www.gov.br/cvm/pt-br/assuntos/noticias/2026/area-tecnica-da-cvm-informa-sobre-novo-sistema-de-solicitacao-de-autorizacao-e-informacao-de-atualizacoes-cadastrais) | pt | 2026-01-23 | publico |  |
| u023 | financeiro | recente | [infomoney.com.br](https://www.infomoney.com.br/business/crowdstrike-reverte-prejuizo-supera-projecoes-e-anuncia-para-compra-de-empresa/) | pt | 2026-11-23 | publico |  |
| u024 | financeiro | recente | [mercadoeconsumo.com.br](https://mercadoeconsumo.com.br/23/11/2026/foodservice/mel-com-pimenta-e-snacks-funcionais-estao-entre-as-tendencias-de-alimentos-para-2027/) | pt | 2026-11-23 | publico |  |
| u025 | financeiro | recente | [moneytimes.com.br](https://www.moneytimes.com.br/economistas-elevam-projecoes-para-selic-e-inflacao-em-2027-confira-o-focus-desta-segunda-feira-23-jcav/) | pt | 2026-11-23 | publico |  |
| u026 | fintech | problema | [bcb.gov.br](https://www.bcb.gov.br/detalhenoticia/21320/noticia) | pt | 2026-11-16 | bloqueio-tecnico | paginas HTML do BCB sao SPA (seed.ts) |
| u027 | fintech | problema | [bcb.gov.br](https://www.bcb.gov.br/detalhenoticia/21313/noticia) | pt | 2026-11-10 | bloqueio-tecnico | paginas HTML do BCB sao SPA (seed.ts) |
| u028 | fintech | problema | [bcb.gov.br](https://www.bcb.gov.br/detalhenoticia/21310/noticia) | pt | 2026-11-05 | bloqueio-tecnico | paginas HTML do BCB sao SPA (seed.ts) |
| u029 | fintech | problema | [bcb.gov.br](https://www.bcb.gov.br/detalhenoticia/21308/noticia) | pt | 2026-11-03 | bloqueio-tecnico | paginas HTML do BCB sao SPA (seed.ts) |
| u030 | fintech | problema | [bcb.gov.br](https://www.bcb.gov.br/detalhenoticia/21307/noticia) | pt | 2026-10-29 | bloqueio-tecnico | paginas HTML do BCB sao SPA (seed.ts) |
| u104 | fintech | historico | [mobiletime.com.br](https://www.mobiletime.com.br/noticias/11/06/2026/openai-compra-ona/) | pt | 2026-06-12 | publico |  |
| u032 | fintech | historico | [mobiletime.com.br](https://www.mobiletime.com.br/noticias/12/06/2026/gove-governo-zero-clique/) | pt | 2026-06-12 | publico |  |
| u105 | fintech | historico | [mobiletime.com.br](https://www.mobiletime.com.br/noticias/11/06/2026/stf-60-dias-novo-mci/) | pt | 2026-06-12 | publico |  |
| u034 | fintech | historico | [mobiletime.com.br](https://www.mobiletime.com.br/noticias/11/06/2026/meta-copa-apps/) | pt | 2026-06-12 | publico |  |
| u035 | fintech | recente | [mobiletime.com.br](https://www.mobiletime.com.br/noticias/23/11/2026/mobimeeting-bmg-serpro/) | pt | 2026-11-23 | publico |  |
| u036 | fintech | recente | [paymentsdive.com](https://www.paymentsdive.com/spons/travel-brands-arent-the-only-ones-that-benefit-from-non-prime-credit-card/875363/) | en | 2026-11-23 | publico |  |
| u037 | fintech | recente | [pymnts.com](https://www.pymnts.com/commerce/ecommerce/2026/croissant-uses-remy-ai-to-match-luxury-shoppers-with-new-brands/) | en | 2026-11-23 | publico |  |
| u038 | fintech | recente | [mobiletime.com.br](https://www.mobiletime.com.br/noticias/20/11/2026/tiktok-controle-de-ia/) | pt | 2026-11-20 | publico |  |
| u039 | fintech | recente | [paymentsdive.com](https://www.paymentsdive.com/spons/how-digital-dollars-improve-cross-border-payment-management/874849/) | en | 2026-11-23 | publico |  |
| u040 | fintech | recente | [pymnts.com](https://www.pymnts.com/news/banking/2026/mastercard-targets-the-trust-gap-in-open-finance/) | en | 2026-11-23 | publico |  |
| u041 | fintech | recente | [finsidersbrasil.com.br](https://finsidersbrasil.com.br/pagamentos/na-black-friday-o-check-out-pode-definir-o-resultado-das-vendas/) | pt | 2026-11-20 | publico |  |
| u042 | fintech | recente | [mobiletime.com.br](https://www.mobiletime.com.br/noticias/19/11/2026/motorola-lanca-qira-ia/) | pt | 2026-11-19 | publico |  |
| u043 | fintech | recente | [paymentsdive.com](https://www.paymentsdive.com/news/paypal-ceo-remakes-team/875344/) | en | 2026-11-20 | publico |  |
| u044 | fintech | recente | [pymnts.com](https://www.pymnts.com/smbs/2026/small-businesses-face-a-credit-divide-that-widens-with-size/) | en | 2026-11-23 | publico |  |
| u045 | fintech | recente | [finsidersbrasil.com.br](https://finsidersbrasil.com.br/pix-6-anos/crescimento-do-pix-coloca-a-prova-a-infraestrutura-do-sfn/) | pt | 2026-11-20 | publico |  |
| u046 | aviacao-fidelidade | historico | [passageirodeprimeira.com](https://passageirodeprimeira.com/segue-valendo-assine-o-clube-smiles-2-000-e-ganhe-14-mil-milhas-bonus-2/) | pt | 2026-06-30 | publico |  |
| u106 | aviacao-fidelidade | historico | [passageirodeprimeira.com](https://passageirodeprimeira.com/ultimo-dia-para-assinar-o-all-signature-antes-do-aumento/) | pt | 2026-06-30 | publico |  |
| u048 | aviacao-fidelidade | historico | [passageirodeprimeira.com](https://passageirodeprimeira.com/passageiro-de-primeira-celebra-15-anos-com-ofertas-exclusivas-em-julho/) | pt | 2026-06-30 | publico |  |
| u049 | aviacao-fidelidade | recente | [melhoresdestinos.com.br](https://www.melhoresdestinos.com.br/promocao/pacotes-de-viagem-para-foz-do-iguacu-23nov26) | pt | 2026-11-23 | publico |  |
| u050 | aviacao-fidelidade | historico | [passageirodeprimeira.com](https://passageirodeprimeira.com/voe-para-lisboa-partir-de-r-1-363-ou-57-mil-milhas-latam-pass-taxas-por-trecho/) | pt | 2026-06-30 | publico |  |
| u051 | aviacao-fidelidade | recente | [passageirodeprimeira.com](https://passageirodeprimeira.com/latam-pass-oferece-27-de-bonus-na-transferencia-de-pontos-livelo/) | pt | 2026-11-23 | publico |  |
| u052 | aviacao-fidelidade | historico | [airlines.org](https://www.airlines.org/a4a-announces-nominations-are-open-for-the-2027-nuts-bolts-awards/) | en | 2026-10-23 | publico |  |
| u053 | aviacao-fidelidade | recente | [iata.org](https://www.iata.org/en/pressroom/2026-releases/11-20-governments-back-global-agenda-for-more-competitive-sustainable-air-transport-industry/) | en | 2026-11-20 | publico |  |
| u054 | aviacao-fidelidade | recente | [pontospravoar.com](https://pontospravoar.com/black-friday-all-accor-garanta-hospedagem-ate-50-porcento-desconto/) | pt | 2026-11-23 | publico |  |
| u055 | aviacao-fidelidade | recente | [passageirodeprimeira.com](https://passageirodeprimeira.com/black-friday-ganhe-5-000-pontos-ao-abrir-a-conta-global-revolut/) | pt | 2026-11-23 | publico |  |
| u056 | aviacao-fidelidade | historico | [airlines.org](https://www.airlines.org/a4a-continues-carb-partnership-to-advance-saf-deployment/) | en | 2026-10-14 | publico |  |
| u057 | aviacao-fidelidade | recente | [iata.org](https://www.iata.org/en/pressroom/2026-releases/11-17-us-fish-wildlife-service-becomes-first-government-agency-use-iata-lar-verify/) | en | 2026-11-17 | publico |  |
| u058 | aviacao-fidelidade | recente | [pontospravoar.com](https://pontospravoar.com/turkish-airlines-oferece-20-de-desconto-em-voos-internacionais/) | pt | 2026-11-23 | publico |  |
| u059 | aviacao-fidelidade | recente | [passageirodeprimeira.com](https://passageirodeprimeira.com/prepare-se-os-alertas-do-pp-vao-ter-o-maior-desconto-da-historia/) | pt | 2026-11-23 | publico |  |
| u060 | aviacao-fidelidade | historico | [airlines.org](https://www.airlines.org/a4a-response-to-misleading-and-incomplete-story-from-the-new-york-times/) | en | 2026-10-09 | publico |  |
| u061 | aviacao-fidelidade | recente | [iata.org](https://www.iata.org/en/pressroom/2026-releases/10-30-air-passenger-falls-september/) | en | 2026-10-30 | publico |  |
| u062 | aviacao-fidelidade | recente | [melhoresdestinos.com.br](https://www.melhoresdestinos.com.br/revista-time-melhores-companhias-aereas.html) | pt | 2026-11-23 | publico |  |
| u063 | aviacao-fidelidade | recente | [pontospravoar.com](https://pontospravoar.com/black-friday-all-accor-garanta-assinatura-all-signature-ate-40-porcento-desconto/) | pt | 2026-11-23 | publico |  |
| u064 | aviacao-fidelidade | recente | [passageirodeprimeira.com](https://passageirodeprimeira.com/melhor-oferta-do-ano-assine-o-all-signature-com-ate-40-de-desconto-incluindo-ex-assinantes-2/) | pt | 2026-11-23 | publico |  |
| u065 | aviacao-fidelidade | historico | [airlines.org](https://www.airlines.org/a4a-receives-prnews-platinum-award-for-red-flight-blue-campaign/) | en | 2026-10-06 | publico |  |
| u066 | tecnologia | recente | [tecnoblog.net](https://tecnoblog.net/noticias/nao-quer-ia-canva-ganha-botao-para-isso/) | pt | 2026-11-23 | publico |  |
| u067 | tecnologia | recente | [tecnoblog.net](https://tecnoblog.net/publieditoriais/cupom-nordvpn-como-assinar-a-melhor-vpn-com-ate-75-de-desconto/) | pt | 2026-11-23 | publico |  |
| u068 | tecnologia | recente | [tecnoblog.net](https://tecnoblog.net/achados/black-november-lenovo-idea-tab-pro-gen-2-para-jogos-tem-melhor-oferta-que-ja-vimos/) | pt | 2026-11-20 | publico |  |
| u069 | tecnologia | recente | [tecnoblog.net](https://tecnoblog.net/achados/black-november-galaxy-z-fold-8-512-gb-tem-melhor-oferta-desde-lancamento/) | pt | 2026-11-20 | publico |  |
| u070 | tecnologia | recente | [tecnoblog.net](https://tecnoblog.net/noticias/motorola-confirma-mais-celulares-que-receberao-o-android-17/) | pt | 2026-11-20 | publico |  |
| u071 | tecnologia | recente | [brasscom.org.br](https://brasscom.org.br/aviso-de-pauta-brasscom-reune-liderancas-para-debater-o-impacto-pratico-da-ia-no-brasil-durante-o-tecforum-tecnologia/?utm_source=rss&utm_medium=rss&utm_campaign=aviso-de-pauta-brasscom-reune-liderancas-para-debater-o-impacto-pratico-da-ia-no-brasil-durante-o-tecforum-tecnologia) | pt | 2026-11-04 | publico |  |
| u072 | tecnologia | recente | [canaltech.com.br](https://canaltech.com.br/software/samsung-prepara-recurso-contra-golpes-e-voz-de-ia-em-ligacoes-no-whatsapp-e-telegram/) | pt | 2026-11-23 | publico |  |
| u073 | tecnologia | recente | [olhardigital.com.br](https://olhardigital.com.br/2026/11/23/reviews/samsung-galaxy-a07-e-a17-em-promocao-veja-as-melhores-ofertas-da-linha/) | pt | 2026-11-23 | publico |  |
| u074 | tecnologia | recente | [brasscom.org.br](https://brasscom.org.br/aviso-de-pauta-maturidade-em-ciberseguranca-cresce-41-no-brasil-brasscom-debate-mercado-de-r-127-bi-em-webinar-no-dia-28-10/?utm_source=rss&utm_medium=rss&utm_campaign=aviso-de-pauta-maturidade-em-ciberseguranca-cresce-41-no-brasil-brasscom-debate-mercado-de-r-127-bi-em-webinar-no-dia-28-10) | pt | 2026-10-28 | publico |  |
| u075 | tecnologia | recente | [canaltech.com.br](https://canaltech.com.br/smartphone/samsung-pode-piorar-camera-do-galaxy-a38-em-2027-entenda/) | pt | 2026-11-23 | publico |  |
| u076 | tecnologia | recente | [olhardigital.com.br](https://olhardigital.com.br/2026/11/23/reviews/smart-tv-lg-43lr6700-e-boa-opcao-para-quem-busca-conectividade-e-recursos-sem-gastar-muito/) | pt | 2026-11-23 | publico |  |
| u077 | tecnologia | recente | [brasscom.org.br](https://brasscom.org.br/brasscom-parabeniza-governo-reeleito-e-reforca-agenda-digital-como-pilar-para-autonomia-tecnologica-do-brasil/?utm_source=rss&utm_medium=rss&utm_campaign=brasscom-parabeniza-governo-reeleito-e-reforca-agenda-digital-como-pilar-para-autonomia-tecnologica-do-brasil) | pt | 2026-10-26 | publico |  |
| u078 | tecnologia | recente | [canaltech.com.br](https://canaltech.com.br/entretenimento/quanto-tempo-tera-vingadores-doutor-destino-diretor-revela/) | pt | 2026-11-23 | publico |  |
| u079 | tecnologia | recente | [olhardigital.com.br](https://olhardigital.com.br/2026/11/23/games-e-consoles/the-game-awards-12-vencedores-jogo-do-ano-numeros-gta-6/) | pt | 2026-11-23 | publico |  |
| u080 | tecnologia | historico | [brasscom.org.br](https://brasscom.org.br/newsletter-agosto/?utm_source=rss&utm_medium=rss&utm_campaign=newsletter-agosto) | pt | 2026-10-08 | publico |  |
| u081 | restritivo | problema | [redir.folha.com.br](https://redir.folha.com.br/redir/online/mercado/rss091/*https://c-level.folha.uol.com.br/negocios/2026/11/crise-do-ueno-testa-folego-do-paraguai-para-atrair-empresas-que-buscam-menos-impostos.shtml) | pt | 2026-11-23 | paywall-parcial | paywall poroso |
| u082 | restritivo | problema | [ir.latam.com](https://ir.latam.com/English/news/press-releases/news-details/2026/LATAM-Reports-US441-Million-in-Net-Income-for-the-Third-Quarter-of-2026-2026-Uw02BdFq6x/default.aspx) | en | 2026-11-03 | bloqueio-tecnico | 403 ao UA direto (seed.ts) |
| u083 | restritivo | problema | [valor.globo.com](https://valor.globo.com/financas/noticia/2026/11/23/juros-futuros-caem-com-galipolo-fiscal-e-exterior-no-radar.ghtml) | pt | 2026-11-23 | paywall-parcial | paywall |
| u084 | restritivo | problema | [bloomberglinea.com.br](https://www.bloomberglinea.com.br/brasil/diretor-do-bc-nilton-david-participa-do-bloomberg-linea-summit-nesta-segunda-assista/) | pt | 2026-11-23 | bloqueio-tecnico | anti-bot |
| u085 | restritivo | problema | [camara.leg.br](https://www.camara.leg.br/noticias/1321180-audiencia-debate-violencia-sexual-facilitada-por-tecnologia-e-material-de-abuso-infantil-gerado-por-ia) | pt | 2026-11-23 | bloqueio-tecnico | robots declara bloqueio de bots de IA (seed.ts) |
| u086 | restritivo | problema | [estadao.com.br](https://www.estadao.com.br/economia/focus-mercado-eleva-projecao-inflacao-dolar-preve-pib-menor-2026/) | pt | 2026-11-23 | paywall-parcial | paywall |
| u087 | restritivo | problema | [redir.folha.com.br](https://redir.folha.com.br/redir/online/mercado/rss091/*https://c-level.folha.uol.com.br/economia-sustentavel/2026/11/china-lamenta-fracasso-da-cop31-mas-afirma-que-transicao-verde-e-irreversivel.shtml) | pt | 2026-11-23 | paywall-parcial | paywall poroso |
| u088 | restritivo | problema | [ir.latam.com](https://ir.latam.com/English/news/press-releases/news-details/2026/Scheduled-Third-Quarter-2026-Publication-Date-2026-CmvKQJFYgv/default.aspx) | en | 2026-10-02 | bloqueio-tecnico | 403 ao UA direto (seed.ts) |
| u089 | restritivo | problema | [valor.globo.com](https://valor.globo.com/patrocinado/dino/noticia/2026/11/23/adocao-de-agentes-de-ia-por-pmes-brasileiras-e-desigual-1.ghtml) | pt | 2026-11-23 | paywall-parcial | paywall |
| u090 | restritivo | problema | [bloomberglinea.com.br](https://www.bloomberglinea.com.br/negocios/economia-vai-desacelerar-mais-e-pesar-nos-balancos-diz-chefe-de-research-do-btg-pactual/) | pt | 2026-11-23 | bloqueio-tecnico | anti-bot |
| u091 | restritivo | problema | [camara.leg.br](https://www.camara.leg.br/noticias/1320994-comissao-debate-aliquota-base-da-contribuicao-sobre-bens-e-servicos) | pt | 2026-11-23 | bloqueio-tecnico | robots declara bloqueio de bots de IA (seed.ts) |
| u092 | restritivo | problema | [estadao.com.br](https://www.estadao.com.br/economia/duquesa-de-tax/pacote-ajuste-fiscal-governo-band-aid-problema-grave/) | pt | 2026-11-23 | paywall-parcial | paywall |
| u093 | restritivo | problema | [redir.folha.com.br](https://redir.folha.com.br/redir/online/mercado/rss091/*https://www1.folha.uol.com.br/mercado/2026/11/macron-propoe-retomar-plano-para-incluir-regras-fiscais-na-constituicao-francesa.shtml) | pt | 2026-11-23 | paywall-parcial | paywall poroso |
| u094 | restritivo | problema | [ir.latam.com](https://ir.latam.com/English/news/press-releases/news-details/2026/CALL-TO-TENDER-SAO-PAULO---GUARULHOS-AIRPORT-IN-ACCORDANCE-TO-THE-SLOTS-EXCHANGE-PROCEDURE-2026-qbyYfdJBCm/default.aspx) | en | 2026-08-28 | bloqueio-tecnico | 403 ao UA direto (seed.ts) |
| u095 | restritivo | problema | [valor.globo.com](https://valor.globo.com/financas/noticia/2026/11/23/estrangeiros-retiram-quase-r-841-milhes-na-b3-em-18-de-novembro.ghtml) | pt | 2026-11-23 | paywall-parcial | paywall |
| u096 | internacional | recente | [onemileatatime.com](https://onemileatatime.com/news/qatar-airways-airbus-a321lr-flat-bed-business-class/) | en | 2026-11-23 | publico |  |
| u097 | internacional | recente | [simpleflying.com](https://simpleflying.com/qantas-cancels-3-international-boeing-787-routes/) | en | 2026-11-23 | publico |  |
| u098 | internacional | recente | [thepointsguy.com](https://thepointsguy.com/news/delta-air-lines-tech-outage-messy-sunday-thanksgiving-travel/) | en | 2026-11-23 | publico |  |
| u099 | internacional | recente | [onemileatatime.com](https://onemileatatime.com/news/dozens-fall-ill-condor-flights-frankfurt-mass-casualty-response/) | en | 2026-11-23 | publico |  |
| u100 | internacional | recente | [simpleflying.com](https://simpleflying.com/qatar-airways-adds-1st-ever-airbus-a321lr-routes/) | en | 2026-11-23 | publico |  |
