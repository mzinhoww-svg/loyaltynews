# Fonte Linux do .next pré-construído (proposta; nada aqui está ativo nem foi enviado ao GitHub)

`web-prebuilt.workflow.yml` constrói o web num runner Ubuntu em `/app` e entrega o pacote **pré-construído** (build vazio na Vertra) como artefato. É a fonte que também serve à **produção**, a cada commit, porque o `.next` embute `APP_ENV` e a URL do build.

## Como usar (PM)
1. Copie o arquivo para `.github/workflows/web-prebuilt.yml` num PR seu e **fixe as ações por SHA de commit** (hoje estão por tag: não verifiquei os SHAs).
2. Envie ao GitHub o commit a construir (precisa conter `infra/scripts/package-prebuilt.mjs` e `lib/prebuilt.mjs`, isto é, a `ft/infra-prebuilt` integrada).
3. Rode: `gh workflow run web-prebuilt.yml -f commit=<sha40> -f perfil=staging -f subdominio=loyaltynews-stg -f flags=intelligencePessoas` (produção: `-f perfil=production -f subdominio=loyaltynews`, sem flags).
4. Baixe: `gh run download <id> -D <pasta>`; confira a linha `arvore-sha256=` do resumo da execução contra a pasta baixada.
5. Deploy: `update_app_config { build: "" }`, `deploy_app` com a pasta `ln-web-…-prebuilt` (sem build; ver o pedido de deploy), `memory 512` o tempo todo.

## O que o workflow garante
- Só dispara à mão; permissão só de leitura; nenhum segredo; as entradas são validadas e passam por variável de ambiente.
- O checkout é o commit pedido; o pacote do web sai do MESMO commit (`package-web`, `git archive`); o build roda em `/app` com as variáveis do `release.json`; `build-web.mjs` confere canonical e noindex; `package-prebuilt` recusa `.next` com caminho de host e pasta que o painel remove do upload.
- Na subida, o `start-web` recusa o pré-construído se ele não for do mesmo commit, ambiente, URL, flags e indexação do `release.json`.

## NÃO verificado
- Que o `setup-node` ofereça o Node 26.13.1 (a versão da Vertra); que o `.next` construído no runner rode na imagem da Vertra (nenhum código nativo entra no `.next`, mas não foi provado); que o build da Vertra (com variáveis de painel) e o do runner produzam o mesmo conteúdo estático; a cota de minutos do repositório privado (gratuita até o limite do plano do GitHub; confirme antes de usar em rotina).
- Isto não substitui o ensaio no staging: a primeira prova é um deploy de staging com build vazio, de qualquer fonte de `.next` (ver o pedido de deploy da prova).

## ANTES DE ATIVAR (obrigatório, pendência do QA 5): fixar as 3 actions por SHA de commit
O workflow usa `actions/checkout@v4`, `actions/setup-node@v4` e `actions/upload-artifact@v4` por TAG (tag pode ser movida). Antes de copiar para `.github/workflows/`, troque cada uma por `uses: actions/<nome>@<sha de 40 caracteres> # v4`. Não gravei SHAs aqui porque não os verifiquei: obtenha-os no momento (com `gh` autenticado):
`gh api repos/actions/checkout/git/ref/tags/v4 --jq .object.sha` (idem `setup-node` e `upload-artifact`). Se o `object.type` for `tag` (tag anotada), siga com `gh api repos/actions/<nome>/git/tags/<sha> --jq .object.sha` até chegar ao commit. Confira o SHA no GitHub (página do release) antes de usar.
