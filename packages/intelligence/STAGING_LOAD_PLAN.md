# Plano de carga do Entity Intelligence no banco de staging

Estado: **plano pronto; nada foi carregado** (não existe banco de staging ainda). Código testado só em PGlite.
Dono: Frente 08 (LN Data Engineer). Execução: DevOps, com o banco e a `DATABASE_URL` do staging. Sem Vertra de escrita por este plano.

## O que é carregado (e o que não é)
Conjunto `data/seed.public.v1.json` (formato `intelligence-seed/1`), **piloto**: 5 organizações e 2 relações, cada uma com a **citação literal** da página pública oficial que a sustenta.

| Organização | Fonte oficial (HTTPS) |
|---|---|
| Livelo | livelo.com.br/imprensa |
| Bradesco | banco.bradesco/cartoes/hotsitefidelidade/ |
| LATAM Pass (programa) e LATAM | latampass.latam.com/br/pt/conheca-latampass |
| ABEMF (associação) | abemf.com.br |

Relações (tipo `other`, certeza `declared`): Bradesco → Livelo ("A Livelo é mais uma empresa Bradesco…"), LATAM → LATAM Pass ("LATAM Pass é o programa de fidelidade da LATAM").

**Fica de fora, de propósito:** pessoas e cargos (flag `intelligencePessoas` desligada; base legal/controlador J-01 abertos), Moves (nascem da ingestão contínua e da revisão, não de carga inicial), organogramas, qualquer vínculo inferido ("sem vínculos presumidos": o formato nem tem campo para certeza). **Cobertura é pequena**: das fontes tentadas, só estas 4 páginas têm texto estático verificável (outras dependem de JavaScript, deram 404 ou não trazem a frase); ampliar exige novas fontes (seção "Ampliar").

## Regras que o código impõe (testadas)
- Sem relatório de verificação, ou de outro conjunto, **nada entra**. Registro cuja citação não foi achada na página, fonte que não respondeu HTTP 200 ou cuja URL difere da verificada é **recusado** com o motivo; as relações que dependem dele também.
- Evidência por registro: URL pública, nome da fonte, `retrieved_at` = data da verificação, `content_hash` = sha256 do texto da página, trecho (a citação) e `is_mock=false`. Validação (`validated_at`) = data da verificação.
- A vigência da relação começa na **data da verificação** (a fonte não declara a data do fato; não inventamos).
- Idempotente: repetir não duplica; relação existente só renova `validated_at` e a evidência.
- Transação única: falha no meio desfaz tudo. Desfazer depois da carga: manifesto + `rollbackSeed` (mantém organização que já tenha outro uso).

## Pré-condições
1. Banco de staging PostgreSQL 18 criado pelo DevOps; `DATABASE_URL` só no ambiente do executor (nunca em arquivo, log ou chat).
2. Migrações do produto aplicadas com `npm run migrate -w @ln/db` — inclui `0006_intelligence` (schema `intelligence`). Conferir: `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'intelligence';` = 14 tabelas (13 do modelo + a de tombstones; views não contam).
3. Flags: `intelligencePessoas` **desligada** (padrão). Esta carga não toca pessoas e funciona assim.
4. Backup/snapshot do staging antes da carga (regra comum do DevOps).

## Passo a passo
1. **Reverificar as fontes** (as páginas mudam; a verificação envelhece): `node packages/intelligence/scripts/verify-dataset.mjs packages/intelligence/data/seed.public.v1.json` — respeita robots.txt, 1 requisição por URL, pausa entre elas. Se algum registro sair `FALHA`, ele será recusado na carga (não corrija a citação "de cabeça": confira a página e ajuste o conjunto).
2. **Compilar o carregador** (na raiz do monorepo):
   `npx esbuild packages/intelligence/scripts/load-seed.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/ln-intelligence/load-seed.mjs`
3. **Dry-run** (padrão, só leitura): `DATABASE_URL=… node node_modules/.cache/ln-intelligence/load-seed.mjs --dataset packages/intelligence/data/seed.public.v1.json --verification packages/intelligence/data/seed.public.v1.verification.json`
   Esperado no primeiro staging: `create: 7, exists: 0, rejected: 0`. Qualquer `rejected` ⇒ parar e investigar (exit code 1).
4. **Aplicar**: o mesmo comando com `--apply --manifest <caminho>/seed.public.v1.manifest.json`. Guardar o manifesto (é o que desfaz a carga).
5. **Conferir** (SQL de leitura):
   - `SELECT count(*) FROM intelligence.organization;` → 5 · `SELECT count(*) FROM intelligence.org_relation;` → 2
   - `SELECT count(*) FROM intelligence.person;` e `role_assignment`, `move` → 0
   - `SELECT x.certainty, e.source_url, e.retrieved_at, e.content_hash FROM intelligence.org_relation x JOIN intelligence.evidence e ON e.id = x.evidence_id;` → `declared`, URL https, data e hash preenchidos
   - Páginas públicas do portal: empresa Livelo mostra Bradesco como relação, com fonte e data de validação.
6. **Desfazer, se preciso**: `rollbackSeed(db, manifesto)` (função exportada de `@ln/intelligence`; ainda sem comando próprio) ou restaurar o snapshot do passo 4 das pré-condições.

## Ampliar (próximas cargas)
- Cada nova organização/relação = uma entrada em `sources` + `organizations`/`relations` com citação literal de página pública oficial (RI, imprensa, regulador, associação), depois `verify-dataset`, depois carga. Sem citação verificável, não entra.
- Priorizar páginas estáticas ou feeds oficiais; páginas que só renderizam com JavaScript ficam fora até haver coleta autorizada pelo Editorial (coletor com robots/termos aprovados).
- Pessoas e cargos: só depois do J-01 (parecer, controlador, processador), ligando `intelligencePessoas` por decisão registrada, e **somente** pelo contrato `role-observation/1` (nome, cargo, empresa de fonte pública; DP-11 P4). Moves aparecem da comparação entre observações e dependem de revisão antes de ir ao portal.
- Volume real: o critério de desempenho do grafo (ADR-009, p95 ≤ 300 ms com 100 mil arestas) segue **não verificado** no PostgreSQL de staging; medir ali (`EXPLAIN (ANALYZE, BUFFERS)`) antes de crescer.

## Não verificado
Execução no PostgreSQL 18 (só PGlite); carregador compilado contra um servidor real (`pg.Client`); o que os sites mudaram desde 23/11/2026; se os termos de uso dessas páginas permitem reutilização do trecho (o trecho é curto, com crédito e link; revisão jurídica da fonte é do Editorial/J-14).
