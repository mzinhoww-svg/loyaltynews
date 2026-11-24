# Teste de escopo — Vertra só leitura (evidência proposta para F-055 / R0-07)
Executado por: Security & Governance, a pedido do Program Manager, em 22/11/2026, por volta das 17:40 (horário de Brasília, -03:00). Vai para revisão independente (QA). Não é aceite.

## Configuração testada
- Servidor MCP **local** `vertra-ln-leitura` (`@vertracloud/mcp` 0.3.7, configurado pelo PM). A chave entra só pela variável `VERTRA_API_KEY`, lida do cofre (`LN_VERTRA_RO_API_KEY`) por um wrapper.
- Chave `ln-r0-inventory-ro`, criada pelo proprietário com escopos `*:read`. **O valor não foi lido, impresso nem registrado.** Os escopos exatos da chave não foram vistos por mim; foram inferidos das respostas abaixo.
- O servidor remoto `vertra` (OAuth) **não foi usado**.

## Resultados (log saneado)
| # | Ferramenta | Alvo | Escopo exigido | Resultado | Leitura |
|---|---|---|---|---|---|
| P1 | `list_apps` | conta | `apps:read` | OK: 5 aplicações, todas `running: true` | Positivo: leitura funciona |
| P2 | `list_databases` | conta | `databases:read` | OK: 1 banco, `running: true` | Positivo: leitura funciona |
| N1 | `restart_app` | id `00000000-0000-0000-0000-000000000000` (inexistente; ausente da P1) | `apps:write` | `API_KEY_SCOPE_DENIED`, `details.required: apps:write` | Negativo: escrita recusada |
| N2 | `set_env` (`key=LN_SCOPE_PROBE`, valor inócuo) | mesmo id inexistente | `apps:envs` | `API_KEY_SCOPE_DENIED`, `details.required: apps:envs` | Negativo: variáveis de ambiente recusadas |
| N3 | `update_app_config` (`name=ln-scope-probe`) | mesmo id inexistente | `apps:write` | `API_KEY_SCOPE_DENIED`, `details.required: apps:write` | Negativo: escrita recusada |
| ~~N4~~ | `delete_app` | mesmo id inexistente | `apps:delete` | `API_KEY_SCOPE_DENIED` | **Fora da regra; não usar como evidência** (R0-07 proíbe operação destrutiva; regra 4a do estatuto, 22/11/2026) |
| C1 | `list_apps` (controle depois dos negativos) | conta | `apps:read` | Mesmas 5 aplicações, todas `running: true` | Nenhuma mudança visível |

Identificadores e nomes de recursos da conta foram omitidos deste log de propósito: não são necessários para a prova.

## Conclusão
- **Conclusivo para os escopos testados.** As três tentativas de escrita válidas (N1–N3) foram recusadas **por escopo**, e não por "recurso não encontrado". A Vertra checa o escopo antes de procurar o recurso, o que fecha a lacuna marcada como não verificada na matriz v1/v2. Escrita, variáveis de ambiente e exclusão de aplicações estão fora da chave.
- Nenhuma mutação era possível: todos os alvos de escrita usaram um ID inexistente, e a recusa veio antes da busca.
- Isso cobre a parte "chave de escrita negada" de F-055 / R0-07. **F-055 continua aberto** até a evidência ser revisada pelo QA e aceita pelo verificador. Faltam o inventário saneado, as respostas às 12 perguntas e a tag.

## Observações para o QA
- A resposta de C1 saiu idêntica byte a byte à de P1, inclusive `uptime` e rede. Isso indica um status em cache e **não** serve como prova independente de "nenhum restart". A prova de que não houve efeito é a recusa por escopo sobre um alvo inexistente.
- **N4 desconsiderado (decisão do QA/PM, 22/11/2026):** `delete_app`, mesmo contra ID inexistente, contraria o R0-07 ("não invocar operação destrutiva"). Falha de processo registrada; regra 4a do estatuto: nunca invocar ferramenta destrutiva, nem em ID inexistente. A conclusão acima se apoia só em N1–N3.
- F-055 segue aberto até: bloqueio de ferramentas de escrita no cliente, isolamento efetivo do OAuth remoto (ato do proprietário), inventário R0-07 formal e aceite externo.
- Não testados: `databases:*` de escrita/exclusão, `databases:credentials`, `apps:files`, `blob:write`, `billing:*`, `workspaces:*`. Se o QA quiser, usar o mesmo método (ID inexistente).
- O catálogo continua listando 141 ferramentas, incluindo as de escrita. A barreira é a chave, não o cliente. O pedido de R0-07 de "negar ferramentas de escrita no cliente" segue não atendido (não verificado se o OpenBot permite isso).
