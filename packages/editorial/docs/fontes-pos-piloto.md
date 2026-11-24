# Próximas 10 fontes públicas para depois do piloto (classe A ou B, DP-28)

> Pesquisa SOMENTE de leitura, feita em **23/11/2026**: uma leitura por URL, User-Agent identificado (`LoyaltyNewsSourceVerifier/1.0`, verificação pontual, sem coleta em massa), 3 s ou mais entre requisições ao mesmo host, nenhum bloqueio contornado, nenhuma matéria coletada e nenhum custo (sem API tarifada). Os termos citados abaixo foram **lidos nas páginas oficiais** (trecho literal e link). Nada aqui habilita fonte: a habilitação é ato humano no Studio (revisor ≠ pesquisadora, admin ou editor-chefe com MFA), como no piloto. Classes conforme `docs/termos-fontes.md`: **A** = o texto oficial autoriza reproduzir/reutilizar, com condições; **B** = licença aberta com restrição que pode alcançar a nossa reescrita.

## Resumo

| # | Fonte (id sugerido) | Classe | Entrada de coleta | Editoria | Coletável hoje? |
|---|---|---|---|---|---|
| 1 | Agência Brasil / EBC (`agencia-brasil`) | A, **com ressalva** (ver 1) | feed RSS | `mercado` | Sim |
| 2 | EDPB (`edpb`, já no cadastro sem feed) | A | feed RSS | `regulacao` | Sim (cadastrar o feed) |
| 3 | Comissão Europeia, Press Corner (`ec-presscorner`) | A | feed RSS | `regulacao` | Sim |
| 4 | CMA, Reino Unido (`uk-cma`) | A | feed Atom | `regulacao` | Sim |
| 5 | FCA, Reino Unido (`uk-fca`) | A | feed Atom | `bancos` | Sim |
| 6 | FTC, EUA (`ftc-consumidor`) | A | feed RSS | `regulacao` | Sim |
| 7 | Banco Central Europeu (`ecb-imprensa`) | A | feed RSS | `bancos` | Sim |
| 8 | ANAC (`anac`, já no cadastro sem feed) | B | sitemap `.xml.gz` | `travel` | Sim, com o suporte a `.gz` (branch `ft/editorial-sitemap-gz`) |
| 9 | CVM (`cvm`, já no cadastro) | B | sitemap `.xml.gz` | `mercado` | Sim: idem |
| 10 | ANPD (`anpd`, já no cadastro sem feed) | B | sitemap `.xml.gz` | `regulacao` | Sim: idem |

- **Sete fontes (1 a 7) têm feed confirmado e se cadastram sem mudar código.** As três de gov.br (8 a 10) têm sitemap só em `.xml.gz` e sem `lastmod` no índice; o suporte a isso foi implementado na branch `ft/editorial-sitemap-gz` (seção "Fontes 8 a 10").
- Seis fontes (2 a 7) são estrangeiras e em inglês. A fábrica reescreve em português, com as mesmas regras (nunca reproduzir, citar e linkar). Quem decide se a matéria de fonte estrangeira entra na editoria é o editor-chefe; sugeri a editoria mais próxima.
- Frequência sugerida segue o padrão do piloto (1 rodada por dia, no máximo 5 matérias por rodada, 6 requisições por hora no cadastro, espaçamento do coletor de 3 s ou o `Crawl-delay` do `robots.txt`, o que for maior).

---

## 1. Agência Brasil (EBC) — classe A, com ressalva

- **Feed:** `https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml` (RSS; 10 itens; mais recente em 23/11/2026 19:59). O feed por editoria `/economia/feed.xml` retorna 404: usar só o geral.
- **Termos:** [Termos de Uso e Condições Gerais do Portal da EBC](https://www.ebc.com.br/termos-de-uso-e-condicoes-gerais-do-portal-da-ebc), item 1.e: "Reprodução autorizada mediante indicação da fonte."
- **Ressalva (o revisor decide):** o item 1.b do mesmo termo diz "O Usuário deverá utilizar o Portal apenas para finalidades de uso pessoal, sem intuito comercial ou lucrativo." Pelo critério mecânico do dossiê (o texto autoriza reproduzir com atribuição) é classe A; numa leitura conservadora o 1.b limita o uso comercial e a fonte cairia para classe C (só caso a caso). Não encontrei licença Creative Commons nem no rodapé da home nem numa matéria. **Recomendação: habilitar só depois de o revisor registrar como leu o 1.b na nota de revisão.**
- **robots.txt** (`https://agenciabrasil.ebc.com.br/robots.txt`, 200): `User-agent: *` com `Crawl-delay: 10` e `Allow` de assets; sem regra que bloqueie as matérias nem o feed. **Respeitar os 10 s** (o coletor já usa o maior entre `Crawl-delay` e 3 s).
- **Frequência:** 1 rodada/dia, 5 matérias, espaçamento 10 s.
- **Editoria:** `mercado` (economia, consumo, aviação e crédito aparecem no geral; a triagem filtra o que não for do nosso escopo).
- **Por que A:** o texto oficial da EBC autoriza expressamente a reprodução com indicação da fonte (item 1.e), com a ressalva acima.

## 2. EDPB — Comitê Europeu de Proteção de Dados — classe A

- **Feed:** `https://www.edpb.europa.eu/feed/news_en` (RSS; 10 itens; mais recente em 19/11/2026). `https://www.edpb.europa.eu/rss.xml` redireciona para `rss.xml_en`, cujo topo é de 13/10/2026: preferir `feed/news_en`. O cadastro atual (`edpb`) está com `feedUrl: null`; bastaria preencher.
- **Termos:** [Copyright e reutilização do EDPB](https://www.edpb.europa.eu/copyright_en). Reuso "authorized for commercial and non-commercial purposes, under the following conditions: The re-user is obliged to acknowledge the source of the document; The original meaning or the message of the documents should not be distorted; The European Data Protection Board cannot be held liable for any consequence stemming from the reuse." Reuse é definido como "reproduction of textual data and multimedia items which are the property of the EDPB or of third parties and for which the EDPB holds the rights of use".
- **robots.txt** (200): `User-agent: *` só com `Allow` de assets e `Disallow` de `/core/`, `/profiles/` e `/README.md`; o feed e as notícias não são bloqueados; sem `Crawl-delay`. Sitemap: `https://www.edpb.europa.eu/sitemap.xml` (também confirmado).
- **Frequência:** 2 rodadas por semana bastam (o órgão publica poucas notícias); 5 matérias por rodada.
- **Editoria:** `regulacao` (proteção de dados; termômetro para a LGPD e para o uso de dados em programas de fidelidade).
- **Por que A:** autoriza reuso comercial com atribuição e sem distorcer o sentido (já era a classe do dossiê).

## 3. Comissão Europeia — Press Corner — classe A

- **Feed:** `https://ec.europa.eu/commission/presscorner/api/rss?language=en` (RSS; 10 itens; mais recente em 23/11/2026).
- **Termos:** [Aviso legal da Comissão Europeia](https://commission.europa.eu/legal-notice_en), "Copyright notice": "Unless otherwise indicated (e.g. in individual copyright notices), content owned by the EU on this website is licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) licence. This means that reuse is allowed, provided appropriate credit is given and changes are indicated." A mesma página cita a Decisão da Comissão de 12/12/2011 sobre reuso de documentos (2011/833/UE) e exclui marcas, logotipos e obras de terceiros.
- **Ressalva (o revisor confere):** o aviso está em `commission.europa.eu`; o feed está em `ec.europa.eu/commission/presscorner`. A política de reuso é da Comissão inteira, mas convém o revisor abrir uma nota do Press Corner e ver se há aviso próprio. Fotos e vídeos de terceiros não são nossos de qualquer forma (a fábrica não usa imagem de fonte, D08).
- **robots.txt:** `https://ec.europa.eu/robots.txt` (200): `User-agent: *` sem regra para `/commission/presscorner`; sem `Crawl-delay` nas regras lidas. (`/commission/presscorner/robots.txt` dá 404, como esperado: o arquivo vale na raiz do host.)
- **Frequência:** 1 rodada/dia, 5 matérias (o feed mistura discursos e comunicados; a triagem descarta o que não interessa).
- **Editoria:** `regulacao` (consumidor, pagamentos, regras digitais).
- **Por que A:** CC BY 4.0 declarada: reuso permitido com crédito e indicação de mudanças.

## 4. CMA — Autoridade de Concorrência e Mercados (Reino Unido) — classe A

- **Feed:** `https://www.gov.uk/government/organisations/competition-and-markets-authority.atom` (Atom; 20 itens; mais recente em 23/11/2026).
- **Termos:** [Termos e condições do GOV.UK](https://www.gov.uk/help/terms-conditions): "You can reproduce content published on GOV.UK under the OGL as long as you follow the licence's conditions." (OGL = Open Government Licence; a página liga ao texto da licença no site dos Arquivos Nacionais e avisa que há conteúdo isento, que credita o autor.) Não li o texto integral da OGL nesta rodada: o revisor abre o link e confere as condições.
- **robots.txt** (`https://www.gov.uk/robots.txt`, 200): `Disallow: /*/print$` e `/search/all*`; o feed da organização não é bloqueado; sem `Crawl-delay` para `*`; sitemap `https://www.gov.uk/sitemap.xml`.
- **Frequência:** 1 rodada/dia, 5 matérias.
- **Editoria:** `regulacao` (defesa do consumidor, preços e práticas comerciais: úteis para a leitura do mercado de fidelidade e de cashback).
- **Por que A:** o texto oficial autoriza reproduzir o conteúdo sob a OGL, com condições (atribuição).

## 5. FCA — Autoridade de Conduta Financeira (Reino Unido) — classe A

- **Feed:** `https://www.gov.uk/government/organisations/financial-conduct-authority.atom` (Atom; 20 itens; mais recente em 14/11/2026). Alternativa que também respondeu: `https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=financial-conduct-authority`; **preferir a primeira** (a segunda fica sob `/search/`, onde há regra de `robots.txt` para `/search/all*`; hoje não a alcança, mas é mais perto da fronteira).
- **Termos e robots:** os mesmos do item 4 (mesmo host `gov.uk`).
- **Frequência:** 1 rodada/dia, 5 matérias (o órgão publica pouco por dia).
- **Editoria:** `bancos` (cartões, crédito, poupança e regras de conduta no varejo financeiro).
- **Por que A:** idem item 4 (OGL).

## 6. FTC — Comissão Federal de Comércio (EUA), proteção do consumidor — classe A

- **Feed:** `https://www.ftc.gov/feeds/press-release-consumer-protection.xml` (RSS; 30 itens; mais recente em 20/11/2026). O RSS "geral" em `/news-events/news/press-releases/rss.xml` devolve HTML (não é feed): usar o de proteção do consumidor.
- **Termos:** [Política do site da FTC](https://www.ftc.gov/policy-notices/website-policy), "Copyright Permission": "Most material on the FTC's website is considered work of the United States Government, meaning that the material is in the public domain and is not subject to copyright restrictions (17 U.S.C. 105). The use, duplication, or redistribution of such material should be accompanied by appropriate attribution, where feasible". O mesmo texto proíbe uso fraudulento e sugerir endosso ou vínculo com a FTC.
- **Ressalva:** material protegido de terceiros no site tem de ser tratado à parte (o revisor registra isso na nota; a fábrica não usa imagem de fonte).
- **robots.txt** (`https://www.ftc.gov/robots.txt`, 200): `User-agent: *` com **`Crawl-delay: 5`** e `Disallow` de páginas antigas de eventos; feed e comunicados não são bloqueados. Respeitar os 5 s.
- **Frequência:** 1 rodada/dia, 5 matérias, espaçamento 5 s.
- **Editoria:** `regulacao` (golpes, cobranças, publicidade enganosa, cartões e recompensas: assuntos que chegam ao varejo e ao cashback brasileiros).
- **Por que A:** obra do governo dos EUA em domínio público, uso com atribuição; texto oficial explícito.

## 7. Banco Central Europeu (ECB) — comunicados de imprensa — classe A

- **Feed:** `https://www.ecb.europa.eu/rss/press.xml` (RSS; 15 itens; mais recente em 23/11/2026). `https://www.ecb.europa.eu/rss/press.html` devolve o mesmo conteúdo.
- **Termos:** [Aviso legal do BCE](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html), "Copyright": "users of this website may make free use of the information obtained directly from it subject to the following conditions: When such information is distributed or reproduced, it must appear accurately and the ECB must be cited as the source." **Exceção do próprio texto:** reproduzir documentos que levam o nome do autor (ex.: *Working Papers*, *Occasional Papers*) "is permitted only with the explicit prior written authorisation of the ECB or the authors": **a fábrica deve ignorar papers e pesquisas; usar só comunicados e discursos institucionais**.
- **robots.txt** (200): `User-agent: *` com **`Crawl-delay: 5`**, sitemap `https://www.ecb.europa.eu/sitemap.xml` e `Disallow` de variantes `_content` e de webcast; feed e comunicados não são bloqueados.
- **Frequência:** 1 rodada/dia, 5 matérias, espaçamento 5 s.
- **Editoria:** `bancos` (pagamentos, euro digital, política monetária; contexto de mercado).
- **Por que A:** autoriza uso livre com citação da fonte e fidelidade do texto; a exceção para obras assinadas é tratada como filtro.

## 8. ANAC — Agência Nacional de Aviação Civil — classe B

- **Sitemap:** `https://www.gov.br/anac/sitemap-index.xml` (índice com **9 filhos** `sitemap1.xml.gz` a `sitemap9.xml.gz`; sem `lastmod` no índice). Matérias em `/anac/pt-br/noticias/<ano>/<slug>` (973 só no `sitemap1`; a mais recente lida, de 19/11/2026, está no `sitemap9`). O sitemap inclui anexos (`.png`, `.jpg`): o coletor precisa filtrar. Sem feed: `…/assuntos/noticias/RSS` retornou 404 em 23/11.
- **Termos:** o rodapé da página de notícias da ANAC traz "Todo o conteúdo deste site está publicado sob a licença [Creative Commons Atribuição-SemDerivações 3.0 Não Adaptada](https://creativecommons.org/licenses/by-nd/3.0/deed.pt_BR)" (lido em `https://www.gov.br/anac/pt-br/assuntos/noticias`); o [Termo de Uso do gov.br](https://www.gov.br/pt-br/termos-de-uso) não trata de reprodução, automação ou IA.
- **robots.txt** (`https://www.gov.br/robots.txt`, 200): `User-agent: *` só com `Disallow` de `/economia/pt-br/internet/*`, `*sendto_form`, `*folder_factories` e áreas de `/mre/` e `/ebserh/`; `/anac/…` não é bloqueado; sem `Crawl-delay`.
- **Frequência:** 1 rodada/dia, 5 matérias.
- **Editoria:** `travel` (aviação: tarifas, direitos do passageiro, bagagem e regras de bilhete; base de milhas e de companhias aéreas).
- **Por que B:** CC BY-ND ("SemDerivações"): a atribuição é condição e a reescrita de fatos com citação pode ser lida como "derivação" (ponto jurídico que o dossiê não decide; DP-28 aceita o risco; manter a reescrita curta, com link).

## 9. CVM — Comissão de Valores Mobiliários — classe B

- **Sitemap:** `https://www.gov.br/cvm/sitemap-index.xml` (índice com **4 filhos** `.xml.gz`; `sitemap1` com 5.000 URLs, das quais 4.661 sob `/cvm/pt-br/assuntos/noticias/`, **inclusive anexos** em `/anexos/` — `.png`, `.pdf` — a excluir). O `feedUrl` antigo de `cvm` (`…/assuntos/noticias/RSS`) devolveu **404** em 23/11/2026 (e a nota do cadastro já o dava como defasado): na branch `ft/editorial-sitemap-gz` o seed passou a `feedUrl: null` + sitemap.
- **Termos:** mesmo rodapé CC BY-ND 3.0 (lido em `https://www.gov.br/cvm/pt-br/assuntos/noticias`); Termo de Uso do gov.br sem regra de reprodução. Dossiê: `docs/termos-fontes.md`, seção do gov.br.
- **robots.txt:** o do gov.br (item 8); `/cvm/…` não bloqueado.
- **Frequência:** 1 rodada/dia, 5 matérias.
- **Editoria:** `mercado` (regulação de capitais, fundos e cartões como valores mobiliários, ofertas).
- **Por que B:** idem item 8.

## 10. ANPD — Autoridade Nacional de Proteção de Dados — classe B

- **Sitemap:** `https://www.gov.br/anpd/sitemap-index.xml` (índice com **2 filhos** `.xml.gz`; matérias em `/anpd/pt-br/assuntos/noticias/<slug>`; mais recente lida, de 09/11/2026, no `sitemap1`). Sem feed.
- **Termos:** rodapé CC BY-ND 3.0 (lido em `https://www.gov.br/anpd/pt-br/assuntos/noticias`); Termo de Uso do gov.br sem regra de reprodução.
- **robots.txt:** o do gov.br; `/anpd/…` não bloqueado.
- **Frequência:** 2 rodadas por semana (poucas notícias), 5 matérias por rodada.
- **Editoria:** `regulacao` (LGPD: dados em programas de fidelidade, CRM e publicidade).
- **Por que B:** idem item 8.

---

## Fontes 8 a 10 (gov.br: sitemap `.xml.gz`) — suporte implementado na branch `ft/editorial-sitemap-gz`

O coletor agora lê os filhos `.xml.gz` (e um índice `.gz`). Como funciona, e o que ainda decide uma pessoa:

- **Descompressão com teto:** só gzip (cabeçalho `1f 8b`); a saída é limitada a 10 MB por sitemap (`sitemapMaxDecompressedBytes`) e a entrada, a 2 MB pelo fetcher. Passou do teto: o filho é pulado com `decompressed_too_large` (proteção contra zip bomb); gzip corrompido ou truncado: `gzip_invalid`. Nenhuma das duas paralisa a fonte; 429, 403 e desafio continuam parando a coleta.
- **Filhos sem `lastmod` (o caso do gov.br):** a ordem dos filhos não é cronológica (matérias novas aparecem em qualquer um), então o coletor lê **todos** os filhos, até 12 (`sitemapMaxChildren`); índice maior que isso é recusado inteiro (`sitemap_index_too_large`) em vez de lido pela metade. Índice **com** `lastmod` mantém o comportamento anterior (os 2 filhos mais recentes).
- **Anexos fora:** URLs terminadas em imagem, PDF, planilha, áudio, vídeo, compactado etc. nunca são matéria e são descartadas; sobram só as páginas sob o `sitemapPathPrefix`; duplicatas saem; as mais recentes (`lastmod`) vêm primeiro. Cuidado: no gov.br o `lastmod` é a última modificação, não a data de publicação.
- **Salvaguardas intactas em cada filho:** `robots.txt`, host/prefixo, espaçamento de 3 s, limite por hora do cadastro, parada em 429/403/desafio.
- **Cadastro (seed) atualizado, tudo desabilitado:** `anac` (`/anac/pt-br/noticias/`, 9 filhos), `cvm` (`/cvm/pt-br/assuntos/noticias/`, 4 filhos; `feedUrl` passou a `null`, o RSS responde 404) e `anpd` (`/anpd/pt-br/assuntos/noticias/`, 2 filhos) ganharam `sitemapUrl` e `sitemapPathPrefix`, e `maxRequestsPerHour` **24** (índice + até 9 filhos + `robots.txt` + até 5 páginas por rodada; com o limite antigo de 6 a leitura pararia em `rate_limited` no meio dos filhos). **Isso é decisão do revisor/PM:** o custo é cerca de 10 requisições por rodada na ANAC (3 s entre elas) e 5 na CVM.
- **Continua dependendo de pessoa:** revisão dos termos (CC BY-ND) e habilitação no Studio; nada foi coletado de verdade (testes offline com bytes gzip montados no teste e fetcher falso).

## Reserva (mesma situação das 8 a 10; não entram nas 10)

| Fonte | Sitemap lido | Observação |
|---|---|---|
| Anatel (`anatel`) | `https://www.gov.br/anatel/sitemap-index.xml` (4 filhos `.gz`) | Telecom e dados; mesma licença CC BY-ND e mesma dependência `.gz`. |
| Ministério do Turismo (`mtur`) | `https://www.gov.br/turismo/sitemap-index.xml` (11 filhos `.gz`) | Turismo e viagens; idem. |
| Susep (`susep`, fora do cadastro) | `https://www.gov.br/susep/sitemap-index.xml` (2 filhos `.gz`; notícias em `/susep/pt-br/central-de-conteudos/noticias/`) | Seguros (viagem, cartões); relevância menor; licença CC BY-ND confirmada no rodapé. |

## Recusadas (não entram)

| Fonte | Motivo (lido em 23/11/2026) |
|---|---|
| IBGE — Agência de Notícias | Os dois endereços de feed testados respondem **403 com desafio "Just a moment…"** (bloqueio de robô). Não contornado (DP-31/32 não cobrem desafio). Sem feed acessível: recusada. |
| Banco Central (BCB) | O feed Atom existe e responde (`https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/noticias?ano=2026`, 10 itens, 23/11/2026) e o `robots.txt` permite tudo, **mas o termo oficial não foi lido** (a página de termos só renderiza por JavaScript): fica **classe E**, não A/B. Destrava com a leitura manual do termo (pessoa, no navegador). |
| CFPB (EUA) | O feed RSS responde (`https://www.consumerfinance.gov/about-us/newsroom/feed/`, 23 itens), **mas não localizei o texto de reuso** (as páginas de política testadas deram 404 ou não trazem o termo): sem texto oficial lido não há classe A. |
| Departamento de Transportes (EUA) | Os dois endereços de feed testados deram 404 e não encontrei sitemap: sem feed nem sitemap, recusada. |
| Senacon/MJSP e Ministério da Fazenda (gov.br) | `…/sitemap-index.xml` deu 404 nos dois órgãos e o RSS do Plone também (404): **sem feed nem sitemap**, recusadas. O `sitemap.xml.gz` central do gov.br responde 403. |
| EBA (Autoridade Bancária Europeia) | Feed responde, mas o topo traz item de 2024 (feed possivelmente parado) e não li os termos: não avaliada para esta lista. |

## O que NÃO foi verificado

- O **texto integral** da OGL (itens 4 e 5), da CC BY 4.0 (item 3) e da CC BY-ND 3.0 (itens 8 a 10): citei o que cada site afirma e o link; o revisor humano abre o texto da licença.
- Se uma **matéria** individual traz aviso de direito próprio (fotos, textos de terceiros): isso se vê matéria a matéria, e a fábrica não usa imagem de fonte.
- A **qualidade** do que cada feed entrega (volume útil por semana para o nosso público) e a **estabilidade** dos feeds: foi uma leitura por URL, em um dia.
- Nenhuma fonte foi **coletada** (nem matérias, nem páginas além de feed/índice, `robots.txt` e páginas de termos) e nenhuma foi **habilitada**. Todas continuam sujeitas à revisão humana (termos, URL, robots, paywall) e às flags do job editorial.

## Como cadastrar (quando o PM mandar)

Para cada fonte de 1 a 7: `Source` novo (ou `feedUrl` preenchido, no caso do `edpb`) com `host`, `pathPrefix`/`listingUrl`, `feedUrl`, `termsUrl`, `editorias`, `maxRequestsPerHour: 6`, `verification` com a nota do item correspondente, `enabled: false`, `termsStatus: 'pending'`, `urlVerified: false`; teste do cadastro como o de `piloto-fontes`. Para 8 a 10: já estão no seed (desabilitadas), com sitemap, prefixo e limite por hora; falta só a revisão e a habilitação humanas.
