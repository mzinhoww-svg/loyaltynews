# Deploy de staging SEM GitHub (pacote local) — passo a passo, NADA EXECUTADO
Autor: LN DevOps Engineer · 22/11/2026 · Preparado a pedido do PM enquanto o push ao GitHub espera o bootstrap R0-03. O primeiro deploy só acontece com a **autorização do PM**, depois que o QA homologar portal e Studio. Nenhuma ferramenta de escrita da Vertra foi chamada na preparação.

## 1. O pacote
`node infra/scripts/package-web.mjs --repo <worktree> --commit <sha> --out <pasta> --profile staging-min [--expect-branch ft/integracao]`
- **Vem do commit, não da pasta de trabalho** (`git archive`): arquivos não commitados, `node_modules`, `.next`, `.env*`, chaves, `apps/web/e2e` e `apps/web/playwright.config.ts` (onde a sessão simulada do Studio é definida) **ficam de fora**. Entra só o necessário para instalar, compilar e iniciar o `apps/web`: `package.json`, `package-lock.json`, `tsconfig*.json`, `apps/`, `packages/` e as três scripts do guard (`infra/scripts/guard-env.mjs` e `lib/guards.mjs`, `lib/util.mjs`).
- Saída: **pasta** `ln-web-<perfil>-<sha12>/` (as ferramentas `create_app`/`deploy_app` recebem uma **pasta**, não ZIP), **ZIP** com o mesmo conteúdo (para o painel) e `.manifest.json` (commit, SHA-256 do ZIP, comandos, variáveis a definir, sondas).
- Garantias verificadas pelo script: ZIP e pasta com os mesmos arquivos; nenhum arquivo proibido; `ci-checks --deploy` aprovado sobre o conteúdo; limite de 100 MB; **reprodutível** (o mesmo commit gera o mesmo ZIP, byte a byte: testado, `b9985b19…` nas duas gerações no ensaio).
- Dois arquivos gerados no pacote: `release.json` (commit, perfil, app) e `vertracloud.config` (pré-preenche o formulário do painel: NAME, MAIN, BUILD, START, VERSION, MEMORY, SUBDOMAIN, LANGUAGE).
- Os comandos de build e start do pacote começam com `node infra/scripts/guard-env.mjs &&`: **o app não compila nem sobe** se `LN_STUDIO_TEST_SESSION` existir (qualquer valor), se `PORTAL_SOURCE`/`PORTAL_MODE` tiverem qualquer valor além de vazio ou `empty` (`mock`, `intelligence`...), ou se houver `CI=true`/`DB_SSL_MODE=disable` em staging/produção.
- Conferir **antes de enviar**: o `commit` do manifesto é o commit que o QA homologou.

## 2. Qual ferramenta usa (divergência a decidir pelo PM)
O pedido cita o servidor remoto `vertra` com `create_app`/`deploy_app`/`upload_files`. Pelas listas de ferramentas que tenho:
- **`create_app` (a partir de uma pasta), `deploy_app` e `upload_files` existem no servidor LOCAL** `vertra-ln-leitura` (`@vertracloud/mcp`, 141 ferramentas). Hoje ele usa a **chave de leitura**, então a escrita é negada por escopo (`API_KEY_SCOPE_DENIED`, provado pelo teste do Security).
- O servidor **remoto** `vertra` (OAuth) que consigo chamar tem `create_app_from_image`, `write_file`, `update_app_config`, `set_env`, `restart_app`, `publish_app`, `wait_for_app`, `add_app_to_workspace` etc., mas **não** `create_app`, `deploy_app` nem `upload_files`: não há como criar uma app a partir do pacote por ele. Além disso o OAuth tem **acesso à conta inteira**, inclusive aos 6 recursos de outros projetos, o que contraria o menor privilégio.
- **Recomendação:** o proprietário cria a chave **`ln-deploy-staging`** (escopos `apps:read apps:write apps:envs apps:files` + `account:write` para a pasta ou `workspaces:write`; **sem** `*:delete`, `databases:credentials` nem `billing:*`; com lista de IPs permitidos) e o PM configura uma **segunda instância local** do mesmo MCP (por exemplo `vertra-ln-deploy`) usando essa chave, só ativada no momento do deploy e revogada depois. Valor da chave só no cofre. Alternativa sem chave nova: o proprietário envia o **ZIP pelo painel** (`vertracloud.config` já pré-preenche o formulário) e eu faço o resto (variáveis, health check, verificação) com a chave de deploy ou ele mesmo.
- Enquanto isso não for decidido, o primeiro deploy fica bloqueado nessa etapa (não por falta de código).

## 3. Passo a passo (as ferramentas abaixo são as do servidor local com chave de deploy; sempre ler o esquema no momento)
**A. Pré-condições (todas verdadeiras, senão parar)**
- [ ] ok explícito do PM; QA 2 homologou portal e Studio no commit do pacote; manifesto cita esse commit.
- [ ] `get_profile`: plano `pro-8`, **≥ 512 MB livres** e os 6 recursos de outros projetos iguais a R0-07 v2 (mesmo ID, RAM, estado; 3072 MB). Anotar o instante.
- [ ] Chave `ln-deploy-staging` ativa; nada de OAuth remoto.
- [ ] Ambiente local sem `LN_STUDIO_TEST_SESSION`, `PORTAL_SOURCE`, `PORTAL_MODE`.

**B. Execução**
1. **Pasta**: `create_personal_folder` (`name: "Loyalty News"`) ou, se houver workspace, `create_workspace` (escrita). Depois do passo 2, mover a app: `add_personal_resource_to_folder` (`resource_type: application`) ou `add_app_to_workspace`.
2. **Criar a app**: `create_app` com `name: ln-staging-web`, `path: <pasta do pacote>`, `main: package.json`, `memory: 512`, `build: node infra/scripts/guard-env.mjs && npm run build -w apps/web`, `start: node infra/scripts/guard-env.mjs && npx next start apps/web -p 80 -H 0.0.0.0`, `subdomain: loyaltynews-staging` (variante se ocupado), `version: 26.13.1`. Os valores exatos estão em `ferramentas.create_app` do manifesto. A ferramenta comprime a pasta (ignora `node_modules` e `.git`), envia e **retorna na hora com a app em `building`**.
3. **Acompanhar**: `wait_for_app` (até 25 s por chamada) até `up` ou `down`. Se `down`: `get_app` (`last_build_error`) e `get_logs`. Códigos: `INSTALL_OUT_OF_MEMORY` aumentar memória; `BUILD_FAILED`/`INSTALL_FAILED` ler o log e corrigir **no código** (não repetir em laço; limite 60 deploys/h); `BUILD_TIMEOUT`/`INSTALL_TIMEOUT` encurtar; `BUILD_INTERRUPTED` tentar de novo uma vez.
4. **Configurar deploy**: `update_app_config` com `id`, `health_check_path: /api/health`, `zero_downtime: auto`, `auto_rollback: true` (a criação não aceita esses campos; enquanto compila, a Vertra responde 409 `APP_BUILDING`).
5. **Variáveis**: `set_env` uma a uma (a resposta não devolve o valor): `APP_ENV=staging`, `NODE_ENV=production`, `APP_COMMIT=<sha do manifesto>`, `APP_MODE=nodb`, `APP_URL=https://loyaltynews-staging.vertraweb.app`. **Nunca definir** `LN_STUDIO_TEST_SESSION`, `PORTAL_MODE` nem `CI`/`DB_SSL_MODE`; **`PORTAL_SOURCE` fica vazia/não definida** (nem `mock` nem `intelligence`: o portal usa a fonte vazia por padrão). Depois `restart_app` para a app subir já com as variáveis (o primeiro build e start ocorrem sem elas; sem `APP_ENV` o guard fica no modo normal, e na reinicialização ele roda em modo estrito).
6. **Verificar** (todas precisam passar):
   - `get_app_status` = `up`; subdomínio público abre.
   - `node infra/scripts/healthcheck.mjs --url https://loyaltynews-staging.vertraweb.app --expect-commit <sha> --denied /studio --no-mock /`: saúde com o commit certo (o `/api/health` do scaffold já devolve `version`/`env`), **Studio negando sem login** e **nenhum "MOCK"** na home. Prova de runtime de que a sessão simulada e as fixtures estão desligadas.
   - Abrir portal e `/studio/entrar`; estados vazios honestos; sem métrica fictícia.
7. **Ensaio de zero downtime** (decide o modo da produção): gerar um segundo pacote de um commit trivial, rodar a sonda a cada 2 s por 5 min e fazer `deploy_app` (`id`, `path`, `message: <sha>`, `restart: true`); contar respostas não-2xx. Zero erros → liberar `auto` na produção; senão manter `off`.
8. **Não-impacto**: `get_profile`/`list_apps`: os 6 recursos de outros projetos iguais; memória alocada = anterior + 512.
9. **Registrar**: `fast-track/status.json` (`infra-ci-staging.operacional = true` só se 6–8 passaram), com URL, commit, SHA-256 do ZIP e medidas; avisar o PM.

**C. Próximos deploys**: gerar novo pacote do commit homologado → `set_env APP_COMMIT=<novo sha>` → `deploy_app` (uma só reinicialização) → repetir a verificação do passo 6. Entre o `set_env` e o fim do deploy o `/api/health` da versão antiga já mostra o commit novo (janela curta): conferir só depois do deploy.
**D. Parar e escalar ao PM se**: livre < 512 MB; algum recurso de outro projeto mudou; `API_KEY_SCOPE_DENIED` (pedir o escopo faltante, nunca usar chave mais ampla nem o OAuth remoto); build > 10 min ou OOM; sonda reprova (`--denied`/`--no-mock`); qualquer passo exigir pagamento ou operação destrutiva.
**E. Desfazer sem destruir**: `preview_rollback` (leitura) e `rollback_app` para a versão anterior; `stop_app`. **Não** deletar sem autorização expressa (regra 4a).

## 4. Depois do staging mínimo
Mesmo pacote com banco e workers: ver `checklist-primeiro-deploy-staging.md` §E (banco `ln-staging-db`, `DATABASE_URL` + `DB_SSL_*_PEM`, vínculo em `infra/vertra/bindings.json`, `migrate.mjs --env staging`). O backend (`ft/backend`) não entra no primeiro staging: `APP_MODE=nodb`.

## 5. Não verificado
Argumentos e comportamento reais de `create_app`/`deploy_app` (esquemas lidos, ferramenta não chamada); se `vertracloud.config` é honrado fora do painel; tempo de build na Vertra; disponibilidade do subdomínio; se a Vertra aceita a pasta com `release.json`/`vertracloud.config` na raiz sem aviso; se o MCP local pode ter uma segunda instância com outra chave (configuração do PM). O ensaio local (instalar, compilar e subir a partir da pasta do pacote) está registrado em `integracao.md`.
