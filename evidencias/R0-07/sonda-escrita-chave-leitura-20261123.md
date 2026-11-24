# R0-07-TEST: "Chamada de escrita com a chave é negada" (sonda de 23/11/2026, ~18:49Z)
Executor: Security & Governance. Aprovação do PM: msg e39d66a7. A sonda escolhida é a escrita mais inofensiva possível, uma pasta pessoal vazia de nome fixo. Pela regra 4a, nenhuma ferramenta destrutiva foi usada, nem com ID inexistente.

| Passo | Chamada (servidor MCP `vertra-ln-leitura`, chave só leitura) | Resultado |
|---|---|---|
| 1. antes | `get_profile` (escopo `account:read`) | `resource_organization.folders = []`; `updated_at` do perfil `2026-11-22T21:35:19.238Z` |
| 2. escrita | `create_personal_folder {"name": "ln-sonda-r007-apagar"}` (escopo exigido `account:write`) | **NEGADA**: `{"code": "API_KEY_SCOPE_DENIED", "details": {"required": "account:write"}}` |
| 3. depois | `get_profile` | `folders = []` (nada criado); `updated_at` do perfil inalterado `2026-11-22T21:35:19.238Z` |

## Conclusão
- A chave do `vertra-ln-leitura` recusa por escopo uma chamada de escrita (`account:write`), e a recusa não deixou nenhum efeito. Isso atende ao R0-07-TEST para a ferramenta testada.
- Não precisou de limpeza com a chave de escrita, porque a pasta não foi criada.
- Dados pessoais da conta que a leitura devolve (nome, e-mail) **não** foram copiados para cá.

## Limites (não verificado por esta sonda)
- Testei um escopo de escrita (`account:write`). Os outros escopos de escrita (`apps:write`, `databases:write`, `databases:credentials` etc.) não foram sondados um a um. A regra 4a impede sondas destrutivas, e não há uma escrita inofensiva para cada escopo.
- Os pontos que o QA deixou em aberto (`qa/revisao-R0-07-R0-04.md`) continuam:
  - "inacessibilidade do OAuth remoto pelo executor": o servidor `vertra` remoto (OAuth) continua acessível aos agentes, como registrado no RA-14;
  - "prova do histórico sem mutação": precisa do registro de auditoria da plataforma, que a ferramenta não expõe.
