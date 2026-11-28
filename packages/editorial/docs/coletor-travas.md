# Travas do coletor dos workers (28/11/2026)

Base: decisão do PM sobre os pareceres 55 e 59 da Security (`fast-track\decisoes\decisao-pm-fontes-coletor-20261128.md`, DP-69). Os três pontos
valem para todo coletor construído em `apps/workers` (coleta contínua, fábrica avulsa e pauta autoral), por `registeredCollectorGuards(store)`.

| Trava | Onde | O que faz |
|---|---|---|
| Fontes permitidas | `collector/allowlist.ts` | Só `abemf`, `camara-noticias` e `procon-sp`, com o host. Outra fonte habilitada no Studio não gera requisição (`source_not_allowed`). Mudar a lista é commit revisado com o id da decisão. |
| Teto por hora | `factory/read-budget.ts` (`StoreHostBudget`), `EditorialStore.reserveRead` | `maxRequestsPerHour` da fonte (6 nas três), contado no banco por host: conta robots.txt, feed, páginas e redirecionamentos, entre rodadas, reinícios e instâncias. No PostgreSQL, contagem e gravação numa transação com `pg_advisory_xact_lock`. Contador fora do ar = não requisita. Uma linha `collector.host_read` na trilha por requisição aprovada. |
| Autoria da Câmara | `collector/author.ts`, `rules.ts` (`buildAttribution`) | Lê "Reportagem - Nome" no HTML (inclusive dentro de comentário) e grava `Evidence.author`. O bloco "Fontes:" sai como "Agência Câmara (Câmara dos Deputados), reportagem de Nome: endereço". Sem nome válido, só a assinatura da fonte. |

## Efeitos e limites

- Com 6 por hora, uma rodada de feed lê robots.txt, o feed e até 4 matérias; o resto fica `rate_limited` e a fonte para até a janela abrir.
- As demais fontes do cadastro (inclusive as usadas por pauta autoral e pelo piloto) deixam de ser lidas pelos workers.
- O intervalo entre pedidos (Crawl-delay e 3 s) continua por instância.
- "Só feed" (não abrir a página) NÃO foi implementado: aguarda decisão do proprietário (DP-58 e DP-59).
- A lista "Fontes e referências" do portal mostra o nome do cadastro; a assinatura e o autor aparecem no bloco "Fontes:" do corpo da matéria.
- Testado com PostgreSQL embutido (PGlite), que atende um pedido por vez: a concorrência real entre duas conexões não foi exercitada.
