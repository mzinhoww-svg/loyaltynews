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
| `backup-freshness.mjs --env <env>` | lê `latest-<env>.json`; código 1 se tiver mais de 375 min (RPO 6 h + 15 min) ou faltar. **Roda a cada 15 min por rotina externa**: é o alerta de "falha do job em até 15 minutos" |
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
3. Criar instância descartável PostgreSQL 18 vazia (escrita na Vertra, no deploy) e exportar `RESTORE_DB_*`.
4. `node infra/scripts/restore-check.mjs --env staging --scratch` com `GNUPGHOME` apontando para a chave privada.
5. Registrar saída (`ok`, minutos, diferenças) como evidência; destruir a instância descartável.
6. Repetir o teste negativo (arquivo sem a chave não abre) e a falha forçada do alerta.

## Não verificado
`pg_dump`/`pg_restore`/`psql` reais (não há PostgreSQL nesta máquina; os testes usam dump simulado); cifra de dumps grandes; custo e provedor do destino; comportamento do `aws s3` (CLI não testada); PITR e tempo de restauração da Vertra.
