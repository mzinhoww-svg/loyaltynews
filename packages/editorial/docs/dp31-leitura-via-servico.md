# DP-31/DP-32: leitura de fontes que bloqueiam robôs, via provedor de extração/desbloqueio (risco aceito pelo proprietário)

> **ADR-007 v8 (decisão do PM de 27/11, J-14 A) restringe este documento.** Não há lista nominal de exceções, então não há exceção:
> - o `robots.txt` do alvo é conferido antes de qualquer leitura, direta ou por provedor. Proíbe = não lê. Ilegível, erro HTTP (inclusive 401, 403, 410, 429, 5xx), rede/timeout, HTML ou desafio no lugar do arquivo = não lê (`robots_unavailable`). Só **404** vale como "sem regras";
> - nos leitores do Intelligence e do benchmark, **404 e 410** valem como "sem regras" e uma página HTML comum, sem sinal de desafio, também (comportamento anterior do verificador, mantido);
> - provedor com desbloqueio (`unlocks`) não é usado; desafio/CAPTCHA, direto ou por provedor, não vira evidência e **para** a fonte;
> - falha por URL não passa a outro provedor.
> Não verificável: redirecionamentos que o provedor siga por dentro. O texto abaixo é histórico onde disser o contrário.


Registro: `r0-preparacao/decisoes-proprietario-2026-11-22.md`, DP-31 (23/11/2026). O proprietário aceitou o risco de ler **páginas públicas sem login** que bloqueiam robôs, ignorando `robots.txt` e a recusa por User-Agent/403, **pelo Tavily (ou serviço parecido) ou pelo navegador do OpenBot**, em ritmo baixo. Fora: resolver ou burlar CAPTCHA, falsificar identidade de navegador, proxy rotativo ou qualquer evasão de detecção, furar paywall ou login, e tráfego que pese no site. Mantido: nunca reproduzir texto; guardar só fato, fonte, link e data.

## DP-32 (23/11/2026) substitui as restrições da DP-31

Registro: `r0-preparacao/decisoes-proprietario-2026-11-22.md`. O proprietário pediu eficiência máxima e aceitou o risco jurídico e de termos de uso. **Liberado em páginas públicas:** provedores de scraping com desbloqueio (Bright Data Web Unlocker/Scraping Browser, Tavily, Firecrawl e similares), **inclusive a resolução de CAPTCHA e os proxies do próprio provedor**; ignorar `robots.txt` e a recusa por User-Agent; duas contas por provedor na cota gratuita. **Mantido:** nada de área com login nem paywall; ritmo baixo, sem sobrecarregar o site; nunca reproduzir texto (só fato, fonte, link e data); nada pago sem o proprietário.

No código:
- O campo passa a se chamar **`acesso: 'via-provedor'`** (era `risco-aceito-dp31`): é o modo de acesso "via provedor". Todas as fontes marcadas (as 11 bloqueadas + Santander RI) continuam desabilitadas até a revisão humana, cuja nota deve citar a **DP-31 ou a DP-32**.
- **O CAPTCHA/desafio deixa de PARAR a coleta quando a leitura passa pelo provedor** (`Skip.viaProvider`): é falha do provedor naquela URL; **nunca vira evidência**, e 3 falhas seguidas (desafio, erro HTTP ou conteúdo vazio) param a fonte. **Login/paywall continuam parando** (2 seguidos). **O coletor direto, com o nosso User-Agent, continua parando no desafio** (`stopsCollection`), no 403, no 429 e no robots.
- O coletor **não resolve CAPTCHA nem usa proxy por conta própria**: quem faz isso é o provedor (`ReaderPort.unlocks`, informativo). O Tavily não promete resolver CAPTCHA (`unlocks = false`).
- **Vários provedores em cascata:** `ChainedReader([...])` passa ao próximo provedor quando o anterior esgota a cota (`quotaExhausted`) ou não consegue ler a URL (`failedUrl`); 429 por ritmo de um serviço **não** troca de provedor. Cada provedor cuida das suas contas (ex.: `TavilyReader` com `LN_TAVILY_API_KEYS`). Os adaptadores de Bright Data, Apify, Scrapfly e Zyte (e a cota por conta) são do **Data**; o Editorial só consome o `ReaderPort` (contrato em `src/collector/collector.ts`: `read(url)`, `discover?(source, limit)`, `unlocks?`).
- Ritmo e teto continuam: ≥ 10 s por host, 5 páginas/dia (global, no banco), 429 para.

## O que foi implementado (desligado por padrão)

| Peça | Onde | Comportamento |
|---|---|---|
| Campo `acesso: 'via-provedor'` por fonte | `Source.acesso` (`types.ts`) | Ausente = acesso padrão com todas as guardas. Entra na impressão digital da fonte: mudar o campo invalida a revisão humana. Aparece no `SourceView` (`acesso`) para o Studio destacar. |
| Porta de leitura | `ReaderPort` (`collector.ts`) | Só uma fonte com o campo usa a porta; sem porta configurada a fonte é pulada (`reader_unavailable`) e **nada é buscado direto**. |
| Adaptador Tavily | `TavilyReader` (`tavily-reader.ts`) | `POST /extract` (1 URL por chamada, `basic`, texto) e `POST /search` com `include_domains` para descobrir matérias. A chave só vai no cabeçalho `Authorization`. Só é criado se o worker receber `LN_TAVILY_API_KEY`. |
| Ritmo DP-31 | `Collector` | ≥ **10 s** entre leituras do mesmo host; no máximo **5 páginas por host em 24 h** (acima, `rate_limited`, sem leitura); 429 do serviço para a coleta da fonte. |
| Guardas que **continuam** | `collectUrlViaReader` | Login/paywall (`gated`) para e nada vira evidência; desafio (`challenge`) nunca vira evidência (pela DP-32 não para sozinho: ver acima); 403/falha do serviço por URL para a coleta, sem fallback para o coletor direto. |
| Guardar pouco | `capText` | A evidência guarda só um **trecho curto** (≤ 1.500 caracteres), o link, a data e o hash do corpo inteiro; marcada `acesso: 'via-provedor'`. |
| Habilitação | `reviewSource` | Fonte `inacessivel` só é aprovável com o campo DP-31 **e** nota de revisão que cite a DP-31; as demais inacessíveis continuam 409. Habilitar segue exigindo `admin`/`editor_chefe` e a revisão atual. |
| Fontes marcadas | `seed-blogs.ts`, `seed.ts` | As **11 bloqueadas** (Doctor of Credit, Head for Points, PhocusWire, Travel Weekly, Loyalty360, Loyalty Lobby, Finextra, Aeroflap, Executive Traveller, Rock Content, Mile Value) e o **Santander RI**. Todas desabilitadas. |

Testes: `src/tests/dp31.test.ts` (9) e `src/tests/qa2-coletor-3.test.ts` (7): sem serviço nada é buscado direto; robots `Disallow: /` ignorado só na fonte marcada; ritmo de 10 s e teto diário; 429 e 403 param; **CAPTCHA e login continuam parando**; fonte comum com o mesmo serviço configurado não o usa; cadastro (12 marcadas); regra da revisão; `TavilyReader` com respostas simuladas.

## Tavily: o que a documentação oficial diz (lida em 23/11/2026, docs.tavily.com)

- **Plano gratuito (Researcher):** 1.000 créditos/mês, **sem cartão**; limite de 100 requisições/min; 429 traz `Retry-After` (`/documentation/api-credits`, `/rate-limits`).
- **Custos:** busca básica = 1 crédito; extract básico = 1 crédito a cada 5 extrações bem-sucedidas; extração que falha **não é cobrada**; extract aceita 1 a 20 URLs e devolve falhas em `failed_results` mesmo com HTTP 200 (`/api-credits`, `/endpoint/extract`).
- **Robots.txt:** as páginas lidas (créditos, limites, extract, keyless, FAQ) **não dizem** se o extract respeita o `robots.txt`. Fato não verificado.
- **Pagamento:** há pagamento por protocolo x402 e planos pagos; **nada disso é usado** (sem plano pago, sem cartão).

## Teste real no plano gratuito (23/11/2026) — feito

- O acesso "keyless" estourou o teto compartilhado (429); por isso o teste usou as chaves gratuitas do cofre do OpenBot (sem cartão, sem x402, sem plano pago). Só status, tamanhos e sinais foram registrados; **nenhum conteúdo foi guardado** e nenhuma chave foi impressa.
- **Chave 1** (arquivo `TAVILY_API_KEY`): o valor **não tem o formato de chave do Tavily** (não começa por `tvly-`) e o serviço respondeu **401**. Precisa ser corrigida pelo proprietário; o leitor a pula e segue para a próxima.
- **Chave 2** (`TAVILY_API_KEY_2`, formato `tvly-`): funcionou. Resultados (1 extract por URL, ≥ 10 s entre chamadas):

| Leitura | Status | Texto | Desafio |
|---|---|---|---|
| Controle: página aberta (tavily.com) | 200 | 7.357 caracteres | não |
| DP-31: RI do Santander (403 para o nosso coletor) | **200** | 2.481 caracteres | não |
| DP-31: Doctor of Credit (robots 403 para o coletor) | **200** | 2.078 caracteres | não |
| Busca com `include_domains` (Doctor of Credit) | 200 | 3 resultados (1 com data) | — |

- Custo: ≈ 0,6 crédito de extract + 1 de busca por rodada de teste (plano gratuito: 1.000 créditos/mês). A busca com `topic: news` não achou blogs; passou a `general`.
- Conclusão: o Tavily lê as páginas que o coletor direto não consegue; **nada garante** que o mesmo valha para todos os sites bloqueados (o Tavily pode falhar por URL em `failed_results`).

## Várias chaves (`LN_TAVILY_API_KEYS`)

Lista ordenada separada por vírgula (ou `LN_TAVILY_API_KEY` com uma). A leitura usa a 1ª chave até a **cota do serviço** acabar (HTTP 432/433, ou 429 cujo corpo fala de crédito/cota/limite de uso) e passa para a próxima, refazendo a chamada que não foi atendida; **chave recusada (401) também é pulada** (`keysRejected` sinaliza a configuração errada). **429 por ritmo do serviço não troca de chave**: devolve 429 e a coleta da fonte para, como o 429 de ritmo de qualquer site. Sem chaves restantes: `reader_unavailable` (cota esgotada) ou 401 (todas inválidas) e a coleta DP-31 para, sem fallback. Nenhum valor é impresso, gravado ou posto em mensagem de erro.

## Correções do QA 2 (3ª rodada)

1. Nenhum código de produção injeta intervalo zero (teste varre `apps/workers`, `packages/editorial` e `apps/web/app/api/_lib`); padrões: 3 s por host, 10 s e 5 páginas/dia na DP-31.
2. `robots.ts` não tem mais parser nem comparador próprios: toda decisão (inclusive no redirecionamento) vem do módulo comum `crawl-guards.mjs` (Data, ft/intelligence 21efc8f: precedência pelo comprimento normalizado). Só o Crawl-delay do grupo e a contagem de regras ficam no Editorial, escolhendo o grupo pelo mesmo token exato.
3. Índice de sitemap: 403, 429 ou desafio num filho interrompem a leitura; as páginas não são lidas.
4. `StopGuard`: para sempre em 429/403/401/desafio/Crawl-delay excessivo/falha do serviço por URL; e após 2 páginas seguidas com login/paywall ou 3 falhas seguidas. Usado no feed, no sitemap, na descoberta DP-31, nas âncoras de blog e no autoral.
5. Limite diário e espaçamento DP-31 **globais**: `StoreReadBudget` grava cada leitura (`collector.dp31_read`) na trilha de auditoria do banco; duas instâncias ou um restart enxergam o mesmo contador. Limite conhecido: duas instâncias que reservam no mesmo milissegundo podem passar as duas (exclusão estrita pediria uma linha de contador com UPSERT; a trilha é somente-acréscimo).
6. `capText` nunca passa do máximo (a reticência conta; exatamente 1.500 fica intacto).

## Fontes que se encaixam (lista pedida pelo PM)

- **Bloqueio de propósito (agora cobertas pela DP-31, desabilitadas):** as 12 acima.
- **Falha técnica sem recusa do site (caberiam mesmo sem a DP-31):** 6 candidatos de blog não alcançados por DNS/tempo esgotado (Pontos pelo Mundo, Mobills blog, Supermercado Moderno, Loyalty Brasil/Clube da Fidelidade, Points Miles & Martinis, AEROIN) — antes de tudo, conferir a URL; páginas que só renderizam em JavaScript: Startse e Administradores.com (classe E mecânica), LATAM (termo só em JS) e BCB (home em JS); Magalu RI sem feed/sitemap (comunicados em PDF).
- Integração proposta: o próprio `acesso: 'via-provedor'` + `ReaderPort` (o "via-busca" pedido): fonte marcada, **desligada** até a revisão humana, lida pelo serviço, descoberta por `search` com `include_domains`.

## Limites e riscos que continuam

- O proprietário aceitou o risco jurídico/contratual de ignorar `robots.txt` e bloqueios; este código **não** falsifica navegador, não usa proxy e não resolve CAPTCHA. Se o serviço entregar desafio, login ou paywall, a coleta para.
- Trecho curto guardado: os gates de números/datas só enxergam esse trecho; matérias de fontes DP-31 tendem a ter menos fatos checáveis.
- O Tavily pode falhar em sites que bloqueiam agressivamente (`failed_results`): nesse caso a fonte fica sem leitura; **não** há segundo serviço nem retentativa.
