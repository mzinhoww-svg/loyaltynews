# Contrato do ledger de orçamento persistente (gate G4)

Proposta da Frente 07 (AgentOps) para o Backend/FinOps implementarem em `@ln/modelops` + `@ln/db`. **Nada em `modelops` nem em `db` foi alterado.** O código executável do contrato está em `packages/agents/src/ledger-contract/`; esta nota explica o porquê e o que o Backend precisa decidir.

## 1. Por que o ledger atual não serve para produção

Fatos medidos em 23/11/2026 sobre `ft/agents` 4f589da (sonda: `LN_LEDGER_PROBE=1 npx vitest run packages/agents/src/ledger-contract`):

- O `BudgetGate` só serializa com um lock **em memória do processo** (`chain` de promises). Com dois processos sobre o mesmo ledger (OpenBot + worker próprio, ADR-003), dois gates sobre o mesmo store aceitaram **8 de 8** reservas de US$ 5 contra a verba da Anthropic de **US$ 22** (US$ 40 reservados) e geraram **`id` de reserva e `seq` repetidos** (`r-1`, `r-3`, `r-5`, `r-7` duas vezes).
- Causa: `seq = readAll().length + 1` e `id = r-${seq}` são derivados de uma leitura que outro processo pode invalidar; a checagem do teto (replay) e a gravação não são atômicas.
- Em um único processo o gate é correto (os testes do modelops passam). O defeito é de **concorrência entre processos e de reinício concorrente**.

## 2. Interface (`contract.ts`)

```ts
interface AtomicLedgerStore extends LedgerStore {                  // LedgerStore = append/readAll atuais
  transact<T>(monthKey: string, fn: (tx: LedgerTx) => Promise<T>): Promise<T>;
  readAllStored(): Promise<readonly StoredLedgerEvent[]>;          // em ordem de seq
}
interface LedgerTx {
  readonly monthKey: string;
  readMonth(): Promise<readonly StoredLedgerEvent[]>;              // inclui os appends da própria transação
  append(e: NewLedgerEvent): Promise<StoredLedgerEvent>;          // idempotente por idempotencyKey; seq do banco
}
```

- `transact` = `BEGIN`; exclusão mútua **por mês entre processos** (`pg_advisory_xact_lock(hashtext('ln-ledger:'||month))` ou `SELECT … FOR UPDATE` numa linha de `ledger_months`); `COMMIT`; qualquer erro = `ROLLBACK` (nenhum `append` vale).
- O `BudgetGate` deve fazer **leitura do mês, checagens e `append` dentro de UMA `transact`**, e não mais `readAll().length + 1`. O `id` da reserva passa a vir da chave de idempotência/uuid, nunca de contagem.
- `append`/`readAll` do `LedgerStore` base continuam (compatibilidade): equivalem a uma transação de um evento; o `seq` do chamador é ignorado.

## 3. Eventos e invariantes (`validateEventShape`, `checkTransition`)

| Evento | Exige | Transição |
|---|---|---|
| `reserve` | taskId, taskClass, pool, lane, provider, model, escalation (bool), amountMicro | só para `reservationId` novo |
| `pending` | reason | só de `open` (no máximo 1) |
| `commit` | actualMicro, overrun (bool) | de `open` ou `pending`; terminal |
| `release` | reason; **evidence** se a reserva estava `pending` | de `open` ou `pending`; terminal |
| `refill_fee` | amountMicro; `reservationId` com prefixo `fee-` | fora do teto; sem reserva |

Todos: `monthKey` AAAA-MM; valores em micro-USD **inteiros ≥ 0** (`Number.isSafeInteger`); `at` ISO válido; `idempotencyKey` ≥ 8 caracteres; evento de outro mês dentro da transação é conflito; evento de uma reserva em mês diferente do da reserva é conflito. **No banco** essas regras viram `CHECK`, índices únicos parciais (1 `reserve`, ≤ 1 `pending`, ≤ 1 terminal por `reservation_id`) e trigger de transição; a aplicação repete a validação (defesa em profundidade).

Gasto do mês (`monthSpentMicro`): aberta/pendente pesa o **reservado** (resultado incerto conta no teto), comprometida pesa o **real**, liberada zero; `refill_fee` não entra.

`seq`: único e crescente, atribuído pelo banco (`identity`/`bigserial`); **lacunas são permitidas após ROLLBACK**.

## 4. Encaixe com as tabelas que já existem em `@ln/db` (`budget_reservations`, `budget_ledger`)

O modelo atual do banco (Backend) é **outro** que o do modelops:

| Necessário ao `BudgetGate` | `budget_*` hoje | Lacuna |
|---|---|---|
| estado `pending` (resultado incerto, sem fallback) | `reservation_state`: reservada/conciliada/liberada/recusada | **não existe** |
| pool (`allocation`/`reserve`), lane, taskClass, escalation | ausentes | **não existem**: sem eles não há soma por provedor, escalonamento (US$ 5) nem reserva de auditoria (US$ 8) |
| `overrun`, `evidence`, `reason` | ausentes | não existem |
| `refill_fee` | `ledger_kind`: reserva/conciliacao/liberacao | não existe |
| `seq` monótono | `id text` | sem ordem do banco |
| micro-USD | `integer` (int4, máx. ≈ US$ 2.147) | cabe (teto US$ 50); `bigint` é mais seguro para somas |

Duas saídas; **o Backend escolhe** (pergunta aberta Q1):

- **(A) tabela de eventos nova**, espelhando `LedgerEvent` (event sourcing, como o modelops já faz) e mantendo `budget_*` como projeção/relatório. Esboço (não aplicado):

```sql
CREATE TABLE model_ledger_events (
  seq              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key  text NOT NULL UNIQUE CHECK (length(idempotency_key) >= 8),
  at               timestamptz NOT NULL,
  month_key        text NOT NULL CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  type             text NOT NULL CHECK (type IN ('reserve','pending','commit','release','refill_fee')),
  reservation_id   text NOT NULL,
  task_id text, task_class text, pool text, lane text, provider text, model text, escalation boolean,
  amount_micro bigint CHECK (amount_micro >= 0), actual_micro bigint CHECK (actual_micro >= 0),
  overrun boolean, reason text, evidence text
);
CREATE UNIQUE INDEX ON model_ledger_events (reservation_id) WHERE type = 'reserve';
CREATE UNIQUE INDEX ON model_ledger_events (reservation_id) WHERE type = 'pending';
CREATE UNIQUE INDEX ON model_ledger_events (reservation_id) WHERE type IN ('commit','release');
-- trigger BEFORE UPDATE/DELETE → RAISE EXCEPTION (append-only, como budget_ledger)
-- trigger BEFORE INSERT → checkTransition no SQL (defesa em profundidade)
```

- **(B) estender `budget_*`** com `pending`, pool/lane/taskClass/escalation, overrun/evidence/reason e `refill_fee`. Mais invasivo para quem já usa as tabelas.

## 5. Suíte de aceitação (critério do G4) — `acceptance.ts`

Cada caso roda contra um banco novo; o Backend usa `defineLedgerAcceptance` (`acceptance.vitest.ts`) sobre o `PgLedgerStore` com PGlite.

| Caso | O que prova | O que o PostgreSQL precisa fazer |
|---|---|---|
| A01 | `seq` do armazenamento, único e crescente | identity/bigserial |
| A02 | evento malformado rejeitado e nada gravado | CHECKs + validação |
| A03 | transições ilegais recusadas (reserve duplicada, commit duplo, release após commit, pending duplo, release de pendente sem evidência…) | índices únicos parciais + trigger |
| A04 | idempotência entre processos; mesma chave com conteúdo diferente = conflito | `UNIQUE(idempotency_key)` + comparação |
| A05 | erro na transação desfaz tudo | BEGIN/ROLLBACK numa conexão |
| A06 | isolamento por mês; evento de outro mês é conflito | lock e `month_key` por transação |
| A07 | 200 reservas concorrentes de dois processos contra teto de US$ 10: exatamente 100 aceitas, 0 estouros | exclusão mútua por mês |
| A08 | outro handle reconstrói o mesmo estado e gasto | nada em memória do processo |
| A09 | `refill_fee` registrada e fora do teto | evento próprio |
| A10 | `UPDATE`/`DELETE` crus rejeitados | triggers (precisa de SQL cru: `tamper`) |
| A11 | `append/readAll` do `LedgerStore` base seguem valendo | compatibilidade |
| A12 | o `BudgetGate` atual funciona sobre o armazenamento (reserva, conciliação, recusa por degrau) | substituição direta |

A suíte tem **dentes**: três armazenamentos defeituosos de referência (sem exclusão mútua, sem rollback, sem idempotência) são reprovados exatamente nos casos A07, A05 e A04 (`ledger-contract.test.ts`). A implementação de referência em memória (`memory-atomic.ts`) passa A01–A09 e A11–A12; **A10 fica "skipped" fora de PostgreSQL** (`tamper` ausente) e só conta no G4 se rodar de verdade.

## 6. O que o Backend precisa decidir ou fazer (perguntas)

1. **Q1** — (A) tabela de eventos nova ou (B) estender `budget_*`?
2. **Q2** — `BudgetGate` passa a usar `transact` e a gerar `reservationId` por chave/uuid? (Sem isso o G4 não fecha, mesmo com o `PgLedgerStore` pronto.)
3. **Q3** — Mecanismo de exclusão mútua: advisory lock por mês ou linha `ledger_months` com `FOR UPDATE`? (Ambos passam em A07; PGlite é monoprocesso, então A07 em PGlite prova a lógica, **não** a concorrência real do PostgreSQL — o teste final de concorrência precisa de PostgreSQL de verdade, no staging, G3.)
4. **Q4** — Onde fica a suíte: copiar `src/ledger-contract/` para `packages/modelops/` (dono do código) ou manter em `@ln/agents`? A dependência `modelops → agents` é invertida; sugerimos mover.
5. **Q5** — A reconciliação mensal (limite de 1%) e a sonda de `/generation` para provar não cobrança continuam pendentes e **não fazem parte** deste contrato.

## 7. Limites desta proposta

- A suíte prova o **contrato**, não uma implementação PostgreSQL: não existe `PgLedgerStore`.
- A concorrência A07 usa um único processo Node com dois handles; só o teste em PostgreSQL real, com dois processos, prova a exclusão entre processos.
- Os limiares marcados "(proposta)" nos gates são sugestões da Frente 07.
