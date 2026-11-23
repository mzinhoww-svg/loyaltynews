# Ensaio do piloto em dry-run (5 fontes do checklist, 10 matérias simuladas)

> Gerado por `packages/editorial/src/tests/piloto-dryrun.test.ts` (com `LN_WRITE_DRYRUN=1`). Dados em `docs/piloto-dryrun.data.json`. **Tudo é simulado**: nenhuma rede, nenhum modelo, nenhuma habilitação real, nenhuma publicação.

## Resultado

- **10 matérias** simuladas (2 por fonte): **5 aprovadas** pelos gates e **5 bloqueadas** de propósito; **10/10** fizeram exatamente o que o cenário previa (status, bloqueio e achado do gate).
- **Chamadas a modelo real: 0.** Chamadas ao "modelo" simulado (saída roteirizada, custo 0): 42 (triage 10, context 10, draft 10, factcheck 7, review 5). Prompt fixado: `editorial-0.3`.
- **Publicadas: 0.** Os 7 rascunhos gravados foram recusados pela publicação com `simulated_content` (o texto leva a marca SIMULADO).
- Coletor: 5 fontes coletadas, **2 evidências cada**; menor intervalo medido entre requisições ao mesmo host: **3 s** (exigido: 3 s). URLs proibidas requisitadas: 0.

## O que foi simulado e o que não foi

| Parte | No ensaio |
|---|---|
| Fontes | Cadastro **real** das 5 fontes (host, prefixo, feed/sitemap, limites), com páginas e listagens **fictícias** servidas por um fetcher sem rede. Os hosts reais só servem de rótulo; nenhuma matéria real é lida. |
| Habilitação | SIMULADA em memória (atores de ensaio); nenhuma fonte foi habilitada no cadastro real nem no banco. A habilitação humana de verdade (Studio, `docs/piloto-checklist-habilitacao.md`) continua pendente. |
| Coletor | **Real**: elegibilidade, robots.txt, anti-SSRF (resolvedor falso), host/prefixo, espaçamento de 3 s por host (relógio simulado), sitemap com prefixo verificado, dedupe. |
| Modelo | **Nenhum.** `RehearsalGateway` devolve saídas roteirizadas (provedores `simulado-*`), sem rede e com custo 0. |
| Gates, pipeline, store, publicação | **Reais** (os da Fábrica): 13 verificações determinísticas, checagem em provedor distinto, revisão, `applyPublication`. Store em memória. |
| Linha do piloto | Um `PilotRowSink` em memória recebe os patches que a planilha receberia (`output_valid`, `gate_verdict`, `cross_provider_ok`). |

## Fontes

| Fonte | Como é coletada | Evidências | Recusadas pelo coletor |
|---|---|---|---|
| `abemf` | ABEMF (feed) | 2 | — |
| `livelo-imprensa` | Livelo imprensa (sitemap /imprensa/) | 2 | — |
| `senado-noticias` | Agência Senado (feed RSS) | 2 | `robots_disallow` (/noticias/interno/ensaio-fora-do-robots) |
| `camara-noticias` | Câmara Notícias (feed RSS) | 2 | — |
| `abrarec` | ABRAREC (feed) | 2 | — |

No Senado havia um item do feed em área que o `robots.txt` do ensaio proíbe: o coletor o recusou **sem requisitá-lo**. No Livelo, uma URL de produto fora de `/imprensa/` estava no sitemap e **não foi coletada**.

| Host | Requisições | Menor intervalo entre requisições |
|---|---|---|
| abrarec.com.br | 4 | 3 s |
| web.abemf.com.br | 4 | 3 s |
| www.camara.leg.br | 4 | 3 s |
| www.livelo.com.br | 4 | 3 s |
| www12.senado.leg.br | 4 | 3 s |

## As 10 matérias simuladas e os gates

| # | Fonte | Cenário (o que o ensaio quer provar) | Esperado | Resultado | Bloqueio | Gate que barrou | Conforme |
|---|---|---|---|---|---|---|---|
| a1 | `senado-noticias` | limpa | aprovado | **aprovado** | — | — | ✓ |
| a2 | `senado-noticias` | copia_literal | bloqueado (`copy_literal`) | **bloqueado** | `copy_literal` | copy_literal | ✓ |
| a3 | `camara-noticias` | limpa | aprovado | **aprovado** | — | — | ✓ |
| a4 | `camara-noticias` | numero_sem_fonte | bloqueado (`unsupported_metric`) | **bloqueado** | `unsupported_claim` | afirmacoes_nas_evidencias | ✓ |
| a5 | `abemf` | limpa | aprovado | **aprovado** | — | — | ✓ |
| a6 | `abemf` | tom_exclamacao | bloqueado (`tone_title_exclamation`) | **bloqueado** | `unsupported_claim` | tom_lint | ✓ |
| a7 | `livelo-imprensa` | limpa | aprovado | **aprovado** | — | — | ✓ |
| a8 | `livelo-imprensa` | checagem_reprova | bloqueado (`unsupported_claim`) | **bloqueado** | `unsupported_claim` | checagem_de_fatos (veredito do checador) | ✓ |
| a9 | `abrarec` | limpa | aprovado | **aprovado** | — | — | ✓ |
| a10 | `abrarec` | mesmo_provedor | bloqueado (`same_provider`) | **bloqueado** | `cross_provider_check_failed` | checagem_em_provedor_distinto | ✓ |

Achados que cada gate devolveu nas bloqueadas (texto do gate real):

- **a2** (triage → context → draft): copy_literal: 29 palavras consecutivas idênticas à fonte senado-noticias · copy_literal: 78% dos 5-gramas coincidem com a fonte senado-noticias
- **a4** (triage → context → draft): unsupported_metric: número "35" não consta na evidência · unsupported_metric: número "35" no texto não consta nas evidências
- **a6** (triage → context → draft): tone_title_exclamation: ponto de exclamação no título
- **a8** (triage → context → draft → factcheck): unsupported_claim: veredito fail
- **a10** (triage → context → draft → factcheck): same_provider: checagem veio do mesmo provedor do redator (simulado-redator)

### Gates nas matérias aprovadas

| Gate | a1 | a3 | a5 | a7 | a9 |
|---|---|---|---|---|---|
| assinatura | ✓ | ✓ | ✓ | ✓ | ✓ |
| sem_apuracao_inventada | ✓ | ✓ | ✓ | ✓ | ✓ |
| evidencia_confiavel | ✓ | ✓ | ✓ | ✓ | ✓ |
| afirmacoes_nas_evidencias | ✓ | ✓ | ✓ | ✓ | ✓ |
| corpo_ancorado | ✓ | ✓ | ✓ | ✓ | ✓ |
| copy_literal | ✓ | ✓ | ✓ | ✓ | ✓ |
| ancora_primaria | ✓ | ✓ | ✓ | ✓ | ✓ |
| autoral | ✓ | ✓ | ✓ | ✓ | ✓ |
| atribuicao_fontes | ✓ | ✓ | ✓ | ✓ | ✓ |
| imagem_direitos | ✓ | ✓ | ✓ | ✓ | ✓ |
| publicavel_slug_resumo | ✓ | ✓ | ✓ | ✓ | ✓ |
| avisos | ✓ | ✓ | ✓ | ✓ | ✓ |
| tom_lint | ✓ | ✓ | ✓ | ✓ | ✓ |

Checagem em provedor distinto nas aprovadas: sim, todas (`simulado-checador` ≠ `simulado-redator`).

## Linha do piloto (planilha) por matéria

| # | `output_valid` | `gate_verdict` na redação | `gate_verdict` na checagem | `gate_verdict` na revisão | `cross_provider_ok` |
|---|---|---|---|---|---|
| a1 | 5/5 válidas | approved | approved | approved | true / true |
| a2 | 3/3 válidas | blocked (copy_literal) | — | — | — |
| a3 | 5/5 válidas | approved | approved | approved | true / true |
| a4 | 3/3 válidas | blocked (unsupported_claim) | — | — | — |
| a5 | 5/5 válidas | approved | approved | approved | true / true |
| a6 | 3/3 válidas | blocked (unsupported_claim) | — | — | — |
| a7 | 5/5 válidas | approved | approved | approved | true / true |
| a8 | 4/4 válidas | approved | blocked | — | true |
| a9 | 5/5 válidas | approved | approved | approved | true / true |
| a10 | 4/4 válidas | approved | blocked | — | false |

## O que o ensaio mostrou (para o PM e o AgentOps)

1. **Redação barrada por gate NÃO é refeita** (corrigido nesta rodada). Cópia literal, número fora da fonte, tom, resumo etc. são barreiras determinísticas: a matéria bloqueia na 1ª redação, com 1 chamada de redação (antes eram 3 por matéria barrada, `max_attempts`). Nova tentativa fica só para falha transitória (fila/gateway).
2. **O gate da redação grava `gate_verdict` e `gate_reasons` na planilha** (corrigido nesta rodada): matéria barrada na redação sai com `blocked` e os motivos na linha da tarefa de redação; aprovada, com `approved` e motivos vazios. A checagem e a revisão seguem como antes.
3. **Rótulo do bloqueio de tom.** O tom lint bloqueante (a6) sai com o código `unsupported_claim` (padrão de `FINDING_TO_BLOCKER`; não existe código próprio de tom); o achado `tone_title_exclamation` identifica o motivo. Não mudei isso (mexe no contrato dos códigos de bloqueio); fica para decisão do PM.
4. **Fonte com paywall `unknown` (Livelo)** só coleta depois que a revisão humana marca `paywall = none`; o ensaio simula essa revisão em memória.

## O que este ensaio NÃO prova

- Que as 5 fontes respondem hoje como no cadastro (a coleta real exige a habilitação humana e as flags; a Câmara responde 429 em rajada: 1 rodada por dia).
- A qualidade do texto de um modelo real, nem as taxas de `output_valid` e de `unsupported_facts` (isso é medição do piloto, com leitura humana).
- O banco real: o ensaio usa o store em memória; o store PostgreSQL tem contrato próprio, testado em PGlite e em PostgreSQL 18.

## Como reproduzir

```
npx vitest run packages/editorial/src/tests/piloto-dryrun.test.ts                       # confere o ensaio e compara com os arquivos desta pasta
LN_WRITE_DRYRUN=1 npx vitest run packages/editorial/src/tests/piloto-dryrun.test.ts     # regrava piloto-dryrun.md e piloto-dryrun.data.json
```
