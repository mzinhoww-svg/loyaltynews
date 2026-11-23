# 08 — Observabilidade e persistência

| Estrutura (Diretiva §13) | Onde |
|---|---|
| Benchmark runs | `data/runs/<runId>/` (attempts.jsonl, report.json, report.md) |
| URL samples | `data/dataset.json` (+ `dataset-v1.1-changes.json`) |
| Provider attempts / extraction results / quality evaluations | `attempts.jsonl` (um `AttemptRecord` por linha) |
| Provider costs | `checkpoints/ledger.json` (por produto e por `produto|conta`, alertas) no diretório compartilhado do bot |
| Domain-provider statistics | `report.json` → `domainMatrix` |
| Routing decisions | `AdaptiveRouter.log` / `RouteOutcome.decisions` (passo, provedor, motivo, horário) |
| Audit events | `logs/<runId>.log` (uma linha por tentativa) |
| Descoberta | `data/discovery-metrics.json` |

Cada tentativa tem `correlationId` (UUID), `runId`, `experimentId`, `codeVersion` (SHA), horário, provedor, URL, duração, resultado, erro classificado, custo, estado do cache.

## Status do bot

`C:\Users\mazin\OpenBot\Shared\loyalty-news\scraping-benchmark\status.json` (campos da seção 7 do Prompt-Mestre). Estado `RUNNING` só enquanto o processo destacado da rodada existe; entre turnos sem processo, `PAUSED`. Heartbeat = `lastHeartbeat`, atualizado a cada turno e a cada checkpoint.

Checkpoint da rodada: `checkpoints/<runId>.json` a cada 10 tentativas (tentativas, último horário, ledger). Reinício: rodar o mesmo `runId`; pares já gravados são pulados.

Retenção: os registros não têm texto integral; podem ser mantidos. Segredos: nunca registrados.
