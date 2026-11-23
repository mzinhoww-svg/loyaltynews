# 06 — Política de roteamento

Implementação: `src/router.ts` (`AdaptiveRouter`). Shadow por replay: `src/shadow.ts` + `scripts/shadow-replay.ts` (resultado em `data/runs/run-20261123-01/shadow.json`).

## Regras

1. Cache primeiro (mesma URL não é lida duas vezes; requisições simultâneas da mesma URL compartilham a mesma promessa).
2. Ordem por domínio = menor **custo esperado por artigo válido**: `(créditos médios × US$/crédito + US$ 0,0002 por tentativa) / P(válido)`, com P(válido) suavizada (Laplace). Provedor com ≥ 2 tentativas e 0 sucesso no domínio vai para o fim.
3. Fallback só em falha técnica (desafio não resolvido, timeout, erro do provedor, cota, 429, chave inválida). **Login, paywall e 404 param** (DP-32).
4. 429: respeita Retry-After até 60 s; acima disso passa ao próximo provedor. Timeout/429: backoff exponencial com jitter, 1 nova tentativa.
5. Circuit breaker por provedor: 3 falhas técnicas seguidas abrem por 10 min (meio-aberto depois).
6. Orçamento: `BudgetGuard` checa o pior caso antes de cada chamada; acabou a cota, o provedor é pulado.
7. Desligar um provedor: `SCRAPING_PROVIDER_<NOME>_DISABLED=true`. Todas as decisões ficam em `router.log`.

## Shadow por replay das respostas reais (100 URLs elegíveis, nenhuma chamada nova)

| Caminho | Válidos | Tentativas | Fallbacks | US$ equiv. | US$/válido |
|---|---:|---:|---:|---:|---:|
| **Atual**: direct → Tavily | 96 | 112 | 12 | 0,0128 | 0,000133 |
| Cascata fixa por preço: direct → Zyte → Scrapfly → Bright Data → Exa → Tavily → Apify | 100 | 126 | 26 | 0,0147 | 0,000147 |
| **Adaptativo** (validação cruzada em 2 dobras: semeado numa metade, avaliado na outra) | **100** | **116** | **16** | **0,0075** | **0,000074** |

O adaptativo ganha +4 artigos válidos sobre o caminho atual e custa ~45 % menos por artigo válido que a cascata fixa. O teste de unidade do shadow revelou e corrigiu um defeito: um provedor gratuito que sempre falha no domínio ficava em 1º lugar (regra 2, parte final).

## Matriz de roteamento recomendada (resumo)

Primeiro provedor por domínio, com a estatística real: **direct em 30 dos 34 domínios**; Exa em `latamairlines.com` (único que leu); Apify em 2 e Scrapfly em 1 domínio onde o direto falhou. A tabela completa (1º, 2º e 3º, com custo esperado) está em `report.md` → "Matriz de roteamento".

Fallback global sugerido depois do direto (pelo ranking e pelo custo): **Zyte → Scrapfly → Exa → Bright Data → Tavily → Apify**. A ordem por domínio substitui a global quando houver ≥ 2 tentativas no domínio.

## Comparação com a hipótese da Diretiva V3 §12

| Hipótese | Resultado |
|---|---|
| RSS autorizado primeiro | Confirmado para descoberta (41/43 feeds, US$ 0) |
| Firecrawl como caminho padrão | Não aplicável: não existe no código nem tem chave |
| Zyte como alternativa principal | **Confirmado**: maior taxa editorial (95 %) e menor custo pago |
| Scrapfly como fallback | Confirmado (94 %, custo real baixo) |
| Bright Data para casos difíceis | **Não confirmado** nesta amostra: 70 % nas "problema", abaixo de Exa (85 %) e Zyte (80 %) |
| Exa como complemento | Melhor nas "problema" e a mais rápida; sem metadados de data |
