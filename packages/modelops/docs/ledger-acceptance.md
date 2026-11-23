# Suíte de aceitação do ledger persistente (G4)

Dono do código: Backend + FinOps (`@ln/modelops`). A suíte foi escrita pela Frente 07 (AgentOps) e movida para cá a pedido do PM, de acordo com o Backend, para não haver duas cópias. O contrato e a motivação estão em `packages/agents/docs/ledger-contract.md` (ft/agents); o desenho do ledger é o do ADR-020 (por estado, `LedgerStore.withLock`).

## O que há em `src/ledger-acceptance/`

| Arquivo | Papel |
|---|---|
| `contract.ts` | Interface `AtomicLedgerStore` (`transact` por mês), forma dos eventos (`validateEventShape`), tabela de transições (`checkTransition`), gasto do mês |
| `acceptance.ts` | 12 casos obrigatórios (A01–A12) e 1 opcional (A13); independente de framework; `runAcceptance` devolve o resultado por caso |
| `acceptance.vitest.ts` | `defineLedgerAcceptance(nome, harness)` para o vitest |
| `withlock-adapter.ts` | Converte `LedgerStore.withLock` em `transact` **sem acrescentar validação** e traduz SQLSTATE 23xxx |
| `memory-atomic.ts` | Referência em memória e 3 armazenamentos defeituosos de propósito (sem lock, sem rollback, sem unicidade) que a suíte deve reprovar |
| `*.reference.test.ts` | A referência passa; os defeituosos são reprovados nos casos A07, A05 e A03/A04 |
| `*.pglite.test.ts` | A suíte sobre o `PostgresLedgerStore` com PGlite e as migrações oficiais: roda **sempre** no `npm test` |
| `*.real-pg.test.ts` | **Opt-in**: PostgreSQL local real — a suíte com duas conexões, **estresse de 1.000 reservas** e **dois processos de SO** |
| `ledger-process.worker.test.ts` | Trabalhador disparado pelo teste de dois processos (só roda com `LN_G4_WORKER=1`) |

A13 (opcional) exige que o histórico de pendência sobreviva ao commit; no desenho por estado ele não sobrevive (limitação aceita no ADR-020), então falha e **não** reprova o G4.

## Como rodar no PostgreSQL local real

Nunca contra o banco de staging ou compartilhado: o teste **recusa** qualquer host que não seja loopback, cria um banco próprio (`ln_g4_<pid>_<hora>`) e o apaga no fim.

1. Suba um PostgreSQL descartável em 127.0.0.1 (ex.: `embedded-postgres`, fora do repositório; script de exemplo em `r0-preparacao/g4/harness/start-pg.mjs`, com senha aleatória a cada execução).
2. `LN_G4_REAL=1 LN_G4_PG_URL=postgres://<usuario>:<senha>@127.0.0.1:PORTA/postgres npx vitest run packages/modelops/src/ledger-acceptance`

## Resultado medido (23/11/2026, PostgreSQL 18.7 local, Windows)

- Suíte: 12 de 12 obrigatórios passam com duas conexões; só o A13 opcional falha.
- Estresse: 1.000 tentativas de US$ 0,05 em 4 conexões contra a verba Anthropic de US$ 22 → **exatamente 440 aceitas** (US$ 22,000000), 440 ids únicos, as outras recusadas por `provider_allocation_exhausted`, 6,8 s.
- Dois processos de SO (PIDs distintos, 2 conexões cada): 500 tentativas cada → **220 + 220 = 440 aceitas**, ids únicos, US$ 22,000000 no banco.

## Pendências (não são desta suíte)

- **G4.2** (replay do ledger = soma das gerações conciliadas, ≤ 1%): conciliação com `/generation`, do Backend.
- **G4.3** (saldo do provedor lido antes da primeira chamada): `BalanceGuard` injetado na composição do produto, do Backend.
- Repetir a suíte no SHA que o Backend entregar depois das correções do QA 1 (tela FinOps em memória; kill switch sem auditoria transacional e sem a trava).
- Rodar também no PostgreSQL de staging **só** quando o DevOps liberar um banco de teste próprio (G3); nunca no compartilhado.
