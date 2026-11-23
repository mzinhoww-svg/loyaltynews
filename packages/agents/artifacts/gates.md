# Gates G1–G6 — critérios medíveis

> GERADO por `packages/agents/src/artifacts.ts`; não editar. Nenhum gate está atendido: "OK offline" é só o que o repositório prova; o restante depende de staging, ratificação, medição real ou terceiros. Limiares marcados (proposta) são sugestões da Frente 07 a ratificar.

## G1 — Ratificar P5 v2 (item 11 das mudanças protegidas)
Decide: Proprietário + verificador independente (cerimônia protegida, lote separado, depois do aceite de R4-11)

| Critério | Como medir | Limiar | Dono | Hoje |
|---|---|---|---|---|
| G1.1 Os rituais carregados são exatamente a P5 v2 | sha256 de data/meetings.registry.json igual ao de arquitetura/meetings.registry.proposto-P5-v2.json | == a18e0a7150db… | AgentOps | OK offline — SOURCES.json: a18e0a7150db095bf411a0f3ddd1123e15cf25ddd94f9656ddef3eaae2824264 |
| G1.2 Cada teste de fronteira da recovery_policy tem teste automatizado | mapa boundary_tests → nome de teste em scheduler.test.ts (+ `npm test` verde) | 8 de 8 cobertos e passando | AgentOps | OK offline — 8 de 8 testes de fronteira mapeados em scheduler.test.ts (a execução verde é de `npm test`) |
| G1.3 Calendário 2026–2027: nenhum ritual em feriado nacional; 1º dia útil do mês correto (R4-11) | calendar.test.ts, bloco "ocorrências de rituais" | 100% dos feriados nacionais 2026–2027 sem ritual | AgentOps | OK offline — calendar.test.ts |
| G1.4 Ratificação assinada e aplicada em contracts/meetings.registry.json | registro da cerimônia + hash do contrato protegido | assinatura presente e hash do contrato == P5 v2 | Proprietário/verificador | externo — depende da cerimônia protegida; o contrato contracts/meetings.registry.json não é editado por esta frente |

## G2 — Qualificar modelos dos rituais (R2-07/08)
Decide: Verificador independente / FinOps

| Critério | Como medir | Limiar | Dono | Hoje |
|---|---|---|---|---|
| G2.1 Cada modelo das rotas economy/review/premium/strategic tem ID e preço verificados | política: binding.openrouter_id e price_as_of; rate card conferido no /api/v1/models | price_as_of ≤ price_expiry_days (7) na data do uso | FinOps | depende da data — preço vence em 7 dias: conferir na data do uso (dependente do tempo) |
| G2.2 Saída fora do esquema é rejeitada e a válida passa (R4-04) | validateAgentOutput sobre o golden set, por perfil e por modelo | ≥ 99% de saídas válidas por rota; 0 saídas inválidas aceitas (proposta) | AgentOps + QA | externo — o validador por perfil existe (output.test.ts, 64 perfis); falta o golden set real e a taxa por modelo |
| G2.3 Qualidade PT-BR frente ao golden set | avaliação cega comparando o modelo candidato com a referência (claude-sonnet-5-5) | não pior que a referência em fidelidade factual; limiar numérico a definir com a Editorial | Editorial + QA | externo — exige medição/consulta real fora deste pacote |
| G2.4 ZDR / data_collection=deny disponível por modelo | consulta ao endpoint do provedor no OpenRouter | confirmado para 100% dos modelos usados | Security | externo — exige medição/consulta real fora deste pacote |
| G2.5 Resposta traz usage e evidência de geração (custo conciliável) | sampleFromResponse(resposta) != null em 100% das chamadas de teste em staging | 100% | AgentOps + Backend | externo — sampleFromResponse existe; falta rodar em staging com chamadas reais |
| G2.6 Orçamento da qualificação cabe na DP-04 (teto proposto de US$ 5, verbas por provedor, 20% do sublimite do Opus, sem reserva de auditoria) | buildQualificationPlan(política v5).ok (model-qualification-protocol.md, seção 7) | todas as verificações do plano OK (proposta) | AgentOps + FinOps | OK offline — plano de qualificação OK: 187 chamadas, teto com reexecução US$ 4.46 |
| G2.7 Política decidida pelo proprietário e travas T1–T8 do protocolo resolvidas antes de qualquer chamada | registro das decisões T1–T3, retenção T4, processador T5, modo de qualificação T6, ledger T7, golden set T8 | 8 de 8 travas resolvidas | Proprietário + Backend + FinOps + Security + Editorial | externo — o protocolo existe; as decisões do proprietário e as travas T1–T8 não estão resolvidas (nada roda) |

## G3 — Banco de staging com as migrações da organização
Decide: DevOps

| Critério | Como medir | Limiar | Dono | Hoje |
|---|---|---|---|---|
| G3.1 Migrações 0004_agentic_org e 0005_agents_reschedule existem e estão no journal | packages/db/drizzle/meta/_journal.json | ambas presentes | Arquiteto | OK offline — packages/db/drizzle/meta/_journal.json |
| G3.2 As migrações aplicam e o PgStore passa os testes de idempotência, atomicidade e CHECKs | pg.test.ts (PGlite) | 100% dos testes | AgentOps | OK offline — pg.test.ts presente (execução verde é de `npm test`) |
| G3.3 Aplicadas no PostgreSQL de staging | select das 6 tabelas no staging | 6 tabelas e as restrições presentes | DevOps | externo — não existe banco de staging |

## G4 — Ledger de orçamento e saldo persistidos em PostgreSQL
Decide: Backend + FinOps (pacote modelops)

| Critério | Como medir | Limiar | Dono | Hoje |
|---|---|---|---|---|
| G4.0 O armazenamento PostgreSQL implementa AtomicLedgerStore e passa a suíte de aceitação do contrato (A01–A12, incluindo A10 com SQL cru) | defineLedgerAcceptance sobre o PgLedgerStore (ledger-contract.md) | 12 de 12 casos passando, nenhum "skipped" | Backend | externo — a suíte existe (ledger-contract) e passa na implementação de referência; falta o PgLedgerStore do Backend |
| G4.1 Transação por mês com exclusão mútua entre processos | caso A07: 200 reservas concorrentes por dois handles contra teto de US$ 10 | exatamente 100 aceitas e 0 estouros; mais um teste de estresse de 1000 (proposta) (proposta) | Backend | externo — pacote modelops (Backend + FinOps): fora desta frente |
| G4.2 Replay do ledger reproduz o gasto | replay == soma das gerações conciliadas | diferença ≤ 1% (limite proposto no modelops) | FinOps | externo — pacote modelops (Backend + FinOps): fora desta frente |
| G4.3 Saldo do provedor lido antes da primeira chamada | BalanceGuard injetado na composição do produto | leitura obrigatória; falha de leitura bloqueia | Backend | externo — pacote modelops (Backend + FinOps): fora desta frente |

## G5 — Adaptador OpenBot e mapeamento perfil → agente
Decide: Integration + Program Manager (aval para criar agentes)

| Critério | Como medir | Limiar | Dono | Hoje |
|---|---|---|---|---|
| G5.1 O rascunho de perfis cobre os 64 perfis exatamente uma vez, preside os 28 rituais e é dono dos 19 workflows | validateOpenBotDraft | 0 problemas | AgentOps | OK offline — 8 agentes cobrem 64 perfis, 28 rituais e 19 workflows; created=false |
| G5.2 Aval do Program Manager ao rascunho (nome, título, divisão da Editorial) | mensagem registrada | aval explícito | Program Manager | externo — depende de aval, adaptador e agentes que não existem |
| G5.3 Adaptador por pull com lease, só conexão de saída, callback assinado e idempotente (R2-10, testes 2, 3, 6 e 7) | suíte do adaptador | 100% | Integration | externo — depende de aval, adaptador e agentes que não existem |
| G5.4 Teste negativo por agente: nenhum agente lê credencial ou memória de produção que não é sua (R2-09, teste 11) | teste por agente criado | 8 de 8 agentes negam | Security | externo — depende de aval, adaptador e agentes que não existem |
| G5.5 Nenhuma credencial de provedor na configuração dos agentes | varredura da configuração (ADR-003) | 0 ocorrências | Security | externo — depende de aval, adaptador e agentes que não existem |
| G5.6 Editorial em 1 agente até a medição; critérios S1–S3 de divisão avaliados com 30+ execuções medidas | editorial_split_criteria do rascunho + harness de tokens/latência | S1, S2 e S3 dentro do limiar; senão dividir (proposta) | AgentOps + PM | externo — depende de aval, adaptador e agentes que não existem |

## G6 — Insumos dos rituais: digest determinístico e coletor
Decide: Backend + Editorial

| Critério | Como medir | Limiar | Dono | Hoje |
|---|---|---|---|---|
| G6.1 Formato do insumo estruturado definido e validado (ParticipantInput) e coletor do banco | schemas.ts + StoreInputCollector + testes | presentes e passando | AgentOps | OK offline — ParticipantInputSchema e StoreInputCollector |
| G6.2 Worker de digest roda às 05:30 e o insumo existe antes de cada ritual (ADR-014) | log do worker x meeting_runs.scheduled_for na fase F1/F2 | 100% dos rituais com digest anterior ao horário | Backend | externo — o worker de digest não existe |
| G6.3 Rituais sem insumo viram status_only (regra do silêncio) sem chamada de modelo | meeting_runs: status_only → model_calls = 0 | 100% | AgentOps | OK offline — scheduler.test.ts cobre status_only sem insumo com model_calls = 0 |

