# Piloto de 10 matérias pelo OpenBot (DP-41, só staging): o que a Fábrica faz e o que falta fiar

Pedido: Integration (checklist `packages/openbot/docs/ATIVACAO-STAGING.md` §0.2, itens 3 e 4, ft/growth 7fe507b). Nada liga o piloto sozinho: precisa de `APP_ENV=staging` **e** `LN_OPENBOT_PILOT=1`.

## Item 3 — gateway do OpenBot no lugar do de modelops

- `runEditorialFactory` e `runEditorialAutoral` aceitam `modelGateway` (um `ModelGateway` pronto) e `pilotSink`; com `modelGateway` o gateway de modelops não é montado. A chave de idempotência continua **`<matéria>:<classe>:<tentativa>`** (não mudou).
- `loadPilotWiring(env)` (`apps/workers/src/editorial-factory.ts`) só age com `LN_OPENBOT_PILOT=1`; fora de `APP_ENV=staging` **recusa** (DP-41). Importa o módulo de fiação (`LN_OPENBOT_PILOT_WIRING`, padrão `@ln/openbot-wiring`) e chama `createPilotWiring(env): Promise<{ gateway: ModelGateway; sink?: PilotRowSink }>`. **Esse módulo é da Integration/Backend** (monta `OpenBotModelGateway` com `PgTaskIo`, fila, ledger, flags e o `PgPilotRowStore`); o Editorial não depende dos pacotes deles. Ligado e sem o módulo, o job **recusa começar**.
- **`reviewedDraftTaskId` (id da TAREFA, não do rascunho):** a checagem e a revisão recebem `input.reviewedDraftTaskId` = id da tarefa que produziu o rascunho avaliado, **tal como o gateway o devolveu** na resposta da redação (`taskId`). Para isso o `OpenBotModelGateway` precisa devolver `taskId` (e `attempt`) na resposta `ok: true` (campos opcionais já aceitos pelo tipo `GatewayResponse` da Editorial). Sem `taskId`, o campo **não é enviado** (nenhum id inventado) e a linha fica pendente. `input.reviewedDraft = { taskId, draftId, sha256 }` continua indo (com o mesmo `taskId`, ou o derivado `<matéria>:draft:<tentativa>` quando o gateway não informa). A `review` ainda recusa (`stale_approval`) se o hash do rascunho mudou depois da checagem.

## Item 4 — veredito na linha do piloto

- `PilotRowSink.patch({ taskId, attempt, stage, patch })` é chamado pelos estágios, **depois** do gate, com a tarefa e a tentativa que o gateway devolveu: `output_valid` em cada tarefa (triagem, contexto, redação, checagem, revisão; esquema da classe, `docs/schemas-saida-por-classe.json`); e `{ gate_verdict, gate_reasons }` na redação (`approved` com `gate_reasons: []`; `blocked` com os motivos do gate determinístico, ex.: `copy_literal`, `unsupported_claim`; a matéria barrada na redação não é refeita) e `{ gate_verdict, gate_reasons, cross_provider_ok }` na checagem e na revisão (`approved` com `gate_reasons: []`; `blocked` com `unsupported_claim`, `cross_provider_check_failed` ou `approval_missing`).
- `pilotRowSinkFrom(rows, applyRowPatch)` (`pipeline/pilot-sink.ts`) é o sink real: acha a linha `(task_id, attempt)`, confere o patch com `applyRowPatch` (@ln/agents: recusa campo de medição e linha contraditória) e só então chama `rows.patch`. A Integration o monta em `createPilotWiring` com `PgPilotRowStore` e o `applyRowPatch` real.
- **Melhor esforço:** falha ao gravar (linha ainda inexistente, patch recusado) vira auditoria `pilot_row_patch_failed` e a linha fica pendente; **nunca** muda o gate nem derruba o job. Por isso o adaptador precisa **gravar a linha ao concluir a tarefa, antes de devolver o resultado ao gateway**; senão o patch encontra a linha ausente.
- **`unsupported_facts/high/medium/low`** não são da Fábrica: vêm da leitura humana (`docs/piloto-leitura-api.md`); o operador as grava na linha depois da leitura (ou o Backend o faz a partir de `piloto.leitura`).

## Testes

`packages/editorial/src/tests/piloto-openbot.test.ts` (6) e `apps/workers/src/editorial-factory.pilot.test.ts` (1). **Não verificado:** o OpenBot real, o `PgPilotRowStore` real (testado com um armazém simulado de mesmo contrato), o módulo de fiação (não existe nesta branch).
