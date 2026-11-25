# Fonte Linux do .next pré-construído (workflow ATIVO em .github/workflows/web-prebuilt.yml; ainda nunca executado)

`.github/workflows/web-prebuilt.yml` constrói o web num runner Ubuntu em `/app` e entrega o pacote **pré-construído** (build vazio na Vertra) como artefato. É a fonte que também serve à **produção**, a cada commit, porque o `.next` embute `APP_ENV` e a URL do build.

## Como usar (PM)
1. O workflow já está em `.github/workflows/web-prebuilt.yml` (PR do G3), com as 3 actions fixadas por SHA de commit.
2. Envie ao GitHub o commit a construir (precisa conter `infra/scripts/package-prebuilt.mjs` e `lib/prebuilt.mjs`, isto é, a `ft/infra-prebuilt` integrada).
3. Rode: `gh workflow run web-prebuilt.yml -f commit=<sha40> -f perfil=production -f subdominio=loyaltynews` (staging SEM flags: `-f perfil=staging -f subdominio=loyaltynews-stg`). **O workflow não aceita flags de produto**: o `ci-checks` proíbe atribuir `LN_FLAGS_ON` em workflow (ADR-022); o staging COM flags continua pelo fluxo local (`baixar-next-vertra` + `package-prebuilt`).
4. Baixe: `gh run download <id> -D <pasta>`; confira a linha `arvore-sha256=` do resumo da execução contra a pasta baixada.
5. Deploy: `update_app_config { build: "" }`, `deploy_app` com a pasta `ln-web-…-prebuilt` (sem build; ver o pedido de deploy), `memory 512` o tempo todo.

## O que o workflow garante
- Só dispara à mão; permissão só de leitura; nenhum segredo; as entradas são validadas e passam por variável de ambiente.
- O checkout é o commit pedido; o pacote do web sai do MESMO commit (`package-web`, `git archive`); o build roda em `/app` com as variáveis do `release.json`; `build-web.mjs` confere canonical e noindex; `package-prebuilt` recusa `.next` com caminho de host e pasta que o painel remove do upload.
- Na subida, o `start-web` recusa o pré-construído se ele não for do mesmo commit, ambiente, URL, flags e indexação do `release.json`.

## NÃO verificado
- Que o `setup-node` ofereça o Node 26.13.1 (a versão da Vertra); que o `.next` construído no runner rode na imagem da Vertra (nenhum código nativo entra no `.next`, mas não foi provado); que o build da Vertra (com variáveis de painel) e o do runner produzam o mesmo conteúdo estático; a cota de minutos do repositório privado (gratuita até o limite do plano do GitHub; confirme antes de usar em rotina).
- Isto não substitui o ensaio no staging: a primeira prova é um deploy de staging com build vazio, de qualquer fonte de `.next` (ver o pedido de deploy da prova).

## Ações fixadas por SHA (conferidas com `git ls-remote` em 24/11/2026)
- `actions/checkout` v4.2.2 = `11bd71901bbe5b1630ceea73d27597364c9af683`
- `actions/setup-node` v4.4.0 = `49933ea5288caeca8642d1e84afbd3f7d6820020`
- `actions/upload-artifact` v4.6.2 = `ea165f8d65b6e75b540449e92b4886f43607fa02`
Para atualizar: `git ls-remote --tags https://github.com/actions/<nome> 'refs/tags/vX.Y.Z*'` e troque o SHA e o comentário.

## Staging com flags (pré-construído pelo Actions, sem flags): baixar → conferir → carimbar
O workflow NÃO aceita flags (o `ci-checks` proíbe `LN_FLAGS_ON` em workflow, ADR-022). As flags só são lidas em execução (regra do `ci-checks`: `LN_FLAGS_ON` só em `packages/contracts/src/flags.ts`), então o `.next` construído sem flag vale para o staging com flag, desde que o pacote seja CARIMBADO. Sequência exata:
1. Rodar: `gh workflow run web-prebuilt.yml -f commit=<sha40> -f perfil=staging -f subdominio=loyaltynews-stg` (sem `-f flags`: não existe). Anotar a linha `arvore-sha256=<64 hex>` do resumo da execução.
2. Baixar: `gh run download <id> -D <pasta>` (a pasta do pacote e o `.manifest.json` ficam lado a lado; baixe o artefato inteiro).
3. **Conferir**: `node infra/scripts/arvore-sha256.mjs <pasta do pacote> --esperado <hex do run>` → exit 0. Não bateu = não carimbe, não implante.
4. **Carimbar**, passando a MESMA soma: `node infra/scripts/carimbar-flags-prebuilt.mjs --pasta <pasta do pacote> --flags intelligencePessoas --soma-esperada <hex do run> --raiz <checkout do MESMO commit>`. Recusa se: a soma "antes" não é a do run; o manifesto ao lado não existe ou não tem a lista de variáveis do deploy; o `packages/contracts/src/flags.ts` do pacote difere do da `--raiz`; o perfil não é staging; a flag é desconhecida ou sem decisão para staging; já há outras flags; há ZIP ao lado.
5. Registrar as DUAS somas que a ferramenta imprime (`arvoreSha256Antes` = a do run; `arvoreSha256Depois` = a que vai ao deploy) e fazer o deploy com build vazio a 512 MB (o `set_env` do manifesto já leva `LN_FLAGS_ON`).
