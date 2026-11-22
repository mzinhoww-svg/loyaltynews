# Observabilidade — logs, métricas e saúde (frente 01)
Estado: **desenho + sonda pronta; nada ligado**. Ferramentas da Vertra citadas abaixo são de **leitura**.

## O que a Vertra já oferece (documentação de 22/11/2026)
| Sinal | Fonte | Limite |
|---|---|---|
| Status ao vivo (CPU, RAM, uptime) | `get_app_status`, `get_database_status` | instantâneo |
| Histórico CPU/RAM/disco/rede | `get_metrics`, `get_database_metrics` (`10m`, `30m`, `24h`) | **no máximo 24 h** |
| Logs de app e de build | `get_logs`, `get_release_log`, `get_image_build_log` | **retenção e exportação não documentadas** (pergunta 9 do R0-07, suporte Vertra) |
| Tráfego (método, status, duração, tamanho; sem caminho nem IP) | analytics web | 7 dias no Pro; detalhe de performance/requisições só no Pro+ |
| Histórico de atividade (deploys, restarts, config) | painel | 30 dias |
| Alertas | **nenhum documentado** | — |
Conclusão: a Vertra mostra, mas não alerta nem guarda tempo suficiente. Alerta e retenção ficam por conta nossa.

## Desenho proposto
1. **Saúde** (`infra/scripts/healthcheck.mjs`, código 1 = alertar): sonda de `/api/health` e `/api/ready` por ambiente. Rotina externa a cada **5 min**, com 2 novas tentativas antes de alertar. Alerta: mensagem ao PM (e-mail/mensagem a pessoas só com autorização do proprietário).
2. **Backup**: `backup-freshness.mjs` a cada **15 min** (ADR-012); alerta se o último backup tiver mais de 375 min.
3. **Recursos**: rotina horária lê `get_app_status`/`get_metrics` (`24h`) e alerta se RAM > 85% da alocada (OOM mata o app; a Vertra reinicia até 5 vezes em 10 min e depois para) ou se o `uptime` voltar a zero sem deploy. Tamanho de RAM é o principal risco do web em 512 MB.
4. **Logs**: JSON em stdout, uma linha por evento, com `ts`, `level`, `env`, `version` (= `APP_COMMIT`), `requestId`, rota, status, duração. **Nunca** segredo, token, corpo de requisição com dado pessoal, nem e-mail/CPF. Como a retenção da Vertra é desconhecida, o plano é exportar periodicamente (`get_logs`) para o destino externo até o suporte responder; **não implementado** (depende da resposta e do destino).
5. **Deploy**: após cada deploy, `healthcheck.mjs --expect-commit <sha>` precisa passar; senão rollback (a Vertra faz o automático em 60 s no Pro).
6. **Contador de erros no ensaio de zero downtime**: sonda a cada 2 s durante o deploy de staging; critério para ligar `auto` em produção = zero respostas não-2xx e nenhum erro de arquivo ausente.

## Contrato dos endpoints (dono do código: Backend, `apps/web/app/api`)
- `GET /api/health` → 200 `{"status":"ok","version":"<APP_COMMIT>","env":"staging|production","time":"<ISO>"}`. **Sem dependências** (é o `health_check_path`: 5xx reprova o deploy).
- `GET /api/ready` → 200 `{"status":"ok|degraded","checks":{"db":"ok|down|not_configured","redis":"ok|down|not_configured","workers":"ok|down|not_configured"}}`; 503 se algo crítico estiver fora. `workers` = batimento (`workers:heartbeat:<id>` no Redis, TTL 60 s).
- Workers: tratar `SIGTERM` (parar de pegar jobs, concluir o corrente, fechar BullMQ), gravar o batimento, log JSON.
- Sem dados pessoais nem segredos nas respostas.

## Pedidos a outros donos (nada alterado fora de `infra/` e `.github/workflows/`)
| Dono | Pedido |
|---|---|
| LN Backend Engineer | `/api/health`, `/api/ready`, modo `APP_MODE=nodb`, SIGTERM e batimento dos workers, log JSON, TLS+PEM de `DB_*`/`REDIS_*` por variável (sem arquivos) |
| LN Chief Architect | scripts `lint`, `typecheck`, `build`, `test` por workspace (usados por `build.mjs`/`test.mjs`); `packages/db` com script `migrate` (aceita `DB_SSL_MODE=disable` só em CI); `engines.node >= 24`; lockfile versionado (usado por `npm ci` e pelo cache do CI); nenhuma dependência de Supabase/Vercel/pgvector |
| Donos das telas (Frontend, Studio, UI) | texto `MOCK` visível em dado de fixture; estado vazio honesto para audiência/métricas comerciais |

## Não verificado
Retenção/exportação de logs da Vertra; se `get_metrics` de banco dá picos de conexões; custo e canal real de alerta; nenhuma rotina foi criada (precisa de autorização do PM).
