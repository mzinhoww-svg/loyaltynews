# @loyalty-news/modelops

Gateway de modelos do Loyalty News (frente 11, ModelOps/FinOps). Código determinístico. **Sem chamadas reais por padrão.**

Base: `model.policy` v4 (`r0-preparacao/arquitetura/model.policy.proposto-DP02-v4.json`, cópia em `fixtures/`), ADR-006, ADR-013 e ADR-015.

## O que tem

- `policy.ts`: carregador e validador da política. Falha fechada (teto 50, invariantes de segurança, verbas somando o teto, degraus, rotas consistentes, OpenRouter só para classe pública).
- `money.ts`, `month.ts`: aritmética em micro-USD inteiro; mês de contagem em America/Sao_Paulo.
- `budget.ts`: portão de orçamento. Reserva antes da chamada, serializada por lock. Degraus 35/40/42/50, verbas por provedor (openai 20, anthropic 22, deepseek 0), sublimite de escalonamento de 5, reserva de 8 exclusiva de auditoria.
- `ledger.ts`: ledger append-only com replay. Interface `LedgerStore`; a implementação em memória é para testes.
- `router.ts`: roteamento por tarefa e classe de dado; bloqueia por falta de qualificação, verba zero, preço vencido, ZDR, autor distinto no fact-check, escalonamento sem motivo.
- `pricing.ts`: estimativa da reserva por faixa de preço, arredondada para cima.
- `openrouter.ts`: contrato do cliente, corpo da requisição (sempre `data_collection: deny`) e checagem de evidência.
- `openrouter.mock.ts`: cliente simulado, marcado `SIMULADO`, sem rede.
- `openrouter-client.ts`: seleção do cliente. Real só com `LN_MODELOPS_REAL_CALLS=1` **e** `OPENROUTER_API_KEY`.
- `gateway.ts`: encadeia roteamento, reserva, chamada, evidência, autor e conciliação.

## Como rodar

```
cd packages/modelops
node --test "test/**/*.test.ts"
```

Node 26 (type stripping nativo). Sem dependências.

## Não feito neste pacote (fica para R2-07/08 ou para o verificador)

- Persistência em PostgreSQL: a interface `LedgerStore` existe; a transação com bloqueio de linha ainda não.
- Conciliação mensal com as gerações do OpenRouter (limite proposto de 1%).
- Evidência completa de geração: o endpoint de chat não traz `generation`; é preciso consultar `/generation`. Sem isso, a saída é bloqueada (falha fechada).
- Qualificação de modelos: nenhum modelo está qualificado por padrão. ZDR por modelo não verificado.
- Mapeamento provisório de WF08, WF18 e auditoria para a rota `review` (confirmar com o Chief Architect).
- Kill switch persistido no banco e acionável sem agente (R2-14).
- Typecheck estrito (`tsc`) não rodado: não há compilador instalado no ambiente. Os testes rodam com o type stripping do Node.
