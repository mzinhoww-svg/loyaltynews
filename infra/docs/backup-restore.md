# Backup e restauração (ADR-012) — frente 01
Estado: **scripts prontos e testados sem PostgreSQL; ensaio real pendente** (staging). ADR-012 é proposta, não aceita. Alvo a comprovar: **RPO 6 h, RTO 4 h**.

## Camadas
1. **Vertra, diário** (Pro tem, só bancos): o mais recente de cada banco fica 30 dias, os anteriores 7 dias; snapshot manual 30 dias. Sem evidência de PITR; tempo de restauração não documentado (R0-07).
2. **Externo, a cada 6 h** (`backup-pg.mjs`): `pg_dump -Fc` → cifra com **chave pública GnuPG** → destino **fora da Vertra** (pasta montada ou `s3://`). A chave privada nunca fica no repositório nem no executor do backup; só quem restaura a tem. Destino e custo: decisão do proprietário (fora do teto de API); **nenhum bucket foi criado nem contratado**.
3. **Redis não entra** (reconstruído pelo reconciliador da ADR-002). **Blob não tem backup na Vertra**: fora da ADR-012; decisão do proprietário.

## Scripts (`infra/scripts/`)
| Script | O que faz |
|---|---|
| `backup-pg.mjs [--stats]` | dump → SHA-256 → cifra → manifesto (hashes, versão do pg_dump, estatísticas por tabela se `--stats`) → envia dump, manifesto e por último `latest-<env>.json` |
| `backup-freshness.mjs --env <env> [--verify-object]` | confere `latest` x manifesto, ambiente, **banco de origem (host e nome) contra `bindings.json`**, data (não futura, <= 375 min), existência e tamanho do objeto e, com `--verify-object`, o SHA-256. Código 1 = alertar/recusar. **Roda a cada 15 min por rotina externa** e é a barreira de `migrate.mjs` |
| `restore-check.mjs --env <env> --scratch` | baixa, confere hash do cifrado e do decifrado, restaura em instância **nova e vazia**, recalcula contagem e MD5 por tabela, compara com o manifesto e mede contra o RTO. Recusa se o alvo for o mesmo servidor/porta de `DB_*` ou se não estiver vazio |
Segurança: segredos só por variável de ambiente (PEM gravado em arquivo 0600 temporário e apagado); nada em argv; plaintext só em pasta temporária removida ao final; `BACKUP_TEST_DUMP_FILE` (gancho de teste) é proibido com `BACKUP_ENV=production`.

## Execução
- Agendamento: `.github/workflows/backup.yml` (cron a cada 6 h, **inativo** enquanto as Actions do produto estiverem desligadas), ou rotina OpenBot local equivalente. O GitHub desativa agendamentos de repositório público após 60 dias sem atividade e pode atrasar: **não confiar só nele**, por isso a sonda de frescor.
- Migração de produção só roda com backup fresco (`migrate.mjs` chama a sonda).

## Critérios da ADR-012 e situação
| Critério | Situação |
|---|---|
| Dump não abre sem a chave (teste negativo) | **Testado** com chave GPG descartável (`infra/tests/backup.test.mjs`) |
| Falha do job gera alerta em até 15 min (falha forçada) | **Lógica testada** (backup velho, ausente e adulterado reprovam); falta ligar a rotina de 15 min e provar o alerta ponta a ponta |
| Ensaio em homologação: restaurar o último dump em instância nova; contagens e checksums iguais; tempo ≤ RTO | **Não executado.** Exige PostgreSQL de staging, instância descartável e a chave privada de quem restaura |
| RPO 6 h / RTO 4 h | **a comprovar** no ensaio; sem número medido não há compromisso |

## Ensaio (quando houver banco de staging)
1. Congelar escritas no staging (as estatísticas são uma fotografia pouco antes do dump; só são exatas sem escrita concorrente).
2. `node infra/scripts/backup-pg.mjs --stats` com `BACKUP_ENV=staging`.
3. Criar instância descartável PostgreSQL 18 vazia (escrita na Vertra, no deploy) e exportar `RESTORE_DATABASE_URL` e `RESTORE_DB_SSL_CA_PEM`/`_CERT_PEM`/`_KEY_PEM`.
4. `node infra/scripts/restore-check.mjs --env staging --scratch` com `GNUPGHOME` apontando para a chave privada.
5. Registrar saída (`ok`, minutos, diferenças) como evidência; destruir a instância descartável.
6. Repetir o teste negativo (arquivo sem a chave não abre) e a falha forçada do alerta.

## Não verificado
`pg_dump`/`pg_restore`/`psql` reais (não há PostgreSQL nesta máquina; os testes usam dump simulado); cifra de dumps grandes; custo e provedor do destino; comportamento do `aws s3` (CLI não testada); PITR e tempo de restauração da Vertra.

## Vínculo ambiente/banco e integridade (parecer do QA, ft-infra-ci-staging.md)
O QA bloqueou três pontos; tratamento (testes em `infra/tests/backup.test.mjs`):
1. **Migração e backup ligados ao destino real.** `infra/vertra/bindings.json` registra, por ambiente, o host e o nome do banco (dados não secretos; o host da Vertra contém o ID do banco). `migrate.mjs` exige `--env` **e** `APP_ENV` iguais **e** `DATABASE_URL` apontando para o banco registrado; `backup-pg.mjs` recusa banco diferente do registrado; o manifesto grava `source.host/database`. Ambiente sem vínculo (valores nulos) é **recusado**. Preencher por PR no provisionamento.
2. **Objeto íntegro, não só a data do ponteiro.** A sonda confere `latest` x manifesto, ambiente, banco de origem, data no futuro, tamanho do objeto e, na migração de produção, o **SHA-256 do objeto cifrado**. Ponteiro recente sem dump, dump de outro banco, objeto truncado ou adulterado: reprovam.
3. **CI não fica verde sem migrar.** `ci.yml`: `npm run migrate -w @ln/db` **sem `--if-present`**, seguido de `verify-migrations.mjs` (migrações aplicadas == journal do repositório). `checks` e `migrations` precisam ser **checagens obrigatórias** no ruleset de `main` (`main-required-checks.json`, arquivo do Security/R0-03: pedido registrado). Os dois workflows só rodam com a variável de repositório `LN_ACTIONS_ENABLED == 'true'`, além de as Actions estarem desligadas.
Ainda **não verificado**: nada disso contra um PostgreSQL ou bucket reais. `restore-check.mjs` também recusa como alvo qualquer banco registrado em `bindings.json`.
