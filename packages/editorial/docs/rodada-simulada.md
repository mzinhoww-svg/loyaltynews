# Rodada SIMULADA ponta a ponta — Senado e Câmara (PostgreSQL real local)

> **SIMULADO.** Nenhum modelo real foi chamado, nada foi publicado, nenhuma API tarifada foi usada.
> O que foi **real**: PostgreSQL 18.7 local, migrações oficiais, rotas oficiais (`/api/editorial/*`),
> `robots.txt` e feeds do Senado e da Câmara (poucos GET somente leitura, UA do coletor, robots respeitado) e as páginas das matérias.
> O que foi **simulado**: o modelo (`SimulatedEditorialModel`, texto sempre com a palavra `SIMULADO`).
> Gerado por `apps/web/app/api/editorial/rodada-local.test.ts`; dados em `docs/rodada-simulada/`.

## Como repetir

```
# PostgreSQL próprio da Frente 06 (porta 55433; não toca o 55432 do Backend)
pg_ctl -D <pgdata-editorial> -o "-p 55433 -c listen_addresses=127.0.0.1" start
createdb -h 127.0.0.1 -p 55433 -U postgres ln_editorial_local      # uma vez
LN_LOCAL_PG_URL=postgres://postgres@127.0.0.1:55433/ln_editorial_local \
  npx vitest run apps/web/app/api/editorial/rodada-local.test.ts
pg_ctl -D <pgdata-editorial> stop
```

Sem `LN_LOCAL_PG_URL` o teste é ignorado (não roda em CI). O teste zera e remigra o banco apontado (`DROP DATABASE`), por isso uma guarda (`fixtures/local-pg-guard.mock.ts`, testada em `src/tests/local-pg-guard.test.ts`) recusa, antes de conectar, qualquer destino que não seja **local e descartável**: host `localhost`, `127.0.0.1` ou `::1`; sem parâmetros de URL; nome do banco só `[a-z0-9_]` e com prefixo `test_`, `ln_test_` ou `ln_editorial_local` (`postgres`, `template0/1` e bancos de aplicação são recusados).
Não rode em sequência rápida: a Câmara respondeu HTTP 429 depois de várias execuções seguidas (ver "Achados").

## O que a rodada fez (7 passos)

1. Zerou o PostgreSQL local e aplicou as migrações oficiais (54 tabelas).
2. Leu `robots.txt` das duas fontes e avaliou nosso UA e 12 agentes de IA (GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-Web, anthropic-ai, PerplexityBot, Google-Extended, CCBot, Bytespider, Omgilibot, FacebookBot).
3. Habilitou `senado-noticias` e `camara-noticias` pelas rotas oficiais, com nota "ENSAIO LOCAL (simulado)" e revisor registrado.
4. Coleta real por fonte (`limitPerSource: 3`, `maxArticles: 1`) → triagem → contexto → redação → checagem em provedor distinto → revisão (modelo simulado).
5. Emitiu o recibo de aprovação pela rota oficial de recibos; o hash do recibo é igual ao hash do rascunho (ADR-017).
6. Tentou publicar: sem a flag `publicacaoPortal` → `waiting_flag`; com a flag → `simulated_content` (recusado por regra). Chamadas HTTP de publicação: 0; outbox: 0.
7. Projetou custo com tokens de entrada medidos nos prompts reais (evidência real) e tarifas de `contracts/model.policy.json`.

## robots.txt (inclusive agentes de IA)

| Fonte | robots | Regras p/ agentes de IA | Feed | Listagem | Crawl-delay |
|---|---|---|---|---|---|
| Senado (`www12.senado.leg.br`) | 200, 162 bytes | nenhuma (grupo `*` sem Disallow) | permitido | permitida | — |
| Câmara (`www.camara.leg.br`) | 200, 6.570 bytes | **35 regras específicas por agente de IA** (GPTBot, ClaudeBot, etc.) | permitido para nosso UA e para todos os 12 agentes testados | permitida | — |

A Câmara bloqueia caminhos administrativos/internos (`/wp-admin*`, `/config*`, `/tmp*`, `/admin*`, `/login*`, `/private*`, `/comentarios*`, `/sileg/prop_lista*`…), **nenhum** deles é feed nem matéria. Conclusão mecânica: o feed `ultimas-noticias` e as matérias `/noticias/…` não estão vetados nem para agentes de IA declarados. Isso é leitura do arquivo, não parecer jurídico; os termos de reuso estão em `termos-fontes.md` (classe A para ambas).

## Pacotes gerados (em `docs/rodada-simulada/`)

| Fonte | Matéria de origem | Texto da evidência | Gate | Recibo | Publicação |
|---|---|---|---|---|---|
| Senado | "Autodeclaração racial ajuda a revelar preconceitos e combater desigualdades" | 7.754 caracteres | passou, sem achados | v1, hash = hash do rascunho | recusada (`simulated_content`) |
| Câmara | "Câmara deve votar ajuste fiscal; proposta do governo pretende economizar R$ 70 bilhões" | 3.011 caracteres | passou, sem achados | v1, hash = hash do rascunho | recusada (`simulated_content`) |

Cada `pacote-<fonte>-<n>.json` traz: fonte habilitada e termos, evidência (URL, canonical, sha256, início do texto), rascunho (slug, título, resumo, corpo, claims, assinatura "Redação Loyalty News"), checagem simulada (provedor distinto do redator), gate, recibo e estado da publicação. Todos têm o aviso "SIMULADO … NÃO publicar". `dados-da-rodada.json` reúne robots, habilitação, rodadas, publicação e custo.

## Achados corrigidos nesta rodada (reais, não simulados)

| Achado | Efeito | Correção |
|---|---|---|
| Feed do Senado traz só `<guid>` com o endereço (sem `<link>`) | 0 itens coletados | `parseFeed` usa `<guid>` http(s) quando não é `isPermaLink="false"` |
| Página do Senado sem `<article>`/`<main>`; primeiro bloco era o aviso de notificações | evidência de 52 caracteres | extração por parágrafos (fora de nav/footer/aside/dialog/modal/cookie…, sem repetição) quando não há `<article>`/`<main>` ou o bloco é curto |
| `<article-card>` e `<main-menu>` casavam como `<article>`/`<main>` | bloco errado | expressão exige fim do nome da tag |
| Câmara respondeu HTTP 429 após execuções seguidas | falha opaca `http_error` | 429 vira `rate_limited` (com Retry-After); o feed para de insistir |
| Instrução escondida em comentário HTML não era vista pela extração por parágrafos | prompt-injection passaria | comentários da página inteira são analisados e marcam a evidência como suspeita |
| Conteúdo `SIMULADO` poderia, em tese, ser aprovado e chegar à porta | risco de publicar ensaio | `isSimulatedContent` recusa em `applyPublication` e em `publishApproved` (`simulated_content`); mapeado 409 em `apps/web/app/api/_lib/editorial/publication.ts` (edição mínima em arquivo do Backend) |

Testes novos: `src/tests/extraction.test.ts` (4), guid em `collector.test.ts`, modelo simulado em `factory.test.ts`.

## O que muda quando o modelo for real

1. **Conformidade de JSON.** O modelo simulado sempre devolve JSON válido. Modelos reais vão falhar às vezes: `parseModelJson` rejeita e a fábrica registra falha do estágio; é preciso medir a taxa de falha por modelo e decidir tentativas (hoje 1 por estágio, até 3 de redação).
2. **Prompts não foram validados com modelo real.** Medimos só tamanho (entrada). Qualidade, tom, resumo e slug dependem da primeira rodada real em staging.
3. **Redação real vai bater nos gates.** O simulado nunca copia trecho, não cita número nem fala. Um redator real pode acionar `copy_literal`, números sem lastro, citações não literais e claims sem evidência; espere bloqueios e rascunhos reprovados na primeira rodada. A fonte (classe A) autoriza reuso com atribuição, mas o gate de cópia literal continua valendo.
4. **Checagem independente de verdade.** Hoje "provedor distinto" é um nome. Com modelos reais, `excluiProvedores` impede o mesmo provedor; é preciso confirmar que o roteamento do gateway respeita isso e que há ao menos dois provedores habilitados (`modelosHabilitados`).
5. **Custo.** Limite superior por matéria com as duas evidências desta rodada (sem cache, reservas, social ou cargos): econômico ≈ **US$ 0,016**; conservador (redação e revisão em claude-sonnet-5-5, checagem em deepseek-v4-pro) ≈ **US$ 0,098**; pior caso com 3 redações ≈ **US$ 0,234**. Saída está no teto de tokens, então o real tende a ser menor; o valor real vem do ledger do gateway. A evidência do Senado (7.754 caracteres) pesa ~2× a da Câmara na entrada.
6. **Gateway, ZDR e ledger.** Chamada real passa somente por `createModelopsTransport` (gateway da Frente 05): exige a flag `modelosHabilitados`, política de retenção zero (ZDR) para provedores que recebem texto de fonte, teto de gasto e ledger persistente. Nada disso foi exercitado aqui; o ensaio usou transporte simulado.
7. **Latência e retries.** Cinco chamadas em série por matéria, sem tempo real medido. Definir timeout por estágio e política de retry com backoff antes de agendar.
8. **Limites das fontes.** A Câmara devolveu 429 com poucas requisições; a coleta real deve seguir `maxRequestsPerHour`, respeitar Retry-After e rodar em horário espaçado (não em rajada). Sem `Crawl-delay` em nenhum dos dois robots.
9. **Extração.** Duas páginas foram bem extraídas; é uma amostra pequena. Um relatório de qualidade de extração (tamanho mínimo, ruído) deve acompanhar as primeiras rodadas reais.
10. **Flags.** Para rodar de verdade: `editorialCollector`, `editorialPipeline`, `modelosHabilitados` (+ `publicacaoPortal` somente após homologação). Hoje todas desligadas por padrão; `publicacaoAutonoma` segue desligada.
11. **Marcador SIMULADO.** A guarda `simulated_content` não atrapalha texto real, mas qualquer matéria real que contenha a palavra "SIMULADO" em caixa alta será recusada (ex.: matéria sobre um simulado de prova). Se isso virar problema, trocar por um campo explícito no rascunho em vez de busca no texto.
12. **Rótulo de IA e revisão humana.** Aprovação do gate ≠ publicação: o recibo é do portal; a flag de rotulagem de IA e a homologação por QA/PM continuam necessárias (não feitas por esta Frente).

## Não verificado

- Funcionamento com qualquer modelo real, qualidade editorial, latência e custo reais.
- Reuso permitido além do que o dossiê de termos registra (não é parecer jurídico).
- Outras páginas dessas fontes além das duas coletadas.
