# Trocar a memória do web só durante o build (2048 MB no build, 512 MB em regime)

> **24/11/2026:** o build do web passou a morrer com `Killed` (137) a 880 e 1024 MB e construiu a 2048 (o ambiente de build é 2× a RAM, máx. 4096). Onde este documento disser 880, vale **2048** (`memoria-build.mjs` já usa 2048 como padrão; `--build 880` só para reproduzir o roteiro antigo). Com o staging em 5248 o pico é 6784 de 8192. **Na produção em regime (7552) o pico seria 9088: NÃO cabe**: o plano de memória da produção precisa mudar antes do primeiro build (ver `releases/producao/PREPARACAO-PRODUCAO-v4.md`).

Vale para `ln-staging-web` (529657d6) e `ln-prod-web`. O web roda com 80–160 MB; só o BUILD precisa de mais (ambiente de build = 2× a RAM do app; o build leve passou com 880). O ambiente de build não conta no pool; contam a RAM dos apps e dos bancos, parados também. Regime e conta: `releases/producao/PEDIDO-PROVISIONAMENTO-PRODUCAO-v3.md` §1 (7552 de 8192; pico de um rebuild 7920).

Quem executa na Vertra é o PM. `infra/scripts/memoria-build.mjs` **não fala com a Vertra**: lê o JSON do `get_profile`, diz se pode subir e confere cada fase. Não imprime e-mail, nome nem segredo. Exit 0 = siga; 1 = pare (motivos em `problemas`); 2 = uso errado.

## Cada deploy do web (8 passos)
Troque `<ID>` pelo app (`529657d6-8f8b-406c-af19-7beccf59fd7d` ou o de produção) e `P` pelo JSON salvo do `get_profile` (fora do repositório).
1. `get_profile` → salve em `P`. `node infra/scripts/memoria-build.mjs plano --profile P --app <ID> --pacote <pasta do pacote>`: imprime os passos com o `plan.memory.used` esperado depois de cada um. Se `ok:false`, **não suba**.
2. `update_app_config { id: <ID>, memory: 2048 }`.
3. `get_profile` → `P`; `node infra/scripts/memoria-build.mjs conferir --profile P --app <ID> --fase durante`.
4. `get_file_tree` + `node infra/scripts/arquivos-orfaos.mjs --tree <arquivo> --pasta <pacote>`; apague as sobras (`delete_file`).
5. `deploy_app { id: <ID>, path: <pacote>, restart: true, message: <commit curto> }`.
6. `wait_for_app`; release `active` (source `upload`) em `list_releases`; se falhou, `get_release_log` do release (o `get_logs` não mostra).
7. `update_app_config { id: <ID>, memory: 512 }` **sempre**, inclusive quando o build falhou ou a Vertra reverteu o release (o rollback não devolve a memória).
8. `get_profile` → `P`; `node infra/scripts/memoria-build.mjs conferir --profile P --app <ID> --fase depois`; `/api/health` com o commit novo; healthcheck oficial.
O guarda recusa: dois webs do LN acima do regime ao mesmo tempo, pico com menos de 128 MB livres (`--margem`), web fora do regime no início, e `get_profile` que não fecha (soma dos apps e bancos diferente de `plan.memory.used`: leitura velha). Para outro tamanho: `--build` e `--regime`.

## Redução inicial do staging (passos 1 e 2 do pedido da produção; reversíveis)
- **Worker de staging 256 → 128:** conferido em `get_metrics` (23/11, 14h–14h20): RAM real 30–33 MB (pico 44 MB no arranque), sem fila ainda. 128 MB dá folga de ~4×; o ambiente de build do worker é o mínimo de 1024 MB de qualquer jeito. Revise `get_metrics` quando entrarem os handlers (a Intelligence e a ingestão); acima de ~90 MB sustentados, volte a 192/256.
- **Web de staging 880 → 512** só com `get_profile` fechando e o web em regime; no próximo deploy ele sobe a 880 pelo roteiro acima.
- Depois: `get_profile` esperado **5248** (5744 − 128 − 368).
Zero downtime: o web de staging está em `auto` (ativo). Não está verificado se isso dobra a RAM durante o deploy; no próximo deploy compare `plan.memory.used` no passo 6 com o esperado pelo plano e, se subir, `update_app_config { zero_downtime: "off" }`.
