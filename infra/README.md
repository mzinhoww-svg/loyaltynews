# infra/ — Frente 01 (LN DevOps Engineer)
Preparado em 22/11/2026 no fast-track. **Nada foi aplicado na Vertra nem no GitHub** (regra 6 do fast-track; sem push até o bootstrap R0-03).

| Caminho | Conteúdo |
|---|---|
| `vertra/environments.json` | especificação de staging-min, staging e produção: apps, comandos, health check, zero downtime, RAM, cenários de capacidade |
| `vertra/env-contract.json` | contrato de variáveis de ambiente (**só nomes**) |
| `docs/deploy-vertra.md` | como a Vertra implanta o monorepo, health check, zero downtime, recursos, chaves |
| `docs/backup-restore.md` | ADR-012: backup externo cifrado, alerta, ensaio de restauração |
| `docs/observabilidade.md` | logs, métricas, health; contrato de `/api/health` e `/api/ready`; pedidos a outros donos |
| `docs/checklist-primeiro-deploy-staging.md` | roteiro para o PM executar o primeiro deploy |
| `docs/deploy-por-zip.md` | deploy de staging sem GitHub: pacote de um commit local + ferramentas Vertra |
| `docs/integracao.md` | como o branch `ft/integracao` é montado, verificado e empacotado; resultados |
| `vertra/bindings.json` | vínculo ambiente -> banco (host/nome, não secretos): migração e backup recusam sem ele |
| `scripts/` | `build.mjs`, `test.mjs`, `migrate.mjs`, `ci-checks.mjs`, `backup-pg.mjs`, `restore-check.mjs`, `backup-freshness.mjs`, `healthcheck.mjs`, `guard-env.mjs`, `verify-migrations.mjs`, `package-web.mjs`, `integracao.mjs` (Node ≥ 24, sem dependências) |
| `tests/` | testes `node:test` dos scripts |
| `../.github/workflows/` | `ci.yml` e `backup.yml` (preparados, **inativos**; ações fixadas por SHA) |

Testes: `node --test infra/tests/` (11 testes; usam chave GPG descartável e dump simulado; **não** há PostgreSQL real). Tudo junto: `node infra/scripts/test.mjs` (ci-checks + testes de infra + `npm test`). Verificações de CI: `node infra/scripts/ci-checks.mjs` (ADR-001: zero supabase/vercel/pgvector em dependências instaladas e IaC; `CREATE EXTENSION` só da lista *trusted*; guarda básica de segredos).
Ensaio local no scaffold (`ft/scaffold` 78a271c): `npm install`, `npm run lint`, `typecheck`, `test`, `npm run build -w apps/web` e `npx next start apps/web` + `healthcheck.mjs` passaram. **Nada rodou na Vertra.**
