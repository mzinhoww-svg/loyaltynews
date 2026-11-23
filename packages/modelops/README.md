# @ln/modelops

Gateway de modelos do Loyalty News (frente 11, ModelOps/FinOps). Código determinístico. **Sem chamadas reais por padrão.**

Base: `model.policy` v5 (`r0-preparacao/arquitetura/model.policy.proposto-DP02-v5.json`, aprovada pelo QA; cópia em `fixtures/`), ADR-006, ADR-013 e ADR-015. Schema da política em `@ln/contracts` (`ModelPolicy`); validador local acrescenta as invariantes de segurança.

## O que tem

- `policy.ts`: carregador e validador da política. Falha fechada (teto 50, invariantes de segurança, verbas somando o teto, degraus, rotas consistentes, OpenRouter só para classe pública).
- `money.ts`, `month.ts`: aritmética em micro-USD inteiro; mês de contagem em America/Sao_Paulo.
- `budget.ts`: portão de orçamento. Reserva antes da chamada, serializada por lock. Degraus 35/40/42/50, verbas por provedor (openai 20, anthropic 22, deepseek 0), sublimite de escalonamento de 5, reserva de 8 exclusiva de auditoria. Estados: aberta, **pendente** (resultado incerto, conta no teto), comprometida, liberada.
- `ledger.ts`: ledger append-only com replay. Interface `LedgerStore`; a implementação em memória é para testes.
- `router.ts`: roteamento por tarefa e classe de dado; bloqueia por falta de qualificação, verba zero, preço vencido, ZDR, autor distinto no fact-check, escalonamento sem motivo.
- `pricing.ts`: estimativa da reserva por faixa de preço, arredondada para cima.
- `openrouter.ts`: contrato do cliente, corpo da requisição (sempre `data_collection: deny`), checagem de evidência e `ProviderRejectedError` (rejeição com status sem cobrança).
- `openrouter.mock.ts`: cliente simulado, marcado `SIMULADO`, sem rede.
- `openrouter-client.ts`: seleção do cliente. Real só com a flag `modelosHabilitados` (de `@ln/contracts`, desligada por padrão) **e** a chave. Também o leitor de saldo.
- `balance.ts`: portão de saldo do provedor (DP-14). Lê o saldo antes da primeira chamada e a cada N retenções; recusa o que não cabe; fecha se a leitura falhar.
- `gateway.ts`: encadeia saldo, reserva, chamada, evidência, autor e conciliação. Também `reconcilePending`.

## Regra de falha (parecer QA)

- Rejeição com status que **garante não cobrança** (400, 401, 402, 403, 404, 422, 429): libera a reserva e pode usar o fallback lateral da mesma classe.
- **Qualquer outro erro depois do envio** (timeout, rede, 5xx, resposta ilegível): a reserva vira **pendente**. Conta no teto, **sem fallback automático**, sem liberar.
- Pendente só sai com evidência: `reconcilePending` com cobrança confirmada (fecha pelo custo real) ou com evidência de não cobrança (libera). Sem prova, continua pendente.

## Como rodar

Na raiz do monorepo (npm workspaces):

```
npm install
npm test            # vitest, todos os pacotes
npm run typecheck   # tsc estrito
npm run lint        # eslint
```

Testes do pacote: `packages/modelops/src/*.test.ts`. Cobrem a regressão de falha depois do envio, conciliação, saldo e a virada de mês.

## Não feito neste pacote (fica para R2-07/08 ou para o verificador)

- **Saldo do OpenRouter:** `GET /api/v1/credits` responde à chave comum de API (confirmado pelo PM em 22/11, DP-05 e DP-14). O leitor (`createOpenRouterCreditsReader`) usa essa chave. Pendente: quem constrói o `BalanceGuard` na composição do produto precisa injetar esse leitor; o pacote não faz isso sozinho.
- Persistência: `PostgresLedgerStore` (`budget-pg.ts`) grava nas tabelas de orçamento de `@ln/db` (migração `0005_budget_pendente_killswitch.sql`, gerada a partir do schema e pendente de revisão do arquiteto no merge). Cada operação roda numa transação com `pg_advisory_xact_lock`, então processos diferentes não estouram o teto. Testado em PGlite, incluindo restart. A conexão de produção (node-postgres, TLS) não está configurada aqui.
- Consulta de conciliação real: `reconcilePending` recebe uma sonda. Não há sonda implementada contra `/generation`; para falha incerta sem identificador de geração, a prova de não cobrança ainda não existe.
- Conciliação mensal com as gerações do OpenRouter (limite proposto de 1%).
- Evidência completa de geração: o endpoint de chat não traz `generation`; é preciso consultar `/generation`. Sem isso, a saída é bloqueada (falha fechada).
- Qualificação de modelos: nenhum modelo está qualificado por padrão. ZDR por modelo não verificado.
- Auditoria (`wf08_correction`, `wf18_response_retraction`, `postpublication_audit`) e `editorial_review` seguem a v5: rota `review`, autor diferente do conteúdo, reserva de 8 só acima de 42. Com redator Anthropic, a revisora é OpenAI. A despublicação é determinística e não passa pelo gateway.
- Kill switch: persistido em `budget_kill_switch` e lido a cada chamada. Acionamento sem agente (R2-14) ainda não tem interface própria.
- Tipos da política: a estrutura é validada pelo schema de `@ln/contracts` (`ModelPolicy`). Os tipos de trabalho (`types.ts`) continuam locais porque o contrato não modela campos como verbas e degraus como objeto tipado. Pedir ao Chief Architect para ampliar o schema, se quiser eliminar a duplicação.
- A chamada real ao OpenRouter não foi exercitada: os testes usam fetch injetado.
