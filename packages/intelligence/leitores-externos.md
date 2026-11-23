# Leitores externos de páginas (DP-32): o que é gratuito, o que cada produto faz e a proposta do adaptador

Pesquisa documental de 23/11/2026, só leitura de páginas oficiais (nenhuma conta criada, nenhuma assinatura, nenhuma chave usada). Frases entre aspas são **literais** das páginas indicadas; o que não estava escrito consta como "não encontrado". Páginas de preço mudam: reconferir antes de depender de um número.

Base de decisão: **DP-32** (`r0-preparacao/decisoes-proprietario-2026-11-22.md`): liberados provedores com desbloqueio (inclusive CAPTCHA e proxies do próprio provedor), ignorar robots.txt e recusa por UA, **duas contas por provedor na cota gratuita**; mantidos: nada de login nem paywall, ritmo baixo, nunca reproduzir texto (só fato, fonte, link e data), nada pago sem o proprietário.

## 1. Bright Data

Fontes: [Free tier](https://docs.brightdata.com/general/account/billing-and-pricing/free-tier) · [FAQ de cobrança](https://docs.brightdata.com/general/account/billing-and-pricing/faqs) · [FAQ geral](https://docs.brightdata.com/general/faqs) · [Preços](https://brightdata.com/pricing) · [índice de produtos (llms.txt)](https://brightdata.com/llms.txt).

**O que é gratuito (permanente e recorrente, não crédito de teste único):**
- "Every new Bright Data account gets 5,000 free credits per month" (≈ US$ 7,50), **um único saldo compartilhado** entre Web Unlocker API, SERP API, Web Scraper API, Scraper Studio e Browser API. "Proxy products (Datacenter, ISP and Residential proxies) are not included".
- "Credits renew on the first of each month"; "Unused free credits do not roll over". "A free tier account has a hard stop when credits are exhausted, never a surprise bill."
- Sem cartão para os créditos: "No credit card, no promo code, no commitment."
- Custo: Web Unlocker, SERP e Web Scraper = **1 crédito por requisição/registro**; Scraper Studio = 1 por carregamento de página; **Browser API = 5 créditos por MB**.
- Limite de taxa da conta gratuita: "1,000 requests per minute" (SERP, Web Unlocker e proxies), removido ao depositar fundos.
- "Playground mode" de 7 dias ("small-scale testing", não produção) que pode ser estendido a 30 dias; os créditos mensais "do not expire with the trial". Crédito único de proxy: US$ 2 por 7 dias (+ US$ 5 ao cadastrar meio de pagamento, 30 dias).
- **Atenção (conflito entre páginas):** a lista do free tier inclui o Web Unlocker, mas o FAQ geral diz: "Proxy Networks (Residential, ISP, Datacenter) and Web Unlocker API are not available for accounts registered with personal email addresses and no payment method on file." Cartão aqui é "a verification step only" (não cobra, a menos que os créditos acabem e haja fundos depositados). **Decisão do proprietário:** cadastrar cartão (só verificação) ou usar e-mail corporativo, ou ficar sem o Web Unlocker.
- **Datasets:** nenhum crédito gratuito nas páginas ("Subscription option"). Fora da cota gratuita.

**Produtos e enquadramento na DP-32** (docs: [SERP API](https://docs.brightdata.com/scraping-automation/serp-api/introduction), [Web Unlocker](https://docs.brightdata.com/scraping-automation/web-unlocker/introduction), [Browser API / Scraping Browser](https://docs.brightdata.com/scraping-automation/scraping-browser/introduction), [Scraper API](https://docs.brightdata.com/products/scrapers/overview.md), [Datasets](https://docs.brightdata.com/datasets/introduction.md)):

| Produto | O que faz (literal) | Desbloqueio / CAPTCHA / proxies | Dá para desligar? | Custo na cota gratuita |
|---|---|---|---|---|
| **Web Unlocker API** | "unlocks any public web page in a single API call with a 98% success rate and returns clean HTML or JSON." | Sim, é a função: "Solves CAPTCHAs and anti-bot challenges automatically"; "Sets request headers and fingerprints to match real-user browser traffic"; escolhe a rede de proxy. | Não (e não precisa: é o produto) | 1 crédito/requisição |
| **SERP API** | "collect structured search results from Google, Bing and other engines in under 1 second per request, with no proxy setup." | Diz que o cliente não gerencia "proxies, CAPTCHAs, or parsing"; a página não descreve o funcionamento interno nem traz parâmetro de desbloqueio. | Não há chave documentada | 1 crédito/busca |
| **Web Scraper API** | "Send a URL, receive structured JSON/CSV." (scrapers prontos por domínio) | llms.txt: "Automatic proxy rotation, CAPTCHA solving and JS rendering included." | Não há chave documentada | 1 crédito/registro |
| **Browser API (Scraping Browser)** | navegador na nuvem para coleta com renderização completa | "Automatic proxy rotation ... including residential IPs"; "Browser fingerprint management"; "CAPTCHA detection and solving". | Não há modo separado documentado | **5 créditos/MB** |
| **Datasets** | "Buy 900+ ready-made datasets" (dados já coletados) | Não se aplica (cache) | — | sem gratuito |

**Qual rende mais na cota gratuita:** o **Web Unlocker** (1 crédito por página → até **5.000 páginas públicas/mês**, qualquer site, desbloqueio embutido) é o de maior alcance para ler páginas que bloqueiam robôs; a **SERP API** rende 5.000 buscas/mês para descoberta de links; a **Web Scraper API** rende 5.000 registros, mas só em domínios com scraper pronto; a **Browser API** é a de pior custo-benefício (5 créditos por MB: uma página pesada consome vários créditos; o consumo por página não está documentado). Sob a DP-32 não é preciso "desligar" nada; **a Bright Data não documenta como desligar o desbloqueio da SERP API ou da Scraper API** (se o proprietário voltasse a um regime restrito, essas duas e o Browser API ficariam fora por padrão, restando só Datasets, que não são gratuitos).

**Duas contas:** as páginas lidas da Bright Data **não** tratam de múltiplas contas ("não encontrado"); proíbem compartilhar privilégios de conta ("The Client may not share its account privileges with anyone", [licença](https://brightdata.com/license), atualizada em 12/10/2026) e "Creating fake accounts or content" ([política de uso aceitável](https://brightdata.com/acceptable-use-policy)).

## 2. Outros provedores com plano gratuito por API

| Provedor | Gratuito (literal) | Permanente? | Limites | Fonte |
|---|---|---|---|---|
| **Firecrawl** | "Credits: 1,000 per month", "$0 (no credit card required)"; scrape 1 crédito/página, search 2 créditos/10 resultados; "A scrape that returns no result is not charged." | **Sim, mensal** ("every month"; sem rollover) | /scrape, /map, /search 10/min; /crawl 2/min; 2 requisições simultâneas; acesso "keyless" com teto diário por IP (valor não publicado) | [preços](https://www.firecrawl.dev/pricing), [limites](https://docs.firecrawl.dev/rate-limits), [keyless](https://docs.firecrawl.dev/mcp-server/keyless) |
| **Jina AI Reader** | `r.jina.ai` sem chave: 20 RPM; com chave gratuita 500 RPM; `s.jina.ai` (busca) exige chave, 100 RPM; "Every new API key comes with 10M free tokens" | Chave sem validade; se os tokens gratuitos se renovam **não está dito** (compra-se mais depois) | **Não contorna defesas**: "Reader does not actively circumvent or bypass any website defense mechanisms" (serve para páginas abertas, não para as que bloqueiam) | [Reader](https://jina.ai/reader/), [limites](https://jina.ai/api-dashboard/rate-limit) |
| **Exa** | "The Free Tier gives you $10 in credits (up to 2,500 Lite searches) the day you sign up"; "resets to $10 on the first of every month"; "No payment method required."; conteúdo $1/1k páginas | **Sim, mensal** (+ US$ 10 únicos de onboarding) | limite de taxa gratuito não publicado | [preços](https://exa.ai/pricing), [docs](https://docs.exa.ai/reference/pricing) |
| **Serper** | "Get 2,500 free queries", "No credit card required" | Não confirmado (única ou mensal; a página não diz) | planos pagos 50–300 QPS; gratuito não publicado | [home](https://serper.dev/) |
| **ScrapingBee** | "Try ScrapingBee with 1,000 free API credits." sem cartão; JS rendering 5 créditos, proxy premium 10 ou 25 | **Teste ao registrar**; a página não diz que renova | concorrência gratuita não publicada | [preços](https://www.scrapingbee.com/pricing/), [ajuda](https://help.scrapingbee.com/en/article/do-you-offer-larger-trial-plans-1t3zlg2/) |
| Tavily (referência do Editorial) | "1,000 API credits / month", "No credit card required"; search 1 ou 2 créditos; extract básico 5 URLs por crédito | Mensal ("first day of each month"); permanência não dita | — | [preços](https://www.tavily.com/pricing), [créditos](https://docs.tavily.com/documentation/api-credits) |
| SerpApi | "Free \| $0 \| 250" buscas/mês, 50/hora | Não dito | — | [preços](https://serpapi.com/pricing) |
| Brave Search API | "Up to $20 in free calls every month" (outra leitura cita US$ 5: **confirmar no painel**) | Mensal, mas conflito de valores | — | [API](https://brave.com/search/api/) |

## 3. Termos de uso sobre mais de uma conta (a DP-32 aceita o risco; isto é o que está escrito)

Leitura de [Bright Data](https://brightdata.com/license), [Firecrawl](https://www.firecrawl.dev/terms-of-service), [Tavily](https://www.tavily.com/terms), [Jina](https://jina.ai/legal), [Serper](https://serper.dev/terms), [ScrapingBee](https://www.scrapingbee.com/terms-and-conditions/) (a Exa serve os termos em PDF que a ferramenta não decodificou: **não lida**):
- **Serper:** "Register more than one account at any point in time." e "Attempt to circumvent any restrictions or limits placed on your Serper API key or account." (proibido; revisão de 29/05/2024).
- **ScrapingBee:** "It's strictly forbidden to create multiple Accounts to circumvent limitations induced by the Free Trial." e "Obtaining (or attempting to obtain) Services with the intent to avoid payment" (proibido).
- **Tavily:** "each Order Form provides the Customer and its Users with access to a single Account only"; contas adicionais "may incur additional charges"; chave da API "may not be transferred, assigned, shared".
- **Bright Data, Firecrawl, Jina:** sem cláusula sobre múltiplas contas nas páginas lidas.
- **Consequência prática (não jurídica):** com Serper e ScrapingBee a segunda conta **pode ser encerrada** e levar embora o saldo; com Tavily a segunda conta pode ser cobrada. Para Bright Data, Firecrawl e Jina o risco documentado é menor. Isto não muda a decisão do proprietário; muda **onde a conta 2 é mais segura** (Bright Data, Firecrawl, Jina).

## 4. Proposta do adaptador (referência testada em `src/reader-port.ts`)

- **`ReaderPort`**: `read({ url, purpose }) → ReadResult`. Cada provedor implementa só `KeyedReader.read(req, apiKey) → ProviderResponse` (uma chamada, uma chave). O Tavily do Editorial entra pela mesma interface.
- **Pool de chaves por provedor** (`QuotaKeyPool`): lista ordenada ("conta-1", "conta-2"), cada uma com `secretRef` (nome no cofre/ambiente; o valor só é resolvido na hora da chamada) e **teto mensal = cota gratuita**. A chave é escolhida pelo saldo; "cota esgotada" do provedor marca a chave indisponível até o **dia 1 UTC** do mês seguinte e troca para a próxima **na mesma leitura**; 429 do provedor vira espera (não esgotamento); sem chave com saldo → falha `quota_exhausted`, **nunca compra**.
- **Ritmo** (`HostPacer`): ≥ 10 s entre leituras do mesmo host e teto diário por host.
- **Guardas mantidas pela DP-32**: tela de login e paywall viram falha e o texto é descartado; **CAPTCHA resolvido pelo provedor não para** a leitura, mas desafio devolvido sem resolver (`captcha_unsolved`) é falha.
- **Só fato**: `ReadResult.text` é efêmero; só `toPersistableFact` (fato ≤ 300 caracteres, fonte, link, data) pode ser gravado e recusa corpo de página.
- **Desligado por padrão** (`createReader` sem `enabled: true`); proposta de flag em `@ln/contracts`: `leitorViaProvedor` (desligada), a cargo do Chief Architect.
- Segredos nunca aparecem em resultado, relatório do pool, log ou commit: só o rótulo da chave.
- **Cascata por custo**: tentar primeiro o mais barato que atende ao tipo de leitura (ver `leitor-cascata` na próxima entrega), subindo para desbloqueio só quando o anterior falha por bloqueio.

Testes: `src/tests/reader-port.test.ts` (16): desligado por padrão; troca de conta na mesma leitura e memória da chave esgotada; renovação no dia 1; teto local sem passar da cota; 429 como espera; segredo ausente de resultado e relatório; ritmo por host e teto diário; login/paywall param e descartam o texto; CAPTCHA resolvido pelo provedor passa e desafio não resolvido falha; só fato é persistível.
