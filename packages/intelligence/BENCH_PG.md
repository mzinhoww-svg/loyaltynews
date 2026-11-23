# Medição da ADR-009 no PostgreSQL real (staging), em schema descartável

Critério (ADR-009): **p95 ≤ 300 ms com 100 mil arestas** nas consultas de grafo (`neighbors`, `shortestPath`). Hoje só há medição em PGlite (~425 ms), que **não vale** para o PostgreSQL da Vertra. Código: `src/bench-pg.ts` (lógica, testada em PGlite: `src/tests/bench-pg.test.ts`) e `scripts/bench-pg.ts` (ponto de entrada).

## O que o script faz (e garante)
1. Exige `APP_ENV=staging` e as variáveis do script de credenciais; mostra só **nomes** de variáveis ausentes; nunca imprime URL, usuário, senha ou PEM.
2. Cria **somente** o schema `ln_bench_<AAAAMMDD>` (nome validado por regex; `intelligence` e `public` são recusados), marcado com `COMMENT 'ln-bench:<data>'`. Se o schema já existir: **recusa** e não altera nada; só apaga um schema anterior **com a marca** e com `--replace`.
3. Aplica a **migração oficial** `packages/db/drizzle/0006_intelligence.sql` com o nome do schema trocado; carrega dados **sintéticos** (MOCK) determinísticos: ~20 mil organizações, 15 mil pessoas, ~100 mil arestas (`--scale` reduz).
4. Mede as **mesmas consultas do produto** (60 por série + 5 de aquecimento): `neighbors` de organização, `neighbors` de pessoa e `shortestPath` até 3 saltos; mostra p50/p95/p99/máx, e `EXPLAIN (ANALYZE, BUFFERS)` de cada uma (planos de dados sintéticos).
5. **`DROP SCHEMA … CASCADE` no fim, inclusive em erro e em SIGINT/SIGTERM**, e confere em `pg_namespace` (`schema_dropped: true`; se sobrar, exit 1). Tudo (inclusive tabelas auxiliares) fica dentro do schema; nenhuma tabela temporária fora dele. Não toca em nenhum outro schema.
6. `statement_timeout` de 180 s e `lock_timeout` de 5 s na sessão. Tamanho esperado do schema: dezenas a poucas centenas de MB (o staging tem 1 GB): o relatório traz `dataset.size_mb`.

## Comandos (o PM roda; o agente de dados não recebe a credencial)
```
# 0) compilar (sem credenciais)
cd C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence
npx esbuild packages/intelligence/scripts/bench-pg.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/ln-intelligence/bench-pg.mjs

# 1) FUMAÇA (1/50 do tamanho; segundos; confirma permissão, criação e DROP): esperado "schema_dropped": true, meets_criterion: null
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/bench-pg.mjs --migration C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/db/drizzle/0006_intelligence.sql --scale 0.02

# 2) MEDIÇÃO COMPLETA (~100 mil arestas; minutos). O relatório vai para o arquivo e para a tela
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/bench-pg.mjs --migration C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/db/drizzle/0006_intelligence.sql --out C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/bench/results/pg-staging.json
```
Se uma execução anterior foi interrompida e deixou `ln_bench_<data>` (com a marca do script), repita com `--replace`. Qualquer outro schema com esse nome **não** é apagado (erro `bench_schema_existe`).

## Como ler o resultado
- `meets_criterion: true|false` só existe com ≥ 100 mil arestas; com a fumaça vem `null` (não vale como medição).
- `worst_p95_ms` é o pior p95 entre as três séries; o critério é ≤ 300. `explain` traz os planos (procure `Seq Scan` em tabelas grandes ou `Sort`/`Recursive Union` caros).
- Medição **concorrente com outras cargas** do staging (1 GB, instância pequena): prefira janela calma e repetir; o relatório traz versão e parâmetros do servidor (`shared_buffers`, `work_mem`…) para comparar. Isto **não** mede produção.

## Se falhar
- `falha: Error (42501) — sem permissão para criar schema`: a credencial do app web não tem `CREATE` no banco. Peça ao DevOps (não há como contornar; o script não escala privilégio).
- `falha: … (28xxx/08xxx)`: autenticação/conexão; **não repetir em laço**; chamar o DevOps.
- O script nunca ecoa a mensagem do driver (pode ter host/usuário): só nome e código.
