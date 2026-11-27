# CSV de fixture do `avaliar-piloto` (dados SIMULADOS)

Nenhuma linha vem de execução real: são as 10 matérias a1 a a10 com pauta (Claude Haiku), redação (Claude Sonnet), checagem e revisão (Codex), geradas só para testar o comando `packages/agents/bin/avaliar-piloto.mjs`. O arquivo é o que o Studio exporta: BOM, 32 colunas do AgentOps (a última, `worker_id`, é o agente de cada etapa, um por etapa) e 7 do Studio no fim.

| Arquivo | O que tem | Resultado esperado |
|---|---|---|
| `simulado-aprovado.csv` | 0 altas, 1 média, 3 baixas, 1 limite da conta Claude com retomada, `notes` com fórmula neutralizada, vírgula e aspas | APROVADO, saída 0 |
| `simulado-aprovado-so-agentops.csv` | o mesmo, sem as 7 colunas do Studio | APROVADO, saída 0 |
| `simulado-reprovado.csv` | 0 altas e 2 médias (a2 e a5) | REPROVADO, saída 1 |
| `simulado-parado-fato-alto.csv` | 1 fato de gravidade ALTA (a5-review) | PARADO (parada conservadora do PM), saída 1 |
| `simulado-invalido.csv` | a2-review aprovada com motivo bloqueante `tone_lint` | INVÁLIDO, saída 1 |
