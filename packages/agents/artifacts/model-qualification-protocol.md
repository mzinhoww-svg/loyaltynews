# Protocolo de qualificação de modelos (G2 / R2-07/08)

> GERADO por `packages/agents/src/qualification-doc.ts`; não editar. **Nada roda até o proprietário decidir a política de produção.** Nenhuma chamada real foi feita; nenhum resultado de modelo existe. Alinhado a `r0-preparacao/finops/proposta-politica-modelos-producao.md`. Limiares marcados (proposta) são sugestões da Frente 07 a ratificar por FinOps, QA e proprietário.

## 1. Travas: o que precisa estar decidido ANTES de qualquer chamada

| # | Trava | Quem decide | Situação |
|---|---|---|---|
| T1 | Critério de produção: aceitar "ZDR listado no OpenRouter" ou exigir a política de retenção de cada provedor por escrito | Proprietário (proposta do FinOps, decisão 1) | aberta |
| T2 | Regra para o DeepSeek V4 Flash como reserva de redação (a reserva de US$ 8 é exclusiva de auditoria) | Proprietário (decisão 2) | aberta; o protocolo **não** qualifica DeepSeek |
| T3 | Fable 5.2 (sem ZDR listado) fora de todo trabalho não publicado | Proprietário (decisão 3) | aberta; o protocolo **não** qualifica Fable; M-board estratégico usa Opus como alternativa |
| T4 | Retenção zero contratual de Google, Amazon Bedrock e Azure, sem treino, região, prazo de exclusão de logs e do cache de prompt | Security + proprietário | não verificada |
| T5 | Política de dados do OpenRouter arquivada e a aprovação do processador efetiva (assinatura protegida, DP-11/P1) | Proprietário + verificador | pendente |
| T6 | **Modo de qualificação no gateway** (R-Q1): hoje o roteador bloqueia modelo não qualificado (`not_qualified`) e só tem os modos `production` e `simulation`. Precisa de um modo que permita SÓ os modelos candidatos deste protocolo, tarefa `model_qualification`, dado classe `public`, `provider.zdr` por chamada, teto próprio, sem tocar a reserva de auditoria, mantendo `production_enabled=false` | Backend + FinOps (mudança de política protegida) | **não existe** |
| T7 | Ledger persistente seguro entre processos (G4) para reservar e conciliar cada chamada | Backend | lacunas L1–L4 abertas |
| T8 | Golden set PT-BR, rubricas e gabaritos de erros plantados (escritos por humanos, fora do modelo) | Editorial + Trust | não existe |

## 2. Papéis e modelos (proposta do FinOps → casos)

| Papel | Modelo principal | Reserva | Caso | Regra de política |
|---|---|---|---|---|
| Redação (`editorial_draft`) | claude-haiku-5-5 | nenhuma na v5 | Q-DRAFT | ZDR por chamada em trabalho não publicado |
| Checagem de fatos (`fact_check`) | openai-text-review (GPT-6.1-terra) | openai-text-review-alt (GPT-6.2-sol) | Q-FACT | autor distinto do redator (Anthropic → OpenAI); sem autor distinto, bloqueia |
| Revisão independente (`editorial_review`, gate WF02) | GPT-6.1-terra | GPT-6.2-sol | Q-REVIEW | só tarefas listadas do modelo OpenAI; Sonnet não vale para o gate de rascunho Anthropic |
| Correção e auditoria (`wf08`, `wf18`, `postpublication_audit`) | GPT-6.1-terra | GPT-6.2-sol | Q-AUDIT | reserva de US$ 8 só acima do degrau 42 |
| Rituais (insumo e síntese) | claude-haiku-5-5 (economy), claude-sonnet-5-5 (review) | — | Q-RITUAL-IN, Q-RITUAL-SYN | essenciais até o degrau 42 |
| Premium / board mensal | claude-opus-5-5 | — | Q-PREMIUM, Q-RITUAL-SYN | escalonamento: motivo e sublimite de US$ 5 |
| Cache e custo (todos os candidatos) | os 5 modelos acima | — | Q-CACHE | `cached_tokens > 0`; sem cache o custo não cabe (`cache_failure`) |

## 3. Casos de teste

| Caso | Papel | Modelos | Execuções × chamadas | Entrada (sempre classe `public`) | Precisa existir |
|---|---|---|---|---|---|
| Q-DRAFT | editorial_draft | anthropic/claude-haiku-5.5 | 20 × 1 por modelo | pacote de 3–5 fontes públicas por editoria (10 editorias), glossário e estilo da editoria | golden set PT-BR com rubrica da Editorial (fidelidade às fontes, citação, ausência de cópia literal) |
| Q-FACT | fact_check | openai/gpt-6.1-terra, openai/gpt-6.2-sol | 20 × 1 por modelo | rascunhos do Q-DRAFT (autor Anthropic): 10 limpos e 10 com 2 erros plantados cada (número, atribuição, afirmação sem fonte, direito autoral) | rascunhos do Q-DRAFT aprovados e o gabarito dos erros plantados (escrito por humano, fora do modelo) |
| Q-REVIEW | editorial_review | openai/gpt-6.1-terra, openai/gpt-6.2-sol | 10 × 1 por modelo | 10 rascunhos do Q-DRAFT (autor Anthropic). Sonnet 5.5 NÃO entra: é do mesmo autor do redator e não vale para o gate WF02 (ele só serve às rotas de ritual) | rubrica de revisão (estrutura, tom, títulos, copy literal) da Editorial |
| Q-AUDIT | audit | openai/gpt-6.1-terra, openai/gpt-6.2-sol | 6 × 1 por modelo | 6 cenários sintéticos sobre matérias já públicas: erro factual, pedido de retratação, falha de atribuição, imagem sem direito, dado desatualizado, correção correta | cenários e gabarito escritos pela Trust; nenhuma despublicação real |
| Q-RITUAL-IN | ritual_participant_input | anthropic/claude-haiku-5.5, anthropic/claude-sonnet-5.5 | 12 × 1 por modelo | pautas e blocos de status sintéticos/públicos para 12 perfis variados (editor, diretor, trust, growth, intelligence…) | perfis do registro (output_contract) — já existem |
| Q-RITUAL-SYN | ritual_chair_synthesis | anthropic/claude-haiku-5.5, anthropic/claude-sonnet-5.5, anthropic/claude-opus-5.5 | 6 × 1 por modelo | 6 conjuntos de insumos sintéticos (incluindo um com responsável inexistente e um com decisão protegida) | ParticipantInput e DecisionInput (schemas.ts) — já existem |
| Q-PREMIUM | premium_analysis | anthropic/claude-opus-5.5 | 3 × 1 por modelo | 3 pacotes públicos de análise setorial (sem dado de negócio interno) | motivo de escalonamento registrado por execução (política: motivo + sublimite) |
| Q-CACHE | editorial_draft | anthropic/claude-haiku-5.5, anthropic/claude-sonnet-5.5, anthropic/claude-opus-5.5, openai/gpt-6.1-terra, openai/gpt-6.2-sol | 5 × 2 por modelo | prefixo estável de ~6.000 tokens (acima do mínimo cacheável do modelo, a verificar) + pergunta curta que muda | mínimo de tokens cacheável e TTL por modelo (verificar no catálogo/documentação do provedor) |

Regras comuns: entrada **só** classe `public` (publicada, sintética ou sanitizada; nenhum dado pessoal, embargado, confidencial ou rascunho inédito); `data_collection: deny` e `provider.zdr=true` em toda chamada; mesma redação de prompt e `temperature` fixa em todas as execuções para comparar; modelo fixado pelo `canonical_slug` da política; todo resultado fica no ledger e na pasta de evidências com `generation id`.

## 4. Critérios de aprovação

| Critério | O que prova | Como medir | Limiar |
|---|---|---|---|
| QC-SCHEMA | Saída dentro do contrato do perfil (R4-04) | validateAgentOutput sobre cada saída | ≥ 95% válidas na qualificação, 0 inválidas aceitas; operação monitora ≥ 99% (proposta) |
| QC-USAGE | Cada chamada traz usage e evidência de geração (custo conciliável) | sampleFromResponse != null e generation id presente | 100% das chamadas |
| QC-COST | Custo real por chamada coerente com o preço de lista e nunca acima da reserva | usage.cost (conciliado com /generation) x tokens × preço; custo ≤ teto da reserva | desvio ≤ 10% (esperado) e 0 chamadas acima da reserva (proposta) |
| QC-ZDR | Endpoint de ZDR de fato usado | provider.zdr=true na chamada e provider_name da geração ∈ endpoints ZDR listados do modelo | 100% das chamadas |
| QC-CACHE-HIT | Cache de prompt funciona | na 2ª chamada de cada par, prompt_tokens_details.cached_tokens > 0 e cache_read cobrado ao preço de leitura | cached_tokens > 0 em 5 de 5 pares por modelo; senão a rota para (cache_failure) |
| QC-DISTINCT-AUTHOR | Checagem em provedor distinto do redator | autor = prefixo de generation.model da tentativa bem-sucedida (não o provedor de hospedagem) | 100% dos pares com autor diferente; sem autor distinto: bloqueia |
| QC-DISTINCT-AUTHOR-GATE | Revisor do gate WF02 distinto do redator | idem; Sonnet (Anthropic) nunca aprova o gate de rascunho Anthropic | 100% dos revisores do gate com autor diferente |
| QC-SEEDED-RECALL | Detecta os erros plantados | erros plantados apontados / erros plantados | ≥ 90% e nenhum erro crítico (número, atribuição) perdido (proposta) |
| QC-FALSE-POSITIVE | Não acusa erro em rascunho limpo | rascunhos limpos com alerta / rascunhos limpos | ≤ 20% (proposta) |
| QC-QUALITY-DRAFT | Qualidade PT-BR da redação frente ao golden set | avaliação cega por 2 editores com rubrica (fidelidade, clareza, ausência de cópia literal) | nota média ≥ referência acordada; limiar numérico a definir com a Editorial (proposta) |
| QC-DECISION-SHAPE | Síntese respeita autoridade | responsável inexistente → decisão rejeitada; decisão protegida → pending_verifier | 100% dos casos de armadilha tratados (proposta) |

Um modelo só é **qualificado** quando TODOS os critérios dos casos de que participa passam (`decide()` em `src/qualification.ts`); critério sem evidência ou inconclusivo impede a qualificação. Critérios por modelo:

- anthropic/claude-haiku-5.5: QC-SCHEMA, QC-USAGE, QC-COST, QC-ZDR, QC-QUALITY-DRAFT, QC-DECISION-SHAPE, QC-CACHE-HIT
- openai/gpt-6.1-terra: QC-SCHEMA, QC-USAGE, QC-COST, QC-ZDR, QC-DISTINCT-AUTHOR, QC-SEEDED-RECALL, QC-FALSE-POSITIVE, QC-DISTINCT-AUTHOR-GATE, QC-CACHE-HIT
- openai/gpt-6.2-sol: QC-SCHEMA, QC-USAGE, QC-COST, QC-ZDR, QC-DISTINCT-AUTHOR, QC-SEEDED-RECALL, QC-FALSE-POSITIVE, QC-DISTINCT-AUTHOR-GATE, QC-CACHE-HIT
- anthropic/claude-sonnet-5.5: QC-SCHEMA, QC-USAGE, QC-COST, QC-ZDR, QC-DECISION-SHAPE, QC-CACHE-HIT
- anthropic/claude-opus-5.5: QC-SCHEMA, QC-USAGE, QC-COST, QC-ZDR, QC-DECISION-SHAPE, QC-CACHE-HIT

## 5. Como medir o cache (`cached_tokens > 0`)

1. Montar um prefixo estável determinístico de ~6.000 tokens (acima do mínimo cacheável do modelo: **a verificar por modelo**) e uma pergunta curta que muda.
2. **Par de chamadas** por modelo, a 2ª dentro do prazo de vida do cache (TTL: **a verificar por modelo**; os preços de gravação de 5 min e 1 h estão na política): chamada 1 grava o prefixo; chamada 2 deve ler.
3. Registrar, em cada chamada, `usage.prompt_tokens`, `usage.prompt_tokens_details.cached_tokens`, `usage.completion_tokens` e `usage.cost`.
4. Aprovar (`QC-CACHE-HIT`) se na chamada 2 `cached_tokens > 0` nos **5 de 5** pares do modelo, e o custo da chamada 2 for menor que o da chamada 1 com a mesma saída. A parte lida do cache deve ser cobrada ao preço de leitura da política (ex.: Haiku US$ 0,01 por milhão).
5. Reprovar e **parar a rota** se `cached_tokens` for 0 na chamada 2 (política: `cache_failure`: medir/parar se o custo não couber). Sem cache o custo mensal não cabe no teto (US$ 77–109 contra US$ 50, segundo o FinOps).
6. O `usage` do chat não informa gravação de cache: o custo da escrita é conciliado pela consulta de geração (`/generation`) com a credencial própria do verificador (DP-06); os campos exatos dessa resposta **não foram verificados**.

## 6. Como medir o custo por chamada

1. Antes: reservar no gateway o **teto** da chamada (`estimateMicro` na faixa de preço mais cara, saída máxima); custo desconhecido bloqueia.
2. Depois: gravar `usage.cost` e conciliar com o `total_cost` da geração; calcular o esperado por `tokens × preço de lista` (entrada sem cache, leitura e escrita de cache, saída).
3. Aprovar (`QC-COST`) se o desvio for ≤ 10% (proposta) e nenhuma chamada passar da reserva; chamada sem custo informado reprova.
4. Relatório por caso e por modelo: tokens, custo real, custo esperado, teto reservado, desvio.

## 7. Orçamento máximo da qualificação (DP-04)

- **Teto proposto: US$ 5** (≈ 10% do teto mensal de US$ 50), consumido do mês em que rodar e das verbas por provedor (Anthropic US$ 22, OpenAI US$ 20); **não** usa a reserva de US$ 8 (só auditoria) nem verba de DeepSeek/imagens (zero).
- Projeção (política v5 2.1-dp02-v5-proposta, sha256 `2641a8fe3d19…`): **187 chamadas**; esperado US$ 2.06; teto de reserva US$ 3.72; com 20% de reexecução US$ 4.46 (folga de 0.54 sobre o teto proposto).
- Por provedor (teto com reexecução): anthropic US$ 1.74; openai US$ 2.73. Opus (escalonamento): US$ 0.9850 de no máximo US$ 1.00 (20% do sublimite de US$ 5), com motivo registrado por execução.

| Modelo | Chamadas | Esperado (US$) | Teto de reserva (US$) |
|---|---|---|---|
| anthropic/claude-haiku-5.5 | 48 | 0.0338 | 0.2246 |
| openai/gpt-6.1-terra | 46 | 0.3437 | 0.7579 |
| openai/gpt-6.2-sol | 46 | 0.6874 | 1.5158 |
| anthropic/claude-sonnet-5.5 | 28 | 0.3232 | 0.4008 |
| anthropic/claude-opus-5.5 | 19 | 0.6728 | 0.8208 |

Verificações do plano: OK no_unknown_cost; OK qualification_cap; OK within_monthly_cap; OK anthropic_allocation; OK openai_allocation; OK opus_escalation_share; OK no_fable_no_deepseek_no_images; OK audit_reserve_untouched; OK public_data_only.

Parada do orçamento: ao consumir 80% do teto da qualificação (fração `soft_budget_fraction` da política) o executor para e pede decisão; custo desconhecido, falha de cache, ZDR fora da lista ou 3 saídas inválidas seguidas do mesmo modelo também param a execução. Rodar no início do mês, antes da carga de produção, para não disputar os degraus de 35/40/42.

## 8. Ordem de execução e evidência

1. **Q-CACHE** (smoke de cache, usage, ZDR e custo; 50 chamadas curtas): quem falha no cache já está desqualificado e não gasta o resto.
2. **Q-RITUAL-IN / Q-RITUAL-SYN** em Haiku e Sonnet; 3. **Q-DRAFT** em Haiku; 4. **Q-FACT, Q-REVIEW, Q-AUDIT** em GPT-6.1-terra e GPT-6.2-sol (usam os rascunhos do Q-DRAFT); 5. **Q-PREMIUM** e a síntese em Opus por último (escalonamento).
- Cada chamada grava: `generation id`, modelo que respondeu (`generation.model`), provedor de hospedagem, `usage`, custo conciliado, saída bruta, validade do esquema, e o veredito do critério. Amostras entram no `UsageRecorder` (`measure.ts`): só medição real calibra as premissas de custo dos rituais.
- O executor roda; o **verificador independente** reconsulta `/generation` com a credencial própria e conferem o ledger. Ninguém aprova a própria qualificação.

## 9. Dependências abertas e não verificado

- R-Q1 (modo de qualificação no gateway) e T1–T8 acima.
- Mínimo de tokens cacheável e TTL do cache por modelo; como o OpenRouter repassa o marcador de cache de cada provedor; campos de `/generation` para escrita de cache.
- Preços de lista do OpenRouter de 22–23/11/2026 vencem em 7 dias (`price_expiry_days`): reconferir na data da execução. ZDR listado **não** é prova de retenção zero.
- Os perfis de token, os números de execuções e os limiares marcados (proposta) são estimativas da Frente 07; o custo real só se sabe medindo.
