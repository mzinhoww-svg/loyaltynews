# 06 — Política de roteamento

> **Critério v2 (vigente, após a reavaliação do QA 3 de 23/11).** Título recalculado a partir do título gravado, sem atalho pelo corpo, e veredito refeito com a mesma regra para todos os registros (`rejudgeRecord`). É uma estimativa, porque o corpo não é guardado e o título gravado pode estar truncado. As tabelas abaixo desta caixa, quando não marcadas, mostram o **v1 histórico** (`report-v1-historico.*`, `shadow-v1-historico.json`). Os números v2 estão em `report.md` e `shadow.json`.
>
> | Provedor | Editorial v2 | (v1 histórico) | US$/válido v2 |
> |---|---:|---:|---:|
> | firecrawl-scrape | 95 % | 96 % | 0,00400 |
> | zyte-http | 94 % | 95 % | 0,00021 |
> | scrapfly-basic | 93 % | 94 % | 0,00028 |
> | brightdata-unlocker | 89 % | 90 % | 0,00158 |
> | exa-contents | 88 % | 90 % | 0,00114 |
> | direct | 87 % | 88 % | 0 |
> | apify-rag-web-browser | 86 % | 87 % | 0,00419 |
> | tavily-extract | **17 %** | 80 % | 0,00875 |
>
> - **Tavily:** a API não devolve título e a 1ª linha do texto costuma ser um pixel ou um e-mail (u058, u077). A rotulagem confirmou 0 de 5 títulos corretos. O valor v1 estava inflado pelo atalho do corpo.
> - **Ranking v2:** direct, Zyte, Exa, Scrapfly, Bright Data, Firecrawl, Apify, Tavily.
> - **Combinado v2:** 99/100 pelo critério automático; título 97/100 no extrator mais barato com texto; data correta 78/78, com cobertura de 78/99.
> - **Replay v2:**
>   - caminho atual 89/100;
>   - cascata fixa 99/100 a US$ 0,000235 por válido;
>   - adaptativo 99/100 a US$ 0,000206 por válido, 119 tentativas, p95 de 7,6 s contra 10,4 s do atual (após as faixas do roteador, f43922c);
>   - 14 URLs divergem.
>
> **Rotulagem independente (QA 3, 40 pares, `r0-preparacao/qa/ft-scraping-benchmark-m2-label-sample.csv`):**
> - título correto 29/40;
> - fonte confirmável 29/40, sem nenhum "não" (11 indeterminados);
> - texto editorial comprovado pelo trecho 4/40 (10 "não", 26 indeterminados);
> - 4 aprovados no v1 tinham título errado (u041 Exa; u058, u069, u077 Tavily).
>
> **Conclusão honesta:** as metas de precisão da V3 (título e fonte ≥ 95 %; deduplicação ≥ 99 %) **não estão comprovadas**. O trecho de 200 caracteres não basta para provar a presença do texto, e a deduplicação entre URLs distintas exige pares rotulados com o deduplicador. Para fechar, falta rodar o shadow ao vivo em staging guardando um trecho maior para rotulagem, ainda sem texto integral.

Implementação: `src/router.ts` (`AdaptiveRouter`). Shadow por replay: `src/shadow.ts` + `scripts/shadow-replay.ts` (resultado em `data/runs/run-20261123-01/shadow.json`).

## Regras

1. Cache primeiro (mesma URL não é lida duas vezes; requisições simultâneas da mesma URL compartilham a mesma promessa).
2. Ordem por domínio = menor **custo esperado por artigo válido**: `(créditos médios × US$/crédito + US$ 0,0002 por tentativa) / P(válido)`, com P(válido) suavizada (Laplace). Provedor com ≥ 2 tentativas e 0 sucesso no domínio vai para o fim.
3. Fallback só em falha técnica (desafio não resolvido, timeout, erro do provedor, cota, 429, chave inválida). **Login, paywall e 404 param** (DP-32).
4. 429: respeita Retry-After até 60 s; acima disso passa ao próximo provedor. Timeout/429: backoff exponencial com jitter, 1 nova tentativa.
5. Circuit breaker por **provedor × domínio**: 3 falhas técnicas seguidas no mesmo site abrem por 10 min (meio-aberto depois). Antes era global por provedor: no replay, 3 falhas seguidas do direto em sites bloqueados (u206–u220) o desligavam para todos os sites — corrigido, com teste.
6. Orçamento: `BudgetGuard` checa o pior caso antes de cada chamada; acabou a cota, o provedor é pulado.
7. Desligar um provedor: `SCRAPING_PROVIDER_<NOME>_DISABLED=true`. Todas as decisões ficam em `router.log`.

## Shadow por replay das respostas reais (100 URLs elegíveis, nenhuma chamada nova)

Revisão pós-parecer QA 3 (M2): 404/410 agora **param** no replay como no roteador normal (antes viravam fallback); disjuntor ativo com **relógio simulado** (duração medida + 15 s por URL); registro de **divergência por URL** e **latência** (`shadow.json` → `divergences`, `perUrl`). Resultado: 14 URLs divergem entre o atual e o adaptativo; latência por URL p50/p95: atual 460/10.363 ms, cascata 549/10.113 ms, adaptativo 534/7.626 ms. Limite: é replay das respostas medidas, **não** a comparação ao vivo com o coletor (09).

| Caminho | Válidos | Tentativas | Fallbacks | US$ equiv. | US$/válido |
|---|---:|---:|---:|---:|---:|
| **Atual**: direct → Tavily | 96 | 112 | 12 | 0,0144 | 0,000150 |
| Cascata fixa por preço: direct → Zyte → Scrapfly → Bright Data → Exa → Tavily → Apify | 100 | 126 | 26 | 0,0149 | 0,000149 |
| **Adaptativo** (validação cruzada em 2 dobras: semeado numa metade, avaliado na outra) | **100** | **116** | **16** | **0,0075** | **0,000074** |

O adaptativo ganha +4 artigos válidos sobre o caminho atual e custa ~45 % menos por artigo válido que a cascata fixa. O teste de unidade do shadow revelou e corrigiu um defeito: um provedor gratuito que sempre falha no domínio ficava em 1º lugar (regra 2, parte final).

## Matriz de roteamento recomendada (resumo)

Primeiro provedor por domínio, com a estatística real: **direct em 30 dos 34 domínios**; Exa em `latamairlines.com` (Exa e Firecrawl leram; Exa é mais barata); Apify em 2 e Scrapfly em 1 domínio onde o direto falhou. A tabela completa (1º, 2º e 3º, com custo esperado) está em `report.md` → "Matriz de roteamento".

Fallback global sugerido depois do direto (pelo ranking e pelo custo): **Zyte → Scrapfly → Exa → Bright Data → Firecrawl → Tavily → Apify**. O shadow por replay com o Firecrawl incluído dá o mesmo resultado (100/100, US$ 0,000074 por válido): ele quase nunca é necessário. A ordem por domínio substitui a global quando houver ≥ 2 tentativas no domínio. Ressalva do QA 3 corrigida: a ordem agora usa faixas por domínio (0 = já teve sucesso, 1 = sem histórico, 2 = só falhou, mesmo com 1 observação) e o custo esperado dentro da faixa. aeroin.net passa a Exa e finextra.com a Zyte. Replay v2 do adaptativo: 99/100, 119 tentativas (antes 123), p95 de 7,6 s (antes 10,1 s), US$ 0,000206 por válido.

## Comparação com a hipótese da Diretiva V3 §12

| Hipótese | Resultado |
|---|---|
| RSS autorizado primeiro | Confirmado para descoberta (41/43 feeds, US$ 0) |
| Firecrawl como caminho padrão | **Não confirmado**: maior taxa automática (96 %), mas ~19× o custo do Zyte por artigo válido (preço oficial Hobby) e p50 de 5,7 s; serve como fallback, não como padrão |
| Zyte como alternativa principal | **Confirmado**: maior taxa editorial (95 %) e menor custo pago |
| Scrapfly como fallback | Confirmado (94 %, custo real baixo) |
| Bright Data para casos difíceis | **Não confirmado** nesta amostra: 70 % nas "problema", abaixo de Exa (85 %) e Zyte (80 %) |
| Exa como complemento | Melhor nas "problema" e a mais rápida; sem metadados de data |
| Firecrawl (rodada delta) | Maior taxa editorial (96 %) e lê LATAM, mas o mais caro e lento: entra como fallback de qualidade para domínios em que Exa/Zyte falham; não muda a matriz (direct segue 1º em 30 de 34 domínios) |
