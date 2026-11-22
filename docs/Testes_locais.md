# R0-05 — relatório de testes locais (RC1; não homologação)
Executado em sandbox Linux, Python/Git/GnuPG, repositórios temporários e quatro chaves GPG Ed25519 descartáveis por suíte (root, executor, reviewer, verifier). As chaves foram usadas exclusivamente no teste e removidas. Nenhuma credencial/infra real. Saída literal: `test-run.txt`.

| Caso oficial §9 | Verificação efetivamente executada | Resultado local | Limitação externa |
|---|---|---|---|
| 1 | Artefato inexistente | PASS, EVIDENCE_INVALID | — |
| 2 | Conteúdo alterado após evidência | PASS, HASH_MISMATCH | — |
| 3 | Dependência sem aceite | PASS, DEP_NOT_ACCEPTED | — |
| 4 | Arquivo de aceite falso + tag assinada por executor | PASS, aceite inválido | Proteção remota da criação de tags pendente |
| 5 | `approved:true` em cada ferramenta executor | PASS, NOT_ALLOWED | Cliente real pendente |
| 6 | Duas sessões reivindicam mesma tarefa | PASS, LOCKED_BY_OTHER | Corrida de PRs em clones separados pendente |
| 7 | Reenvio da mesma evidência | PASS, versão única | — |
| 8 | Alteração de critério em commit do executor | PASS, PROTECTED_CHANGED e rejeição | GitHub deve bloquear merge e alteração de identidade; ainda não demonstrado |
| 9 | Relatório repetido sobre mesmo estado | PASS, bytes idênticos | — |
| 10 | P0 aberto relacionado à tarefa | PASS, tarefa omitida; P0_OPEN | Escopo da política real exige revisão |
| 11 | Check de fixture falha | PASS, rejeição assinada; nenhum aceite | Execução de todos os checks reais em runner isolado pendente |
| 12 | Tag de parecer do executor, mesmo provedor | PASS, rejeição | Evidência de provedor de modelo real pendente |
| 13 | Alteração de arquivo espelhando definição do verificador | PASS, PROTECTED_CHANGED | Controle externo GitHub/root e tentativa de merge pendentes |
| Extra 14 | Sequência positiva de três tarefas e gate assinados | PASS, dependências liberadas e gate reconhecido | Fixture pequena, não R0 real |
| Extra 15 | JSON-RPC stdio: initialize, tools/list, state, tentativa de aceite | PASS, 13 tools; aceite não exposto | Conectar ao Claude Code real em R0-05 |

**Resultado: 15/15 testes locais.** São exercícios do código de referência, não evidências suficientes para declarar R0-05 homologada, R0-06 homologada ou F-120 fechado. Não houve teste externo de Vertra ou GitHub. O relatório é insumo de R0-05, deverá ser reproduzido por verificador independente no commit versionado.
