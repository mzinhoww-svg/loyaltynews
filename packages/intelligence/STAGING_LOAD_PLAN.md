# Plano de carga do Entity Intelligence no banco de staging

Estado: **plano pronto; nada foi carregado** (não existe banco de staging ainda). Código testado só em PGlite.
Dono: Frente 08 (LN Data Engineer). Execução: DevOps, com o banco e a `DATABASE_URL` do staging. Sem Vertra de escrita por este plano.

## Ordem de execução quando a J-01 sair (resumo para o PM)
1. **Pré-condições** (todas): decisão J-01 registrada pelo proprietário; OK do PM sobre o dry-run; snapshot do banco; `ln-staging-db` com a migração 0006; janela única (o script de credenciais gira a senha a cada execução).
2. **Carga v4** (homologada pelo QA 3 no commit 5074064) — seção abaixo: check → dry-run `--with-persons` → apply `--with-persons --manifest …intelligence-seed-v4.manifest.json` → check.
3. **Carga v5** (12 cargos a mais; **só depois do parecer do QA 3 sobre o v5**) — seção "Carga v5".
4. Conferir no Studio (fila "a confirmar" vazia; cargos com nível oficial) e **manter a exibição pública de pessoas desligada** até a decisão de produto; flag `intelligencePessoas` do produto continua desligada (o `--with-persons` liga só o carregador, só naquela execução).
5. Só então, se decidido, ligar o job de releitura (`REREAD_JOB.md`: `LN_INTELLIGENCE_REREAD=on`, `LN_INTELLIGENCE_PESSOAS=on`, `LN_REREAD_SEED=<seed v5>`).
Parada: dry-run com qualquer `rejected` (exit 1) ⇒ não aplicar. Sem o manifesto não há desfazer automático (plano B: snapshot).

## Carga v5 — cargos públicos de 17 organizações (sobre a v4 JÁ carregada)
Conjunto `data/seed.public.v5.json` + `seed.public.v5.verification.json` (**87/87** citações literais em 24 fontes): v4 + **12 cargos de 7 organizações** (Livelo, Mastercard, Orbia, Bradesco Seguros, Grupo Santander, Madero, Shopee) = **32 cargos em 17 organizações**. **Santander→Esfera fica "validação vencida"** (a página da Esfera mudou e a citação do v3 deixou de existir em 23/11/2026): o v5 não a apaga nem a renova; marca-a (`expiredRelations`) como inferida com a base "validação vencida em 2026-11-23: …". Efeito: **sai da exibição pública** (o portal só mostra declarada), o Studio a vê com o rótulo `stale_validation: true`; uma nova fonte verificada que a confirme cria a relação declarada e **encerra** a vencida (sem apagar). Desfazer o v5 a devolve a declarada. Cobertura e motivos das 12 organizações sem cargos (Azul/Smiles = classe C; sem página oficial): `CARGOS_COBERTURA.md`.
```
# 0) compilar (igual à v4) e 1) --check: esperado organizations 29, org_relations 28, persons 20, role_assignments 20, evidence 125, moves 0

# 2) DRY-RUN: esperado create 13 (12 cargos + a marcação da Santander→Esfera), exists 75, rejected 0 (exit 0). (Se a v4 NÃO tiver sido carregada, mas a v3 sim: create 33, exists 55.)
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --dataset C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v5.json --verification C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v5.verification.json --with-persons

# 3) APLICAR (OK do PM + J-01)
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --dataset C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v5.json --verification C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v5.verification.json --with-persons --apply --manifest C:/Users/mazin/OpenBot/Shared/loyalty-news/releases/staging/intelligence-seed-v5.manifest.json

# 4) --check: esperado persons 32, role_assignments 32, role_assignments_inferred 0, role_assignments_without_evidence 0, moves 0, evidence 184 (125 + 27 relações e 20 cargos revalidados + 12 novos), organizations 29, org_relations 28 e org_relations_not_declared 1 (a Santander→Esfera "validação vencida")
```
Desfazer o v5: `rollbackSeed` com o manifesto remove os 12 cargos e as 12 pessoas, devolve a Santander→Esfera a declarada e restaura a evidência/validação anteriores das relações e dos 20 cargos revalidados. O arquivo do v5 também é o conjunto que o job de releitura usa.

## Carga v4 — cargos públicos de 10 organizações (sobre a v3 JÁ carregada no ln-staging-db)
Conjunto `data/seed.public.v4.json` (formato `intelligence-seed/2`) + `seed.public.v4.verification.json`: v3 inteira (29 organizações, 28 relações) **+ 20 cargos públicos** (CEO e diretoria; nome, cargo, empresa) de **10 organizações** — Bradesco, Banco do Brasil, Banco Santander (Brasil), Dotz, BRB, Banco BV, GPA, LATAM, Uber e Raia Drogasil (aqui só o presidente do **Conselho de Administração**; a página de RI não traz a diretoria executiva em texto). Verificador: **77/77 citações literais encontradas em 18 fontes** (8 do v3 + 10 páginas oficiais de RI/governança). **Fora dos 10, de propósito:** a ABEMF (a página capturada não nomeia dirigentes) e a **Azul** (classe C da DP-28: só com revisão caso a caso; a página do RI dela foi lida na triagem e **descartada**, nada dela está no conjunto).
Cada cargo traz: fonte oficial (RI da própria empresa), link, data de coleta/validação, citação literal (nome + cargo; **nunca exibida ao público**), certeza `declared`. A vigência começa na data da verificação (GPA: 05/01/2026, data de eleição que a própria página declara). Nada além de nome, cargo e empresa: o formato **recusa** qualquer outro campo (contato, foto, perfil, biografia), nome com dígito/e-mail/link e citação que não contenha o nome e o cargo. **Fontes secundárias** (LinkedIn/The Org, só página pública, sem login): nível `secundaria`, carga como **inferido** ("a confirmar"), que o portal nunca mostra como fato; vira declarado só com leitura oficial (ver `termos-fontes.md`). Este conjunto não tem nenhuma.

**Pré-condição nova (PM):** carregar pessoas exige o OK do PM e a decisão registrada do J-01. O carregador **recusa por padrão** (dry-run sem `--with-persons` marca os 20 cargos como `rejected: ingestão de pessoas desligada`; exit 1). `--with-persons` liga a ingestão **só nessa execução**; a flag `intelligencePessoas` do produto continua desligada e a exibição pública das pessoas segue a decisão do PM/Frontend.

Leitura das 10 páginas (reprodução): `scripts/capture-leadership.ts` lê a página (HTTP direto, robots respeitado; se recusar, Zyte — DP-32, página pública, ritmo baixo, cota gratuita) e grava o texto em `data/captures/<id>.json` (**local, fora do git**) e só os metadados em `<id>.meta.json` (no git). O verificador recalcula o sha256 desse texto e confere cada citação. Em outra máquina/checkout: recapturar (`node node_modules/.cache/ln-intelligence/capture-leadership.mjs <id>=<url>`) e rodar `node packages/intelligence/scripts/verify-dataset.mjs packages/intelligence/data/seed.public.v4.json`. A página pode ter mudado: citação que sumiu = registro recusado, não carregado.

Roteiro (mesmo formato; cada comando = uma execução do script de credenciais; caminhos absolutos):
```
# 0) compilar (sem credenciais)
cd C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence
npx esbuild packages/intelligence/scripts/load-seed.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/ln-intelligence/load-seed.mjs

# 1) estado antes (só leitura): esperado organizations 29, org_relations 28, evidence 77, persons 0, role_assignments 0, moves 0
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --check

# 2) DRY-RUN com pessoas (só leitura): esperado create 20, exists 57, rejected 0 (exit 0). Sem --with-persons: rejected 20 (exit 1) = proteção funcionando
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --dataset C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v4.json --verification C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v4.verification.json --with-persons

# 3) APLICAR (só após o OK do PM sobre o dry-run e a decisão J-01 registrada; APP_ENV=staging). Manifesto na pasta de releases do DevOps
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --dataset C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v4.json --verification C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v4.verification.json --with-persons --apply --manifest C:/Users/mazin/OpenBot/Shared/loyalty-news/releases/staging/intelligence-seed-v4.manifest.json

# 4) estado depois: esperado organizations 29, org_relations 28, persons 20, role_assignments 20, role_assignments_inferred 0, role_assignments_without_evidence 0, moves 0, evidence 125, evidence_mock 0
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --check
```
Por que `evidence` vai de 77 a 125: +20 dos cargos novos e +28 das relações existentes, que **renovam a validação** (as 29 organizações existentes não ganham evidência). Desfazer a v4: `rollbackSeed` com o manifesto remove os cargos e as pessoas que a carga criou (se não têm outro cargo, Move, pedido de titular ou watchlist) e **restaura a evidência e a data de validação anteriores das 28 relações** (`relationsRevalidatedPrevious`; cargos revalidados voltam por `rolesRevalidatedPrevious`, com a certeza anterior). Pessoa suprimida a pedido do titular **não é recriada** (o plano recusa; o carregador pula). Valem as pré-condições, critérios de parada e a regra da senha das seções abaixo (agrupar check, dry-run, apply e check numa só janela).

## Carga v3 (sobre a v2 JÁ carregada no ln-staging-db)
Conjunto `data/seed.public.v3.json` + `seed.public.v3.verification.json`: **29 organizações e 28 relações declaradas** (57/57 citações literais encontradas em 8 fontes). A v3 supera a v2: reconhece o que já está no banco e cria só o novo.

**Novo na v3 (17 registros):** Santander → Esfera (título literal da página da Esfera: "Esfera: O programa de pontos e recompensas do Santander"); Banco Santander (Brasil) S.A. → Grupo Santander (RI do banco: "pertence ao Grupo Santander…"); parcerias que a página de imprensa da Livelo nomeia na mesma frase: Grupo Madero, Shopee, Bradesco Seguros, Genial Investimentos; Stix = "programa de pontos do GPA com Raia Drogasil" (GPA e Raia Drogasil → Stix). **Stix:** o site dela NÃO é fonte (a página atual "Em Evolução" não descreve o programa); as relações da Stix vêm da ABEMF e da Livelo e o conjunto marca a Stix para **revisão humana** (campo `revisaoHumana`).
**Mudança de fonte:** `abemf-home` passa a usar `https://web.abemf.com.br/` (o host www redireciona; a leitura não segue redirecionamento).
**Dotz (navegador):** o texto da página NÃO fica mais no git; só `data/captures/dotz-home.meta.json` (sha256, data, tamanho). Reverificar o Dotz exige recapturar no navegador do OpenBot.

Roteiro (mesmo formato do v2; cada comando = uma execução do script de credenciais; caminhos absolutos):
```
# 0) compilar (sem credenciais)
cd C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence
npx esbuild packages/intelligence/scripts/load-seed.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/ln-intelligence/load-seed.mjs

# 1) estado antes (só leitura): esperado organizations 20, org_relations 20, evidence 40, persons 0
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --check

# 2) DRY-RUN: esperado create 17, exists 40, rejected 0 (exit 0)
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --dataset C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v3.json --verification C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v3.verification.json

# 3) APLICAR (só após o OK do PM sobre o dry-run; APP_ENV=staging). O manifesto vai para a pasta de releases do DevOps
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --dataset C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v3.json --verification C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v3.verification.json --apply --manifest C:/Users/mazin/OpenBot/Shared/loyalty-news/releases/staging/intelligence-seed-v3.manifest.json

# 4) estado depois: esperado organizations 29, org_relations 28, org_relations_not_declared 0, evidence 77, evidence_mock 0, persons/role_assignments/moves 0
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --check
```
Por que `evidence` vai de 40 a 77: +17 dos registros novos e +20 das relações já existentes, que **renovam a validação** (nova evidência e nova data de validação; a evidência antiga fica sem uso até um eventual desfazer, que a recoloca). Desfazer a v3: `rollbackSeed` com o manifesto da v3 remove o que a v3 criou **e restaura a evidência e a data de validação anteriores das 20 relações que ela revalidou** (o manifesto guarda os valores antigos em `relationsRevalidatedPrevious`; coberto por teste que compara linha a linha e a contagem de evidências). Só vale para manifestos gerados por esta versão do carregador; o manifesto da v2 não revalidou nada e não precisa disso. O snapshot continua sendo o plano B. Valem as mesmas pré-condições, critérios de parada e a regra da senha das seções abaixo (o script de credenciais gira a senha a cada execução: agrupar check, dry-run, apply e check numa só janela).

> As seções abaixo descrevem a v2 (histórico da carga já feita) e o mecanismo geral.

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
4. Checkout para compilar o carregador: este (`C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence`, com `node_modules`). O script de credenciais roda com `cwd = LN_CHECKOUT` (`wt-migrar`), então **os caminhos abaixo são absolutos**.
5. Flags: `intelligencePessoas` desligada (padrão). A carga não toca pessoas.

### Roteiro (cada comando = uma execução do script de credenciais; "ln-com-credenciais.mjs" fica na pasta de scripts do PM)
```
# 0) compilar o carregador (sem credenciais; uma vez)
cd C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence
npx esbuild packages/intelligence/scripts/load-seed.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/ln-intelligence/load-seed.mjs

# 1) estado antes (só leitura): esperado tudo 0, extended_personal_data_enabled=false
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --check

# 2) DRY-RUN (padrão, só leitura): esperado create 40, exists 0, rejected 0; exit 0
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --dataset C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v2.json --verification C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v2.verification.json

# 3) APLICAR — só depois do OK do PM sobre o dry-run (exige APP_ENV=staging; em produção é recusado)
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --dataset C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v2.json --verification C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/data/seed.public.v2.verification.json --apply --manifest C:/Users/mazin/OpenBot/Shared/loyalty-news/releases/staging/intelligence-seed-v2.manifest.json

# 4) estado depois (só leitura): esperado organizations 20, org_relations 20, org_relations_not_declared 0, evidence_mock 0, persons/role_assignments/moves 0
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/load-seed.mjs --check
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
