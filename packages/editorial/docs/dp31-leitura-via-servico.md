# DP-31: leitura de fontes que bloqueiam robôs, por serviço de extração (risco aceito pelo proprietário)

Registro: `r0-preparacao/decisoes-proprietario-2026-11-22.md`, DP-31 (23/11/2026). O proprietário aceitou o risco de ler **páginas públicas sem login** que bloqueiam robôs, ignorando `robots.txt` e a recusa por User-Agent/403, **pelo Tavily (ou serviço parecido) ou pelo navegador do OpenBot**, em ritmo baixo. Fora: resolver ou burlar CAPTCHA, falsificar identidade de navegador, proxy rotativo ou qualquer evasão de detecção, furar paywall ou login, e tráfego que pese no site. Mantido: nunca reproduzir texto; guardar só fato, fonte, link e data.

## O que foi implementado (desligado por padrão)

| Peça | Onde | Comportamento |
|---|---|---|
| Campo `acesso: 'risco-aceito-dp31'` por fonte | `Source.acesso` (`types.ts`) | Ausente = acesso padrão com todas as guardas. Entra na impressão digital da fonte: mudar o campo invalida a revisão humana. Aparece no `SourceView` (`acesso`) para o Studio destacar. |
| Porta de leitura | `ReaderPort` (`collector.ts`) | Só uma fonte com o campo usa a porta; sem porta configurada a fonte é pulada (`reader_unavailable`) e **nada é buscado direto**. |
| Adaptador Tavily | `TavilyReader` (`tavily-reader.ts`) | `POST /extract` (1 URL por chamada, `basic`, texto) e `POST /search` com `include_domains` para descobrir matérias. A chave só vai no cabeçalho `Authorization`. Só é criado se o worker receber `LN_TAVILY_API_KEY`. |
| Ritmo DP-31 | `Collector` | ≥ **10 s** entre leituras do mesmo host; no máximo **5 páginas por host em 24 h** (acima, `rate_limited`, sem leitura); 429 do serviço para a coleta da fonte. |
| Guardas que **continuam** | `collectUrlViaReader` | Desafio/CAPTCHA (`challenge`) e login/paywall (`gated`) param e nada vira evidência; 403/falha do serviço para a coleta e **não há fallback** para o coletor direto nem outro caminho. |
| Guardar pouco | `capText` | A evidência guarda só um **trecho curto** (≤ 1.500 caracteres), o link, a data e o hash do corpo inteiro; marcada `acesso: 'risco-aceito-dp31'`. |
| Habilitação | `reviewSource` | Fonte `inacessivel` só é aprovável com o campo DP-31 **e** nota de revisão que cite a DP-31; as demais inacessíveis continuam 409. Habilitar segue exigindo `admin`/`editor_chefe` e a revisão atual. |
| Fontes marcadas | `seed-blogs.ts`, `seed.ts` | As **11 bloqueadas** (Doctor of Credit, Head for Points, PhocusWire, Travel Weekly, Loyalty360, Loyalty Lobby, Finextra, Aeroflap, Executive Traveller, Rock Content, Mile Value) e o **Santander RI**. Todas desabilitadas. |

Testes: `src/tests/dp31.test.ts` (9): sem serviço nada é buscado direto; robots `Disallow: /` ignorado só na fonte marcada; ritmo de 10 s e teto diário; 429 e 403 param; **CAPTCHA e login continuam parando**; fonte comum com o mesmo serviço configurado não o usa; cadastro (12 marcadas); regra da revisão; `TavilyReader` com respostas simuladas.

## Tavily: o que a documentação oficial diz (lida em 23/11/2026, docs.tavily.com)

- **Plano gratuito (Researcher):** 1.000 créditos/mês, **sem cartão**; limite de 100 requisições/min; 429 traz `Retry-After` (`/documentation/api-credits`, `/rate-limits`).
- **Custos:** busca básica = 1 crédito; extract básico = 1 crédito a cada 5 extrações bem-sucedidas; extração que falha **não é cobrada**; extract aceita 1 a 20 URLs e devolve falhas em `failed_results` mesmo com HTTP 200 (`/api-credits`, `/endpoint/extract`).
- **Robots.txt:** as páginas lidas (créditos, limites, extract, keyless, FAQ) **não dizem** se o extract respeita o `robots.txt`. Fato não verificado.
- **Pagamento:** há pagamento por protocolo x402 e planos pagos; **nada disso é usado** (sem plano pago, sem cartão).

## Teste no plano gratuito: não concluído (falta chave)

- Tentei o acesso "keyless" da documentação (sem conta, cabeçalho `X-Tavily-Access-Mode: keyless`): 3 chamadas de extract (uma delas a um site de bloqueio conhecido, outra ao RI do Santander) voltaram **HTTP 429** com `daily_cap_reached` e `monthly_cap_reached_bonus_eligible`. O teto keyless é compartilhado e já estava esgotado; **não** foi uma limitação nossa e nenhuma página foi lida.
- Para testar de verdade é preciso a **chave gratuita** (cadastro em app.tavily.com, sem cartão): variável `TAVILY_API_KEY` no cofre do OpenBot. Como combinado com o PM, **não pedi ao proprietário**: o PM decide. Com a chave, a rodada de teste é: 1 `extract` de uma página aberta conhecida (controle), 1 de uma fonte DP-31 (ex.: Santander RI) e 1 `search`, anotando só status, tamanho e se veio desafio/login; ≤ 5 créditos.

## Fontes que se encaixam (lista pedida pelo PM)

- **Bloqueio de propósito (agora cobertas pela DP-31, desabilitadas):** as 12 acima.
- **Falha técnica sem recusa do site (caberiam mesmo sem a DP-31):** 6 candidatos de blog não alcançados por DNS/tempo esgotado (Pontos pelo Mundo, Mobills blog, Supermercado Moderno, Loyalty Brasil/Clube da Fidelidade, Points Miles & Martinis, AEROIN) — antes de tudo, conferir a URL; páginas que só renderizam em JavaScript: Startse e Administradores.com (classe E mecânica), LATAM (termo só em JS) e BCB (home em JS); Magalu RI sem feed/sitemap (comunicados em PDF).
- Integração proposta: o próprio `acesso: 'risco-aceito-dp31'` + `ReaderPort` (o "via-busca" pedido): fonte marcada, **desligada** até a revisão humana, lida pelo serviço, descoberta por `search` com `include_domains`.

## Limites e riscos que continuam

- O proprietário aceitou o risco jurídico/contratual de ignorar `robots.txt` e bloqueios; este código **não** falsifica navegador, não usa proxy e não resolve CAPTCHA. Se o serviço entregar desafio, login ou paywall, a coleta para.
- Trecho curto guardado: os gates de números/datas só enxergam esse trecho; matérias de fontes DP-31 tendem a ter menos fatos checáveis.
- O Tavily pode falhar em sites que bloqueiam agressivamente (`failed_results`): nesse caso a fonte fica sem leitura; **não** há segundo serviço nem retentativa.
