# Gate de marca no CI

Workflow: `.github/workflows/gate-marca.yml` (Integration, 26/11/2026). Guarda: `infra/tests/workflow-gate-marca.test.mjs`.
Protocolo do gate: `auditoria-design/acessibilidade/gate-marca-portal.md` (UI/UX).

## O que roda

Ubuntu 24.04, Node da Vertra (`infra/vertra/environments.json`), `npm ci`, Chromium do Playwright com dependências
de sistema e `node apps/web/scripts/gate-marca.mjs --porta 3199`. O script sobe o **build de vitrine** (perfil
`vitrine`, o mesmo modo do staging: `PORTAL_VITRINE=1` + `APP_ENV=staging`, resolvido pelo `apps/web/e2e/portal-server.mjs`),
mede CLS em 390/768/1280 nas rotas `/`, `/noticia/mock-mercado-1` e `/editoria/mercado`, confere fonte da marca,
contraste dos tokens e axe (WCAG 2.1 AA), e roda a fase estática do `@ln/ui`. O JSON sai como artefato
`.test-results/gate-marca.json` mesmo quando o job falha (`if: always()`).

**Sem `PORTAL_SOURCE=mock`:** o gate mede a vitrine real de staging, não um servidor de teste. O modo é do helper de
e2e, e o script do gate não atribui variável só de teste — era o achado do GLOBAL-TESTFLAGS em
`apps/web/scripts/gate-marca.mjs`.

## Gatilhos (decididos)

| Evento | Por quê |
|---|---|
| `pull_request` opened/synchronize/reopened | pega a regressão antes do merge; sem filtro de caminho, porque check "skipped" por `paths-ignore` fica pendente e trava o merge quando for obrigatório |
| `push` em `main` | confirma o merge e faz a **primeira execução**: o GitHub não roda o workflow de um PR que ainda não tem o arquivo na branch de base |
| `workflow_dispatch` | reconferir uma branch sem abrir PR |

Não roda em push de outros branches, em `pull_request_target`, `schedule` ou `workflow_run`.

## Por que um workflow próprio, e não um job no `ci.yml`

O CI do produto (`infra/github-workflows/ci.yml`) está **preparado e inativo**: cada job tem
`if: ${{ vars.LN_ACTIONS_ENABLED == 'true' }}`, e a variável não existe. O outro workflow ativo
(`web-prebuilt.yml`) é manual e constrói o `.next`. Não há workflow de PR ativo hoje, então pôr os passos no template
inativo não faria o gate rodar. O gate fica no `.github/workflows/` e não precisa de segredo (só `contents: read`).

## Como ativar como checagem obrigatória

É ajuste de configuração do repositório, não de código: no ruleset de `main`, marcar o check **`gate-marca / gate`**
como obrigatório (quem opera o GitHub: PM/Deployment Controller). Antes disso o gate roda e reporta, mas não bloqueia
merge.

## Custo e tempo

Uma execução leva ~10–20 min (npm ci, Chromium, `next build` do perfil vitrine e 9 medições com 5 s de espera cada).
O repositório é público, então os minutos do Actions são gratuitos; o que limita é a fila de runners.

## NÃO verificado

- A primeira execução no Actions (o workflow nunca rodou): disponibilidade do Chromium com `--with-deps` no
  `ubuntu-24.04`, memória/tempo do `next build` no runner e o resultado do gate em Linux.
- Se `actions/setup-node` entrega o Node 26.13.1 do `environments.json` (mesmo risco já registrado no `web-prebuilt`).
- Que o check apareça com o nome `gate-marca / gate` no ruleset (o nome exibido é `<workflow> / <job>`).
