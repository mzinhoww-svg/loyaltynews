# @ln/modelops

Gateway de modelos do Loyalty News (frente 11, ModelOps/FinOps). Código determinístico. **Sem chamadas reais por padrão.**

Base: `model.policy` v4 (`r0-preparacao/arquitetura/model.policy.proposto-DP02-v4.json`, cópia em `fixtures/`), ADR-006, ADR-013 e ADR-015.

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

- **Saldo do OpenRouter:** o endpoint `GET /api/v1/credits` exige **chave de gestão** (Management key), não a chave comum de API. Com a chave LN atual o leitor falha e o portão fecha (`balance_unknown`), o que é seguro mas inoperante. Falta o dono decidir: criar uma chave de gestão separada, guardada fora do código, ou informar o saldo manualmente.
- Persistência em PostgreSQL: a interface `LedgerStore` existe; a transação com bloqueio de linha ainda não. A exclusão mútua atual vale só dentro de um processo.
- Consulta de conciliação real: `reconcilePending` recebe uma sonda. Não há sonda implementada contra `/generation`; para falha incerta sem identificador de geração, a prova de não cobrança ainda não existe.
- Conciliação mensal com as gerações do OpenRouter (limite proposto de 1%).
- Evidência completa de geração: o endpoint de chat não traz `generation`; é preciso consultar `/generation`. Sem isso, a saída é bloqueada (falha fechada).
- Qualificação de modelos: nenhum modelo está qualificado por padrão. ZDR por modelo não verificado.
- Mapeamento provisório de WF08, WF18 e auditoria para a rota `review` (confirmar com o Chief Architect). Pela v4, a correção WF08 com redator Anthropic não tem revisor elegível e bloqueia.
- Kill switch persistido no banco e acionável sem agente (R2-14).
- Tipos da política (`ModelPolicy`) e o schema zod ainda são locais; pedido ao Chief Architect para mover para `@ln/contracts`.
- A chamada real ao OpenRouter não foi exercitada: os testes usam fetch injetado.
