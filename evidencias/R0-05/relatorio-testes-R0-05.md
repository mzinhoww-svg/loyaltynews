# R0-05: relatório de testes (casos 1 a 13 do `audit-output/06_MCP_SPEC.md` §9)
Preparado por Security & Governance em 23/11/2026.
- **Critério:** "Executor não consegue registrar aceite; relatório de gate determinístico".
- **Teste R0-05-TEST:** casos 1 a 13 de 06_MCP_SPEC §9.

## Execução
- **Árvore:** `main` do produto em `7c197d10a5b30fc8a88061c861c828ff385e9691`, num clone descartável.
- **Comando:** `python -B tests/test_governance.py -v`.
- **Arquivos:**
  - `tests/test_governance.py` sha256 `3ae1fec04a31cb8e2086e3ee2cacae316807bd572fc01d653e34b80c1e613577`;
  - `tools/gov.py` sha256 `0e679d188b4ca6f5e239058c68e24348dd10f50e9928a9db03316d6f69ca67d0`.
- **Resultado:** `Ran 15 tests … OK` (`teste-governanca-casos-1-15.txt`, sha256 `ab39d210…a98a`). Caminhos locais do clone trocados por `<clone>`.

## Caso → teste
| # (§9) | Caso | Esperado | Teste | Resultado |
|---|---|---|---|---|
| 1 | Evidência cita artefato inexistente | `EVIDENCE_INVALID` | `test_01_missing_artifact` | ok |
| 2 | Artefato alterado depois do envio | gate com `HASH_MISMATCH`, não pronto | `test_02_tamper` | ok |
| 3 | Tarefa com dependência sem aceite | `DEP_NOT_ACCEPTED` | `test_03_dependency` | ok |
| 4 | Executor cria aceite e tag com a própria identidade | aceite ausente (assinatura não é do verificador) | `test_04_forged_acceptance` | ok |
| 5 | Ferramenta chamada com `approved: true` | `NOT_ALLOWED` | `test_05_extra_argument` | ok |
| 6 | Duas sessões na mesma tarefa | a 2ª recebe `LOCKED_BY_OTHER` | `test_06_concurrent_claim` | ok |
| 7 | Reenvio da mesma evidência | nenhuma versão nova | `test_07_idempotent` | ok |
| 8 | PR do executor altera critério ou `identities.yaml` | verificação falha, merge bloqueado | `test_08_protected` | ok |
| 9 | Relatório do gate duas vezes no mesmo commit | saídas idênticas | `test_09_deterministic` | ok |
| 10 | P0 aberto no escopo | `gov_next_tasks` não oferece | `test_10_p0` | ok |
| 11 | Gate com teste exigido falhando | não assina aceite; rejeição com motivo | `test_11_fail_test` | ok |
| 12 | Parecer da mesma identidade/provedor do executor | parecer recusado, gate não avança | `test_12_independent` | ok |
| 13 | PR do executor altera pipeline, checker ou caminhos protegidos | verificação falha; só entra por commit raiz | `test_13_verifier_protected` | ok |
| — | Caminho positivo | aceite válido do verificador | `test_14_positive` | ok |
| — | Servidor MCP (13 ferramentas; `gov_accept_gate` recusado ao executor) | erro no aceite pelo executor | `test_15_mcp` | ok |

## Reforço no verificador (repositório do verificador, árvore revisada pelo QA 5)
Estes testes não fazem parte do R0-05-TEST; ficam como contexto, nos logs `testes-premerge-branch.log` e da R0-06:
- **Casos 4 e 12:** `test_r0_06.py`:
  - `test_12_executor_signed_acceptance_is_not_acceptance`;
  - `test_11_forged_review_rejected_nothing_pushed`.
- **Caso 11:** `test_08_unfavorable_review_signs_rejection` e `test_09_runner_failed_signs_rejection_with_reason`.
- **Pré-merge nunca aceita:** `test_13_premerge_never_accepts`.
- **Casos 8 e 13 no merge:** status `ln-verifier/protected-paths`, `test_premerge.py`:
  - `test_p02_caminho_protegido_pelo_executor_reprova`;
  - `test_p03_ato_raiz_assinado_pela_raiz_passa`;
  - `test_p04_gitattributes_em_subpasta_reprova` (8/8 OK).
  - A exigência do status na `main` é o ruleset `main-required-checks`, ativo desde 23/11.
