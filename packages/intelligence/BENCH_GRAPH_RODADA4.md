# Roteiro do Data — 4ª rodada da ADR-009: `bench-graph` DE DENTRO da rede da Vertra (preparado, NÃO executado)

Dono do roteiro: Data (Frente 08). **Nada deste arquivo foi executado pelo Data** (quem executa é o PM, com a chave de deploy; o Data só lê o relatório). Executar só com o OK do PM **e** do DevOps registrado na §1 (**registrados em 24/11/2026**) (cria um schema temporário `ln_bench_*` no banco do staging). Sem segredo neste arquivo. Base: int/019 `7fd57ac` (inclui `ft/intelligence` `0d8bc43`, homologado pelo QA 3). Complementa, sem substituir, o roteiro de operação do DevOps: `releases/staging/ROTEIRO-BENCH-GRAPH.md` (app descartável, `create_app`, variáveis, desmontagem). Este aqui cobre o que é do Data: **o que rodar, os limites, a limpeza e como ler o resultado**.

## 0. Para que serve
A ADR-009 pede p95 ≤ 300 ms com ~100 mil arestas. De **fora** da rede o p95 inclui ~125 ms de ida e volta por consulta (resultado real em `bench/results/pg-staging-single.json`: pior p95 412,8 ms, estimativa na mesma rede 288 ms; só estimativa). Esta rodada mede **de dentro** (SELECT 1 em poucos ms), que é o número que fecha o critério e decide consulta única × lote. O dado real hoje é pequeno (29 organizações, 40 pessoas): **o go-live não depende desta medição**; ela fecha o risco de escala.

## 1. Portões e registro do OK (preencher ANTES de rodar; sem OK registrado, não roda)
| Portão | Quem | Estado | Registro (data/hora, onde) |
|---|---|---|---|
| OK para criar o schema `ln_bench_*` no banco de staging | PM | **OK registrado** (24/11/2026, int/019 no ar no staging; limites: schema temporário `ln_bench_*`, limpeza com `--replace`, sem gasto novo; o PM executa todas as escritas na Vertra) | mensagem do PM ao Data e ao DevOps (79ff90ec), sobre o `120e7d5` aprovado pelo QA 3 |
| OK de capacidade/operação (app descartável 384 MB, sem custo novo, sem mexer em web/worker/banco) | DevOps | **OK registrado** (24/11/2026; regra: **não sobrepor a um deploy do web**, pois o build do web usa 2048 MB; apagar o descartável antes de qualquer deploy) | mensagem do DevOps (19863c6e) e `releases/staging/ROTEIRO-BENCH-GRAPH.md` §2b; pacote refeito sobre a int/019 `eac6be5` (a CLI faz parte dela), pasta `releases/staging/bench-graph-eac6be5/` |
| Código da CLI homologado | QA 3 | feito (`ft-intelligence.md`: 87ae52e/8d9bd4b; 0d8bc43 sem mudança na CLI) | `r0-preparacao/qa/ft-intelligence.md` |
| Permissão `CREATE SCHEMA` da credencial do app | DevOps/PM | **desconhecida** (a fumaça descobre em segundos; sem permissão a CLI sai com `42501`, não escala privilégio) | _(vazio)_ |
| Staging na int/019 sem outra operação de banco em curso (carga, migração) | PM | **pendente** | _(vazio)_ |

## 2. Comandos (a CLI já existe; nada a codificar)
Build (sem credenciais), na raiz do pacote do DevOps: `node infra/scripts/guard-env.mjs && npm run build -w apps/workers && npm run build:bench-graph -w @ln/workers` → `apps/workers/dist/bench-graph.js` (migração oficial 0006 embutida como texto).

Execução, no ambiente do worker de staging (mesmas variáveis do web/worker; não precisa de Redis), **em dois passos, o 2º só se o 1º sair com 0**:
1. **Fumaça** (segundos; não vale como medição, < 100 mil arestas ⇒ `meets_criterion: null`):
   `node apps/workers/dist/bench-graph.js --confirm-staging-bench --scale 0.02`
2. **Medição que decide** (~115 mil arestas, ~50 MB, alguns minutos; sem `--scale`):
   `node apps/workers/dist/bench-graph.js --confirm-staging-bench --with-reference --with-indexes`

Opções: `--with-reference` mede também o lote (`reference_batched`) e o recursivo no mesmo servidor; `--with-indexes` mede os índices cobrindo da 0030 (**descartada**: só reabre com a regra da §5); `--scale` (0 < x ≤ 1); `--schema ln_bench_AAAAMMDD[_sufixo]`; `--replace` (§4). Sem `--schema`, usa a data de hoje em UTC.

## 3. Limites (todos antes de abrir conexão; recusa = saída 2, sem tocar em nada)
- **L1** `APP_ENV` exatamente `staging` (produção, vazio ou outro valor recusa).
- **L2** `--confirm-staging-bench` obrigatório (nunca roda por engano nem por reinício do processo; por isso o `start` do DevOps termina em `sleep 86400`).
- **L3** `DATABASE_URL` tem de ser o banco de staging registrado em `infra/vertra/bindings.json` (host e nome, embutido no build); outro banco recusa sem repetir a URL.
- **L4** a saída nunca traz URL, usuário, senha nem PEM; só o relatório (tempos, contagens, versão, planos de dados sintéticos) ou tipo/código do erro. O ouvinte de `'error'` do cliente é registrado antes do `connect()` (R1 do incidente de 23/11); a int/015 acrescentou um segundo ouvinte em `bench-graph.main.ts` (C1 estático), por isso uma queda de conexão pode sair em **duas linhas** de erro saneadas: normal.
- **L5** sem rota HTTP, sem processo novo além do descartável, sem custo.
- **Só toca no schema `ln_bench_<data>` que ELE cria** (dados sintéticos): nunca lê nem altera `intelligence` ou outro schema; apaga o schema no fim, em erro e em SIGINT/SIGTERM e confere em `pg_namespace` (`schema_dropped` no relatório). Se o schema já existir, recusa (nunca apaga o que não criou).

## 4. Limpeza e reexecução (`--replace`)
1. **Sempre conferir ao fim** (só leitura, pelo caminho do PM com credenciais): `select nspname from pg_namespace where nspname like 'ln_bench_%'` → **0 linhas**; e as contagens do `intelligence` iguais às de antes (`check` da carga: organizações 29, relações 36, pessoas 40, cargos 40).
2. Se **sobrou** um `ln_bench_*` (conexão caiu, `schema_dropped: false`): rodar de novo **com `--replace`** (a CLI só apaga o schema cujo comentário começa por `ln-bench:`, a marca do script; se não tiver a marca, recusa). Não apagar à mão sem decisão do PM.
3. Reexecutar no mesmo dia depois de uma falha também exige `--replace` (o nome é por data). Outro nome: `--schema ln_bench_AAAAMMDD_a`.
4. Depois da medição: `delete_app` do descartável (DevOps §3.F do roteiro dele); não reiniciar o app (rodaria tudo de novo).

## 5. Leitura do resultado (script homologado pelo QA 3: `interpret-bench-graph`)
Salvar o texto **inteiro** do `get_logs` em `C:\Users\mazin\OpenBot\Shared\loyalty-news\releases\staging\bench-graph-relatorio-AAAAMMDD.log` assim que cada relatório aparecer (o log da Vertra é zerado a cada reinício; a pasta `releases\staging` fica no diretório compartilhado, FORA do repositório do código, por isso o caminho absoluto). **O `get_logs` mistura stdout e stderr** (a CLI imprime o JSON no stdout e o progresso `[bench] …` no stderr), então não dá para separar na origem: o interpretador **aceita o log misturado** e extrai sozinho o relatório (objeto JSON com `dataset`/`results`; linhas de progresso, objetos de log e chaves soltas são ignorados; se o log tiver a **fumaça e a medição**, vale o último relatório com ≥ 100 mil arestas, e um log só com a fumaça dá saída 2, "fumaça, não vale"). Se o `get_logs` colocar prefixo (data/hora) em cada linha e o JSON não for reconhecido, o script sai com 2 e "entrada ilegível": nesse caso mande o texto bruto ao Data. Depois, **do computador do PM** (o script só lê o arquivo; não abre rede nem banco):

`node packages/intelligence/scripts/interpret-bench-graph.mjs C:\Users\mazin\OpenBot\Shared\loyalty-news\releases\staging\bench-graph-relatorio-AAAAMMDD.log` (acrescente `--json` para a saída de máquina; `--real-edges N` e `--max-degree N` se houver esses números)

| Saída | Veredito | O que fazer |
|---|---|---|
| **0** | **Cumpre** (de dentro da rede, pior p95 ≤ 300 ms) | Fechar a ADR-009 no `GRAPH_PERF.md`. Se o script indicar `lote`, o Data troca o produto para `neighborsBatched`/`shortestPathBatched` (commit pequeno, QA 3); se indicar `unica`, nada muda (já é a do produto). |
| **1** | **Não cumpre** (de dentro) | Ver `explain`/`server_side` do relatório. Caminho: adjacência materializada (**não** a 0030). Exige migração do `@ln/db` e decisão de consistência: **fora antes do go-live** (sem migração nova); registrar como risco aceito de escala (o dado real é pequeno) e abrir a decisão para depois. |
| **2** | Medição inválida (fumaça, schema sobrou, não sintético, série ausente) | Não decide nada. Corrigir a causa (a mensagem diz qual), limpar (§4) e refazer. |
| **3** | Inconclusiva (de fora da rede, `SELECT 1` > 20 ms ou origem sem "dentro da rede") | Não vale; refazer de dentro. Nunca aceitar "cumpre" por estimativa. |

Sempre também: se `gatilhos_adjacencia` vier não vazio (p95 de organização > 250 ms na mesma rede), registrar mesmo cumprindo o critério. A 0030 só reabre com ganho ≥ 20 % no pior p95 e nenhuma série mais de 10 % pior (o script diz). O item (d) do gatilho (EXPLAIN com `graph_edge` dominando) é leitura humana do `explain.neighbors_org`.

## 6. O que NÃO fazer
Não rodar sem o OK da §1; não usar `--schema`/`--replace` sem necessidade; não apontar para banco que não seja o de staging (L3 recusa); não deixar o app descartável vivo; não copiar variáveis além das 4 do banco; não rodar em produção (L1); não colar o relatório com segredo (ele não traz, mas confira antes de publicar); não comparar com o resultado de fora para "cumprir".

## 7. Falhas conhecidas e o que significam
| Sintoma | Causa provável | Ação |
|---|---|---|
| saída 2, `medição recusada: APP_ENV=…` | ambiente errado | corrigir `APP_ENV=staging` no app descartável |
| saída 2, `falta --confirm-staging-bench` | argumento ausente | incluir o argumento |
| saída 2, `DATABASE_URL NÃO aponta para o banco de staging` | variável errada | copiar as 4 variáveis do banco do staging (lista fechada do DevOps) |
| saída 1, `falha: error (42501) — sem permissão para criar schema` | credencial sem `CREATE` no banco | pedir ao DevOps; a CLI não escala privilégio; sem schema para limpar |
| saída 1, `bench_schema_existe` | sobra de execução anterior | §4 com `--replace` |
| saída 1, `ECONNRESET`/queda de conexão | rede ou reinício | conferir §4.1; `--replace` |
| OOM com 384 MB | processo morto | `update_app_config memory 512` (DevOps), refazer com `--replace` |
