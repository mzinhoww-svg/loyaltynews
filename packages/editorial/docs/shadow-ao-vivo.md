# Shadow ao vivo do roteador de scraping no worker da fábrica (só medição)

Pedido: `loyalty-news-scraping-benchmark` (Diretiva V3 §14; parecer QA 3 M2, achado 4), autorizado pelo PM em 23/11/2026. A Editorial é dona do worker e fez a ligação; o pacote `@ln/scraping-benchmark` **não** é dependência do Editorial.

## Como funciona

- **Flag:** `SCRAPING_SHADOW_MODE` (só a string exata `true` liga; desligada por padrão). `loadShadow(env)` (`apps/workers/src/editorial-factory.ts`) só importa `@ln/scraping-benchmark` quando a flag está ligada e chama `createLiveShadowFromEnv(env)`, que **o benchmark precisa exportar** e que devolve a porta `ShadowPort { observe(url, {name, status, body?, ms}), drain() }`. Caminho do JSONL: `SCRAPING_SHADOW_SINK` (lido pela fábrica do benchmark). Com a flag ligada e o pacote ou a fábrica ausentes, o job **recusa começar** (não segue sem medir em silêncio).
- **Leituras diretas** (o coletor com o nosso User-Agent): `Collector.onDirectRead` chama `shadow.observe` depois de cada GET de **matéria** (status, corpo e latência; nunca para `robots.txt`, feed ou sitemap), sem aguardar e engolindo qualquer erro.
- **Leituras via provedor** (fontes `via-provedor`): `shadowReader(reader, shadow)` devolve o resultado do leitor atual **exatamente**, chama `observe` e **preserva `discover`**. (O `wrap` do benchmark descarta `discover`, de que a descoberta DP-31/DP-32 depende; por isso o worker usa `observe`.) Se o leitor atual lança, a exceção é repassada **uma vez**, sem segunda leitura.
- **Fim do job:** `drainShadow` espera a fila da sombra (também no dry-run e no job autoral); erro do `drain` é engolido.
- **Nada gravado como matéria:** a sombra não recebe o `store` e não toca o banco de matérias; um teste compara matérias e trilha de auditoria com e sem sombra (iguais).

## O que o benchmark precisa garantir do lado dele

1. Exportar `createLiveShadowFromEnv(env): ShadowPort`.
2. A sombra só lê URLs que o coletor já leu, ou seja, de fontes **habilitadas por revisão humana**; mesmo assim, o roteador deve respeitar por host **≥ 10 s** e **poucas páginas por dia** (DP-31/DP-32), parar no 429 e só usar cota gratuita (BudgetGuard), sem login, paywall nem carga pesada.
3. Gravar só status, tamanho, hash, latência, créditos e provedor (nunca o texto da página) em caminho fora do banco de matérias.
4. Chaves de provedor só pelo cofre do ambiente, nunca no código nem em log.

## Testes

`apps/workers/src/editorial-factory.shadow.test.ts` (5: ligado observa só a leitura direta e o resultado é igual ao sem sombra; sombra que lança não derruba; dry-run espera o drain; `shadowReader`; `loadShadow`), `packages/editorial/src/tests/collector-guards.test.ts` (caso 6: `onDirectRead`).

## Contrato fechado com o benchmark (ft/benchmark `ec382e5`, conferido em 23/11/2026)

`createLiveShadowFromEnv(env)` já existe e encaixa na `ShadowPort` (conferido por um teste temporário entre as duas worktrees: `loadShadow` aceitou o módulo real, `observe`/`drain` funcionam e só a comparação vai para o JSONL). Variáveis do ambiente do staging: **obrigatórias** `SCRAPING_SHADOW_MODE=true` e `SCRAPING_SHADOW_SINK` (caminho do JSONL, fora do banco de matérias); **opcionais** `SCRAPING_SHADOW_LEDGER`, `SCRAPING_SHADOW_MIN_GAP_MS` (padrão 10000), `SCRAPING_SHADOW_MAX_PER_HOST_DAY` (padrão 5), `SCRAPING_SHADOW_MAX_URLS` (padrão 200); **chaves** `LN_ZYTE_API_KEY`, `LN_SCRAPFLY_API_KEY`, `LN_EXA_API_KEY`, `LN_BRIGHTDATA_API_KEY` (+ `LN_BRIGHTDATA_ZONE`, padrão `web_unlocker1`), `LN_FIRECRAWL_API_KEY`, `LN_APIFY_API_TOKEN`, só pelo cofre do ambiente (provedor sem chave fica fora; sem nenhuma chave só a leitura direta participa; Tavily não entra). Ritmo dentro da sombra: ≥ 10 s por host, 5 páginas por host por dia, 429 suspende o host até o fim do dia, login/paywall/404 param, corte por cota (BudgetGuard). As duas branches (`ft/editorial` e `feature/loyalty-news-scraping-benchmark`) são integradas juntas pelo PM.
