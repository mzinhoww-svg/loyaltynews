# Evidência no staging, com o despacho DESLIGADO (23/11/2026, 20:39 UTC)
Tarefa [C] da Integration (ociosidade-2026-11-23-1720.md): cliente do agente do OpenBot contra o staging real, sem despachar nada. **Nenhum agente foi criado; nenhuma tarefa, linha, custo ou segredo foi gravado.** O valor usado como "segredo" nas duas chamadas foi um texto FALSO de ensaio (`valor-falso-de-ensaio-nao-e-segredo`); o segredo real não existe no staging e não aparece em nenhum log. Cliente: `packages/openbot/bin/ln-openbot-agent.mjs` (ft/growth).

## O que foi chamado e o que voltou
| # | Chamada | Resposta | O que prova |
|---|---|---|---|
| 0 | `GET /api/health` | 200 `{"status":"ok","service":"loyaltynews-web","version":"82decac…","env":"staging","flags":[]}`; `GET /api/ready` 200 (`db: ok`, `redis: ok`) | staging no ar na int/012 (`82decac`), **nenhuma flag ligada** (`flags: []` ⇒ `openbotDispatch` desligada) |
| 1 | `pull --kinds fact_check` (conta `codex`) | **HTTP 503**, corpo = página HTML da borda (cabeçalho `x-vertra-error: 1`); o cliente devolveu `UPSTREAM_503` | o `pull` **não entrega nada** com o despacho desligado; a rota existe (um caminho inexistente, `POST /api/openbot/nao-existe`, dá 404) |
| 2 | `heartbeat --task sonda-inexistente --lease sonda` | **HTTP 401** JSON `UNAUTHORIZED: assinatura recusada: sem_segredo` | a rota está no ar e **falha fechada**: o staging **ainda não tem `OPENBOT_HMAC_SECRET`** (`sem_segredo`); com segredo falso não passa |
| 3 | `GET /api/health` depois | igual ao #0 | nada mudou no app |

## Achado: a borda da Vertra esconde o código do 503
O `pull` com o despacho desligado responde 503 `DISPATCH_OFF` no código, **mas a borda da Vertra substitui o corpo de 502/503 por uma página HTML genérica** (`x-vertra-error: 1`). Efeito: o agente (e qualquer operador) **não vê** o código no corpo, e `DISPATCH_OFF`, `KILL_SWITCH`, `PILOT_STOPPED` e "app fora do ar" ficam indistinguíveis pelo `pull`. Respostas 401/404/409 com JSON passam normalmente (o #2 prova). Por isso:
- o cliente trata 502/503/504 sem JSON como `UPSTREAM_<status>` e a orientação ao agente é **parar o ciclo e não repetir em laço** (confira `/api/health`); teste `agent-cli.test.ts` ("borda da Vertra");
- **`DISPATCH_OFF` no #1 é INFERIDO, não observado**: vem de `flags: []` + app e banco no ar + rota viva (#2). Quando houver segredo, a leitura direta do estado é `heartbeat` (404 `LEASE_ERROR` = assinatura aceita) e `GET /api/health` (`flags`).
- Decisão possível do Backend/PM (não feita aqui): responder `DISPATCH_OFF`, `KILL_SWITCH` e `PILOT_STOPPED` com um status que a borda não substitui (ex.: 409 ou 423), para o código chegar ao agente. Hoje os testes do Backend fixam 503; é mudança de contrato.

## Decisão posterior (PM-2026-11-23-I): 423 Locked
Em resposta a este achado o PM decidiu que `DISPATCH_OFF`, `KILL_SWITCH` e `PILOT_STOPPED` no `pull` passam a **423 Locked** com o JSON e o mesmo `error.code` (503 só para indisponibilidade real); o Backend 1 fez o lado do servidor (**ft/backend `0a2e2c8`**: 423 com JSON e o mesmo `error.code` em `pull`, `heartbeat`, `io/input` e `io/result`; no despacho da Fábrica só `KILL_SWITCH`/`PILOT_STOPPED`, o `DISPATCH_OFF` do despacho segue 409; 503 só para indisponibilidade real) e a Integration o cliente (ft/growth `fede270`). **Cliente (ft/growth):** 423 mantém o código da API e marca `stop: true` (parar o ciclo, sem repetir); `UPSTREAM_502/503/504` também `stop`. **A evidência acima é de ANTES da mudança do servidor** (a int/012 do staging responde 503): repetir com o servidor novo deve dar 423 `DISPATCH_OFF` no `pull` com o despacho desligado, para quem assina corretamente (desde a ft/backend `59eed1b` o `pull` confere a assinatura ANTES: sem o segredo, ou com o valor falso, dá 401).

## Atualização de 24/11/2026 (06:23 UTC): staging na `1548e30` (int/013 + ft/infra)
Mesmo procedimento (valor falso; nada gravado; nenhum agente criado), agora com o comando `smoke` e um `pull` manual:
| Chamada | Resposta | Leitura |
|---|---|---|
| `GET /api/health` | 200, `version: 1548e30…`, `env: staging`, `flags: []` | no ar; nenhuma flag ligada (`openbotDispatch` desligada) |
| `smoke --expect-dispatch off` | health PASS, flag PASS (desligada), assinatura (`heartbeat` e `io/input`) FAIL `401 sem_segredo` | as rotas existem e **falham fechado**: o staging ainda **não tem `OPENBOT_HMAC_SECRET`** (pendência do PM, passo (c)) |
| `pull` manual | HTTP **503** mascarado pela borda (`UPSTREAM_503` no cliente) | **esperado nesta versão**: a `1548e30` contém o gateway unificado (`dcd6d30`), mas **NÃO** contém o servidor com 423 (`0a2e2c8`) **nem** a conferência da assinatura antes do 423 (`59eed1b`) (conferido com `git merge-base --is-ancestor`) |
Conclusão: o 423 Locked só chegará ao staging na próxima integração que levar a ft/backend `0a2e2c8` e `59eed1b`; até lá o `pull` com o despacho desligado continua 503 mascarado e o cliente trata como "parar o ciclo".

## Atualização de 24/11/2026 (~10:30 UTC): staging na `051a828` (ft/integracao-d20d47f, merge de ft/infra `f6a181f`)
O app web do staging (`ln-staging-web`, `https://loyaltynews-stg.vertraweb.app`) foi reimplantado às 10:21 UTC. Mesmo procedimento (valor falso; nada gravado; nenhum agente criado):
| Chamada | Resposta | Leitura |
|---|---|---|
| `GET /api/health` | 200, `version: 051a828…`, `env: staging`, `flags: []` | no ar; nenhuma flag ligada (`openbotDispatch` desligada) |
| `smoke --expect-dispatch off` | health PASS, flag PASS (desligada), assinatura (`heartbeat` e `io/input`) FAIL `401 sem_segredo` | o staging **ainda não tem `OPENBOT_HMAC_SECRET`** (pendência do PM); falha fechada |
| `pull` manual | HTTP **401** `UNAUTHORIZED: assinatura recusada: sem_segredo` (não é mais o 503 mascarado) | **esperado nesta versão**: a `051a828` contém `0a2e2c8` (423 Locked) **e** `59eed1b` (o `pull` confere a assinatura ANTES de responder 423 `DISPATCH_OFF`) (conferido com `git merge-base --is-ancestor`); sem o segredo o `pull` já dá 401 como as demais rotas |
Conclusão: o servidor com o 423 chegou ao staging. O `423 DISPATCH_OFF` do `pull` **ainda não foi observado** (precisa do segredo HMAC real no staging e no cofre do agente); com ele, o `pull` com o despacho desligado deve dar 423 e a sonda do `smoke`, 404 `LEASE_ERROR`. A `051a828` **não contém** o cliente com `smoke` (ft/growth `391ae8a`): o comando roda aqui a partir do worktree da ft/growth.

## O que continua não verificado (precisa do segredo no staging, passo (c) do PM)
- `heartbeat` com o segredo REAL: 404 `LEASE_ERROR` (assinatura aceita), e 401 com um segredo diferente.
- `pull` com o despacho LIGADO (`LN_FLAGS_ON=openbotDispatch`) e o piloto (`LN_OPENBOT_PILOT=1`): só depois dos itens 5 e 6 do checklist (`ATIVACAO-STAGING.md` §0.2) e do sinal do PM.
- Que um agente do OpenBot real rode `node` e alcance o HTTPS do staging (esta evidência foi gerada pelo mesmo cliente, rodando na máquina do OpenBot onde a Integration trabalha, o que mostra que o caminho de rede até o staging existe a partir daqui).
