# Plano de carga do Entity Intelligence no banco de staging

Estado: **plano pronto; nada foi carregado** (não existe banco de staging ainda). Código testado só em PGlite.
Dono: Frente 08 (LN Data Engineer). Execução: DevOps, com o banco e a `DATABASE_URL` do staging. Sem Vertra de escrita por este plano.

## O que é carregado (e o que não é)
Conjunto `data/seed.public.v2.json` (formato `intelligence-seed/1`; supera o v1, que é subconjunto dele): **20 organizações e 20 relações declaradas**, cada registro com a **citação literal** de página pública oficial. `seed.public.v2.verification.json` é o relatório (40/40 citações encontradas, 6 fontes verificadas).

| Fonte (HTTPS) | Como foi lida | Gera |
|---|---|---|
| web.abemf.com.br/associados/ — lista oficial "Empresas Associadas" | HTTP | 12 associadas (Azul, Bravium, Clube Giro, DOTZ, Esfera, Juntos Somos +, LATAM Pass, Livelo, Mastercard, Orbia, Smiles, Stix) + a ABEMF; 12 relações "associada de" (tipo `other`; o contexto "Empresas Associadas — as empresas que fazem parte da ABEMF" vai junto da citação) |
| dotz.com.br/home (página só renderiza com JavaScript) | **navegador do OpenBot**, captura em `data/captures/dotz-home.json` com sha256 calculado no navegador e recalculado pelo verificador | Banco do Brasil e Banco BV; relações `partner_of` Dotz→cada banco ("compras com cartões do Banco do Brasil e Banco BV") |
| livelo.com.br/imprensa (manchetes da própria Livelo) | HTTP | Uber, BRB, Km de Vantagens; relações `partner_of` Livelo→Stix/Uber/BRB/Km de Vantagens ("…firmam/expandem parceria…") |
| banco.bradesco/cartoes/hotsitefidelidade/ , latampass.latam.com/br/pt/conheca-latampass , abemf.com.br | HTTP | herdados do v1: Livelo, Bradesco, LATAM, LATAM Pass; Bradesco→Livelo e LATAM→LATAM Pass |

**Fica de fora, de propósito:** pessoas e cargos (flag `intelligencePessoas` desligada; base legal/controlador J-01 abertos), Moves (nascem da ingestão contínua e da revisão), organogramas, qualquer vínculo inferido ("sem vínculos presumidos": o formato nem tem campo para certeza). O tipo da organização é `other` quando a fonte não diz o que a entidade é (só bancos e as marcas que a página descreve como empresa/programa têm tipo próprio). **Limites da cobertura:** "associada da ABEMF" e "parceria" são o que as páginas afirmam, não participação societária; relações de controle (ex.: Smiles–GOL, Esfera–Santander) **não** entraram porque nenhuma página consultada as afirma em texto (a do Esfera só mostra o rodapé legal; o RI da Azul e da GOL não trazem a frase).

## Regras que o código impõe (testadas)
- Sem relatório de verificação, ou de outro conjunto, **nada entra**. Registro cuja citação não foi achada na página, fonte que não respondeu HTTP 200 ou cuja URL difere da verificada é **recusado** com o motivo; as relações que dependem dele também.
- Evidência por registro: URL pública, nome da fonte, `retrieved_at` = data da verificação, `content_hash` = sha256 do texto da página, trecho (a citação) e `is_mock=false`. Validação (`validated_at`) = data da verificação.
- A vigência da relação começa na **data da verificação** (a fonte não declara a data do fato; não inventamos).
- Idempotente: repetir não duplica; relação existente só renova `validated_at` e a evidência.
- Transação única: falha no meio desfaz tudo. Desfazer depois da carga: manifesto + `rollbackSeed` (mantém organização que já tenha outro uso).

## Execução no `ln-staging-db` (formato de `infra/docs/credenciais-sem-expor.md`, do DevOps)
Estado: **pronto para rodar quando o DevOps liberar; nada foi executado no staging.** Eu não tenho (nem peço) a chave da Vertra, a senha ou os PEM: o script de credenciais do PM injeta `APP_ENV`, `DATABASE_URL`, `DB_SSL_CA_PEM`, `DB_SSL_CERT_PEM`, `DB_SSL_KEY_PEM` **só no ambiente do processo filho**. O `load-seed` nunca imprime URL nem PEM, não gira senha, não recebe segredo por argumento e mostra só nomes de variáveis ausentes.

### Pré-condições (DevOps/PM)
1. `ln-staging-db` com as migrações do produto aplicadas, **incluindo `0006_intelligence`** (`infra/scripts/migrate.mjs --env staging` e `verify-migrations`). O `load-seed` confere isso antes de qualquer coisa e para com `schema_intelligence_ausente` se faltar.
2. Regra da senha do doc do DevOps: o script de credenciais **gira a senha a cada execução**. Antes de os apps usarem o banco (Fase 1) isso é inofensivo; **depois** (Fase 3) cada execução derruba web/worker até receberem a nova senha. Portanto: se o staging já tem apps conectados, o DevOps escolhe a variante da Fase 3 (gira, atualiza `DATABASE_URL` nos dois apps e reinicia) — **ou** rodamos a carga na mesma janela de uma migração, que já tem esse procedimento. Cada execução abaixo (check, dry-run, apply) é uma execução do script de credenciais: **agrupar em uma única janela** reduz giros.
3. Snapshot/backup do banco antes do `--apply` (regra comum do DevOps).
4. Checkout para compilar o carregador: este (`C:UsersmazinOpenBotSharedloyalty-newscodewt-intelligence`, com `node_modules`). O script de credenciais roda com `cwd = LN_CHECKOUT` (`wt-migrar`), então **os caminhos abaixo são absolutos**.
5. Flags: `intelligencePessoas` desligada (padrão). A carga não toca pessoas.

### Roteiro (cada comando = uma execução do script de credenciais; "ln-com-credenciais.mjs" fica na pasta de scripts do PM)
```
# 0) compilar o carregador (sem credenciais; uma vez)
cd C:UsersmazinOpenBotSharedloyalty-newscodewt-intelligence
npx esbuild packages/intelligence/scripts/load-seed.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/ln-intelligence/load-seed.mjs

# 1) estado antes (só leitura): esperado tudo 0, extended_personal_data_enabled=false
node ln-com-credenciais.mjs staging -- node C:UsersmazinOpenBotSharedloyalty-newscodewt-intelligence
ode_modules.cacheln-intelligenceload-seed.mjs --check

# 2) DRY-RUN (padrão, só leitura): esperado create 40, exists 0, rejected 0; exit 0
node ln-com-credenciais.mjs staging -- node C:UsersmazinOpenBotSharedloyalty-newscodewt-intelligence
ode_modules.cacheln-intelligenceload-seed.mjs --dataset C:UsersmazinOpenBotSharedloyalty-newscodewt-intelligencepackagesintelligencedataseed.public.v2.json --verification C:UsersmazinOpenBotSharedloyalty-newscodewt-intelligencepackagesintelligencedataseed.public.v2.verification.json

# 3) APLICAR — só depois do OK do PM sobre o dry-run (exige APP_ENV=staging; em produção é recusado)
node ln-com-credenciais.mjs staging -- node C:UsersmazinOpenBotSharedloyalty-newscodewt-intelligence
ode_modules.cacheln-intelligenceload-seed.mjs --dataset … --verification … --apply --manifest <pasta de releases do DevOps>intelligence-seed-v2.manifest.json

# 4) estado depois (só leitura): esperado organizations 20, org_relations 20, org_relations_not_declared 0, evidence_mock 0, persons/role_assignments/moves 0
node ln-com-credenciais.mjs staging -- node C:UsersmazinOpenBotSharedloyalty-newscodewt-intelligence
ode_modules.cacheln-intelligenceload-seed.mjs --check
```
O manifesto (só IDs, nenhum segredo) fica com o DevOps; sem ele não há desfazer automático (a alternativa é restaurar o snapshot).

### Critérios de parada
- Dry-run com qualquer `rejected` (exit 1) ⇒ **não aplicar**; reverificar as fontes (`verify-dataset.mjs`) e investigar.
- `--check` antes com contagens diferentes de 0 ⇒ alguém já carregou: rodar o dry-run e ler `exists` (a carga é idempotente, mas confirmar com o PM).
- Qualquer falha de conexão/TLS ⇒ o carregador imprime só tipo e código do erro; **não** repetir em laço (cada tentativa gira a senha); chamar o DevOps.
- Depois da carga: conferir no portal de staging (quando existir) a página da Livelo: relações com fonte e data, **sem o trecho literal** (ver `termos-fontes.md`).

### Desfazer
Com o manifesto: `rollbackSeed(db, manifesto)` (organizações/relações criadas pela carga, se nada mais as usa; evidência órfã). Sem comando próprio ainda; o DevOps pode chamar via um script curto, ou restaurar o snapshot do item 3 das pré-condições.

## Ampliar (próximas cargas)
- Cada nova organização/relação = uma entrada em `sources` + `organizations`/`relations` com citação literal de página pública oficial (RI, imprensa, regulador, associação), depois `verify-dataset`, depois carga. Sem citação verificável, não entra.
- Priorizar páginas estáticas ou feeds oficiais; páginas que só renderizam com JavaScript ficam fora até haver coleta autorizada pelo Editorial (coletor com robots/termos aprovados).
- Pessoas e cargos: só depois do J-01 (parecer, controlador, processador), ligando `intelligencePessoas` por decisão registrada, e **somente** pelo contrato `role-observation/1` (nome, cargo, empresa de fonte pública; DP-11 P4). Moves aparecem da comparação entre observações e dependem de revisão antes de ir ao portal.
- Volume real: o critério de desempenho do grafo (ADR-009, p95 ≤ 300 ms com 100 mil arestas) segue **não verificado** no PostgreSQL de staging; medir ali (`EXPLAIN (ANALYZE, BUFFERS)`) antes de crescer.

## Não verificado
Execução no PostgreSQL 18 (só PGlite); carregador compilado contra um servidor real (`pg.Client`); o que os sites mudaram desde 23/11/2026; se os termos de uso dessas páginas permitem reutilização do trecho (o trecho é curto, com crédito e link; revisão jurídica da fonte é do Editorial/J-14).
