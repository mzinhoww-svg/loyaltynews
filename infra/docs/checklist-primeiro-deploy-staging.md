# Checklist do primeiro deploy de staging (para o PM executar quando houver código homologado)
Escopo: **staging-min** (só `apps/web`, 512 MB, sem banco) como primeiro deploy; depois o resto do `staging` (workers 256, PostgreSQL 18 1024, Redis 8.2 512; seção E). Capacidade: `pro-8`, 5120 MB livres (get_profile de 22/11): staging completo (2304) + produção (2432) = 4736, sobram 384 MB (`infra/vertra/environments.json`). **Deploy só depois da homologação do QA e com o ok do PM.**
Regras: R0 não vale mais para escrita do DevOps **somente** depois do gate e com capacidade aprovada (fast-track regra 6). Nenhuma operação destrutiva (`delete_*`, `reset_*`, `remove_*`, `restore`) sem autorização expressa (regra 4a). Segredos só pelo cofre; nunca em chat, arquivo ou commit.

> Caminho sem GitHub (pacote local gerado de um commit): `deploy-por-zip.md`. Este checklist vale para os dois caminhos.

## A. Pré-condições (todas verdadeiras, senão parar)
- [ ] Bootstrap R0-03 executado pelo PM; repositório com branches `main` e `staging`; Actions do produto conforme decisão do PM.
- [ ] Código do `apps/web` **homologado pelo QA** (status.json `homologado=true`) e `staging` apontando para esse commit; `node infra/scripts/build.mjs` passa localmente (lint, typecheck, `npm run build -w apps/web`).
- [ ] `/api/health` (já existe) com `version`/`env`, e `/api/ready` + modo `nodb` implementados; `node infra/scripts/test.mjs` verde.
- [ ] Proprietário aprovou a capacidade e criou a chave `ln-deploy-staging` com os escopos de `deploy-vertra.md` §5 (valor no cofre). Conexão GitHub da Vertra com acesso ao repositório (a conta já tem conexão GitHub: confirmar acesso ao repositório do produto).
- [ ] Reconfirmado agora: `get_profile` mostra plano `pro-8`, **livre ≥ 512 MB** para o staging-min (≥ 2304 MB para o staging completo), e os 6 recursos de outros projetos (3072 MB) com os mesmos ID/RAM/estado de R0-07 v2 (anotar o instante).
- [ ] Subdomínio: tentar `loyaltynews-staging` (variante se ocupado) e registrar o escolhido em `APP_URL`.
- [ ] **ok explícito do PM** para o deploy.

## B. Execução
1. **Organização** (escrita): criar o workspace `loyalty-news` (ou a pasta pessoal `Loyalty News`).
2. **Criar a app** `ln-staging-web` (Website, 512 MB, `typescript` 26.13.1) ligada a `mzinhoww-svg/loyaltynews`, branch `staging`. Se o MCP não aceitar repositório GitHub na criação, usar o painel (integração GitHub) e confirmar a conexão. Conferir o esquema da ferramenta no momento (não assumir argumentos).
3. **Configurar**: `build_command = npm run build -w apps/web`; `start_command = npx next start apps/web -p 80 -H 0.0.0.0`; `health_check_path = /api/health`; `zero_downtime = auto`; `auto_rollback = true`. Variáveis (valores pelo cofre, `infra/vertra/env-contract.json`): `APP_ENV=staging`, `NODE_ENV=production`, `APP_MODE=nodb`, `APP_COMMIT=<sha do commit homologado>`, `APP_URL` e `BETTER_AUTH_URL` (a URL pública). **`PORTAL_SOURCE` fica VAZIA/não definida** (nem `mock` nem `intelligence`). **Nunca** `LN_STUDIO_TEST_SESSION`, `PORTAL_MODE=mock`, `CI`, `DB_SSL_MODE` (o guard recusa).
4. **Construir e subir**; acompanhar `wait_for_app` e o log de build. `BUILD_FAILED`/`BUILD_TIMEOUT` (10 min) ou app `down` → **parar**, ler o log, corrigir no código (não repetir em loop; limite 60 deploys/h).
5. **Verificar saúde**: `node infra/scripts/healthcheck.mjs --url https://<subdomínio>.vertraweb.app` → `ok`. Quando o `/api/health` devolver `version`, acrescentar `--expect-commit <sha>` (hoje o scaffold devolve só `status`, `service`, `flagsLigadas`; ver `observabilidade.md`). `--ready` só passa quando o Backend criar `/api/ready` (hoje 404; esperado depois: `degraded`/`db: not_configured`).
6. **Verificar o produto**: abrir a home e as telas homologadas; conferir que dado de fixture mostra **MOCK** e que métricas/audiência comerciais estão em estado vazio (nunca fictícias). Guardar prints/URL como evidência.
6b. **Segredos e proxies (pedido do Backend, ft/backend)** — só vale quando o staging tiver o backend/banco; no staging mínimo (`APP_MODE=nodb`) não há auth nem banco e o limite por IP fica inativo (seguro):
   - `BETTER_AUTH_SECRET`: aleatório, **>= 32 caracteres** (o app recusa menos), **distinto em staging e produção**. Gerar direto no cofre/painel (por exemplo `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`, sem exibir o resultado) e o **proprietário define pelo painel**, para o valor não passar pelo chat nem por argumento de ferramenta. Nunca em arquivo ou commit.
   - `DATABASE_URL` + `DB_SSL_CA_PEM`/`DB_SSL_CERT_PEM`/`DB_SSL_KEY_PEM`: quando existir o banco; host e nome precisam coincidir com `infra/vertra/bindings.json` (preencher por PR).
   - **`TRUSTED_PROXY_HOPS`**: o Backend vale a N-ésima entrada de `X-Forwarded-For` contada da direita; a documentação da Vertra não diz quantos proxies há. Medir, não chutar: com o app no ar e o diagnóstico `DIAG_XFF=1` (pedido ao Backend: devolver só a **contagem** de entradas, nunca IPs; o guard reprova em produção), mandar UMA requisição de teste minha a `/api/health` com **uma entrada falsa injetada** (`X-Forwarded-For: 203.0.113.9`, faixa de documentação). `hops = total de entradas recebidas - 1`; repetir com duas entradas falsas para confirmar (+1). Só então definir `TRUSTED_PROXY_HOPS=<hops>`, retirar `DIAG_XFF` e conferir que o limite por IP passa a valer. Não registrar IPs de terceiros. Sem medição, deixar `TRUSTED_PROXY_HOPS` **indefinida**.
7. **Ensaio de zero downtime** (decide o modo da produção): rodar a sonda a cada 2 s (`healthcheck.mjs` em laço, 5 min) enquanto se faz um deploy trivial (novo commit em `staging`); registrar contagem de respostas não-2xx. Zero erros → liberar `auto` em produção; senão manter `off`.
8. **Não-impacto**: `get_profile` e `list_apps`: os 6 recursos de outros projetos iguais ao passo A; memória alocada = anterior + 512.
9. **Registrar**: atualizar `fast-track/status.json` (`infra-ci-staging.operacional = true` **só** se 5–8 passaram, com evidência e commit); avisar o PM com o que subiu, URL, commit e medidas.
10. **Monitoria** (precisa de autorização do PM): rotina de saúde a cada 5 min (`healthcheck.mjs`) e, quando houver banco, a sonda de backup a cada 15 min.

## C. Parar e escalar ao PM se
- livre < 512 MB, algum recurso de outro projeto mudou, ou a leitura diverge de R0-07 v2;
- `API_KEY_SCOPE_DENIED` (pedir ao proprietário o escopo faltante, não usar chave mais ampla);
- build > 10 min, RAM em OOM, health check falhando duas vezes seguidas;
- qualquer passo exigiria pagamento, upgrade de plano ou operação destrutiva.

## D. Desfazer (sem destruir)
Parar a app (`stop_app`) e, se preciso, despublicar; **não** deletar sem autorização expressa (regra 4a). Variáveis podem ser rotacionadas pelo proprietário.

## E. Depois do staging-min (resto do staging, mesma disciplina de homologação e ok do PM)
Criar `ln-staging-db` (PostgreSQL 18, 1024 MB), `ln-staging-redis` (8.2, 512 MB), `ln-staging-workers` (256 MB), pasta Blob; definir as variáveis `DB_*`/`REDIS_*` (certificados PEM do banco, lidos com a chave `ln-provision`), remover `APP_MODE=nodb`; aplicar migrações com `node infra/scripts/migrate.mjs --env staging`; ligar backup (`backup-pg.mjs --stats`) e fazer o ensaio de restauração (`backup-restore.md`). **Produção** (`ln-prod-*`, 2432 MB; cabe junto com o staging completo, sobram 384 MB): só com backup fresco, `migrate.mjs --confirm-production` e `zero_downtime` conforme o resultado do passo 7. Banco compartilhado em schemas fica só como reserva se faltar RAM.
