# Protocolo de qualificação de modelos (G2 / R2-07/08)

> GERADO por `packages/agents/src/qualification-doc.ts`; não editar. **Nada roda antes do G4 fechado e do modo `qualification` homologado.** Nenhuma chamada real foi feita; nenhum resultado de modelo existe. Alinhado a `r0-preparacao/finops/proposta-politica-modelos-producao.md`, à DP-26 (proprietário), à ADR-021 (política v6 e modo de qualificação) e à decisão do PM de qualificar em etapas. Limiares marcados (proposta) são sugestões da Frente 07 a ratificar por FinOps, QA e proprietário.

## 1. Decisões que valem e travas que restam

| # | Trava | Situação |
|---|---|---|
| T1 | Critério de produção / privacidade | **Revogada pela DP-27:** a DP-26 (a) exigia ZDR listado; agora ZDR **não é mais exigido** (máquina e assinaturas exclusivas do projeto; retenção aceita). O ZDR continua medido só como informação (`QC-ZDR`, não reprova). A ADR-021 e a política v6 ainda dizem `provider.zdr` por chamada: o Arquiteto atualiza para a v7 |
| T2 | Reserva na redação | **Decidida (DP-26 b):** sem reserva e sem fallback na redação; **DeepSeek fora** (modelos, rotas, classe public e verba); a reserva de US$ 8 é só WF08, WF18 e auditoria pós-publicação. Este protocolo **não** qualifica DeepSeek |
| T3 | Fable 5.2 | **Decidida (DP-26 c):** fora de todo trabalho não publicado; na v6, fora de toda rota (`strategic` = só Opus). Este protocolo **não** qualifica Fable |
| T4 | Retenção contratual de Google, Amazon Bedrock e Azure | **Dispensada (PM, 23/11):** deixa de ser pré-condição pela DP-27 (retenção aceita pelo proprietário); a ADR-021/v7 ainda precisa refletir isso |
| T5 | Processador OpenRouter | Política de dados **arquivada** (23/11). A aprovação efetiva do processador (assinatura protegida, DP-11/P1) segue pendente |
| T6 | Modo de qualificação no gateway | **Decidida (ADR-021):** definido e **desligado**: candidatos, tarefa `model_qualification`, classe `public`, `provider.zdr` por chamada, `allow_fallbacks=false`, pool `qualification`, evidência por chamada, exige `production_enabled=false`. **Implementação do Backend** (após L1–L5 do ledger) e **homologação do QA** pendentes |
| T7 | Ledger persistente (G4) | L1–L4 corrigidos na 0019 (ft/modelops 5de5e5c, PostgreSQL 18.7 real); **L5 aberta**: o commit aceita custo real negativo. G4 não fechado |
| T8 | Golden set humano | Não existe. A **etapa 2** o rotula com ajuda de modelo; todo rótulo é proposta até a revisão de um humano da Editorial/Trust |
| T9 | Recarga de crédito | O PM pedirá ao proprietário quando G4 e o modo estiverem homologados, somando os aceites do verificador (≈ US$ 0,50) |
| T10 | Teto do modo por etapa | **Decidida (PM, 23/11):** cap **por etapa** no modo qualification (etapa 1 US$ 5, etapa 2 US$ 10). A ADR-021 e o contrato ainda dizem `cap_usd = 5` único: o Arquiteto ajusta (v7) |
| T11 | Fonte de verba da rotulagem | **Decidida (PM, 23/11):** a rotulagem do golden set sai da verba da **OpenAI (allocation)**, **não** da reserva de US$ 8 (que segue só para WF08, WF18 e auditoria pós-publicação) |
| T12 | Piloto antes da etapa 1 | **Decisão do PM (DP-27):** o piloto de 10 matérias pelo canal OpenBot (assinaturas, sem custo de API) vem **antes** da etapa 1 paga; se o canal cobrir redação e checagem, a etapa 1 encolhe. Desenho do piloto: `fast-track/custo/piloto-10-materias-openbot.md` |

## 2. Etapas (decisão do PM, 23/11/2026)

| Etapa | Escopo | Chamadas | Esperado (US$) | Teto de reserva (US$) | Teto com 20% de reexecução (US$) | Teto da etapa | Pré-condição |
|---|---|---|---|---|---|---|---|
| 1 | Etapa 1: Haiku 5.5, Sonnet 5.5 e GPT-6.1-terra, uma passada cada | 122 | 0.70 | 1.38 | 1.66 | US$ 5 | piloto de 10 matérias pelo canal OpenBot concluído (DP-27: se o canal cobrir redação e checagem, esta etapa pode encolher), G4 fechado, modo qualification homologado pelo QA, recarga de crédito pelo proprietário e as travas do protocolo resolvidas |
| 2 | Etapa 2: rotulagem do golden set (somente) | 400 | 2.20 | 4.76 | 5.71 | US$ 10 | etapa 1 aprovada e ok explícito do PM |
| 3 | Etapa 3 (pós-lançamento, fora de novembro): Opus 5.5 e GPT-6.2-sol (alternativa lateral) | 65 | 1.36 | 2.34 | 2.80 | fora de novembro | decisão posterior do PM; o Opus conta no sublimite de escalonamento de US$ 5 (política v6) |

Total de novembro (etapas 1 + 2): **US$ 7.37** no teto com reexecução (limite US$ 15); esperado US$ 2.90. Mais ≈ US$ 0.50 de aceites do verificador (a somar no pedido de recarga). Tudo dentro do teto mensal de US$ 50 e **sem tocar a reserva de US$ 8**. A etapa 2 só roda se a etapa 1 passar e com ok explícito do PM. A etapa 3 (Opus e GPT-6.2-sol) fica para depois do lançamento, com o Opus sob o sublimite de escalonamento de US$ 5.

## 3. Papéis e modelos (proposta do FinOps → casos → etapa)

| Papel | Modelo principal | Reserva | Caso | Etapa | Regra de política |
|---|---|---|---|---|---|
| Redação (`editorial_draft`) | claude-haiku-5-5 | **nenhuma** (DP-26 b) | Q-DRAFT | 1 | ZDR por chamada; sem fallback |
| Checagem de fatos (`fact_check`) | openai-text-review (GPT-6.1-terra) | GPT-6.2-sol (etapa 3) | Q-FACT | 1 (sol: 3) | autor distinto do redator (Anthropic → OpenAI); sem autor distinto, bloqueia |
| Revisão independente (`editorial_review`, gate WF02) | GPT-6.1-terra | GPT-6.2-sol (etapa 3) | Q-REVIEW | 1 (sol: 3) | só tarefas listadas do modelo OpenAI; Sonnet não vale para o gate de rascunho Anthropic |
| Correção e auditoria (`wf08`, `wf18`, `postpublication_audit`) | GPT-6.1-terra | GPT-6.2-sol (etapa 3) | Q-AUDIT | 1 (sol: 3) | reserva de US$ 8 só acima do degrau 42 |
| Rituais (insumo e síntese) | claude-haiku-5-5 (economy), claude-sonnet-5-5 (review) | — | Q-RITUAL-IN, Q-RITUAL-SYN | 1 | essenciais até o degrau 42 |
| Premium / board mensal (síntese premium e strategic) | claude-opus-5-5 | — | Q-PREMIUM, Q-RITUAL-SYN | **3** (pós-lançamento) | escalonamento: motivo e sublimite de US$ 5; Fable fora |
| Golden set (rotulagem assistida) | GPT-6.1-terra (proposta: ZDR listado, autor diferente do redator, barato) | — | Q-GOLDEN | 2 | rótulo = proposta até revisão humana; fonte de verba: ver T11 |
| Cache e custo | haiku, sonnet, GPT-6.1-terra (etapa 1); sol e Opus (etapa 3) | — | Q-CACHE | 1 / 3 | `cached_tokens > 0`; sem cache o custo não cabe (`cache_failure`) |

## 4. Casos de teste

| Caso | Papel | Modelos (etapa) | Execuções × chamadas | Entrada (sempre classe `public`) | Precisa existir |
|---|---|---|---|---|---|
| Q-DRAFT | editorial_draft | anthropic/claude-haiku-5.5 (1) | 20 × 1 por modelo | pacote de 3–5 fontes públicas por editoria (10 editorias), glossário e estilo da editoria | golden set PT-BR com rubrica da Editorial (fidelidade às fontes, citação, ausência de cópia literal) |
| Q-FACT | fact_check | openai/gpt-6.1-terra (1), openai/gpt-6.2-sol (3) | 20 × 1 por modelo | rascunhos do Q-DRAFT (autor Anthropic): 10 limpos e 10 com 2 erros plantados cada (número, atribuição, afirmação sem fonte, direito autoral) | rascunhos do Q-DRAFT aprovados e o gabarito dos erros plantados (escrito por humano, fora do modelo) |
| Q-REVIEW | editorial_review | openai/gpt-6.1-terra (1), openai/gpt-6.2-sol (3) | 10 × 1 por modelo | 10 rascunhos do Q-DRAFT (autor Anthropic). Sonnet 5.5 NÃO entra: é do mesmo autor do redator e não vale para o gate WF02 (ele só serve às rotas de ritual) | rubrica de revisão (estrutura, tom, títulos, copy literal) da Editorial |
| Q-AUDIT | audit | openai/gpt-6.1-terra (1), openai/gpt-6.2-sol (3) | 6 × 1 por modelo | 6 cenários sintéticos sobre matérias já públicas: erro factual, pedido de retratação, falha de atribuição, imagem sem direito, dado desatualizado, correção correta | cenários e gabarito escritos pela Trust; nenhuma despublicação real |
| Q-RITUAL-IN | ritual_participant_input | anthropic/claude-haiku-5.5 (1), anthropic/claude-sonnet-5.5 (1) | 12 × 1 por modelo | pautas e blocos de status sintéticos/públicos para 12 perfis variados (editor, diretor, trust, growth, intelligence…) | perfis do registro (output_contract) — já existem |
| Q-RITUAL-SYN | ritual_chair_synthesis | anthropic/claude-haiku-5.5 (1), anthropic/claude-sonnet-5.5 (1), anthropic/claude-opus-5.5 (3) | 6 × 1 por modelo | 6 conjuntos de insumos sintéticos (incluindo um com responsável inexistente e um com decisão protegida) | ParticipantInput e DecisionInput (schemas.ts) — já existem |
| Q-PREMIUM | premium_analysis | anthropic/claude-opus-5.5 (3) | 3 × 1 por modelo | 3 pacotes públicos de análise setorial (sem dado de negócio interno) | motivo de escalonamento registrado por execução (política: motivo + sublimite) |
| Q-CACHE | editorial_draft | anthropic/claude-haiku-5.5 (1), anthropic/claude-sonnet-5.5 (1), anthropic/claude-opus-5.5 (3), openai/gpt-6.1-terra (1), openai/gpt-6.2-sol (3) | 5 × 2 por modelo | prefixo estável de ~6.000 tokens (acima do mínimo cacheável do modelo, a verificar) + pergunta curta que muda | mínimo de tokens cacheável e TTL por modelo (verificar no catálogo/documentação do provedor) |
| Q-GOLDEN | golden_labeling | openai/gpt-6.1-terra (2) | 400 × 1 por modelo | 400 itens públicos (40 por editoria): matérias já publicadas e rascunhos sintéticos; o rótulo do modelo é PROPOSTA e vale só depois da revisão de um humano da Editorial/Trust | etapa 1 aprovada, ok explícito do PM e decisão da fonte de verba (ver verificação golden_label_funding) |

Regras comuns: entrada **só** classe `public` (publicada, sintética ou sanitizada; nenhum dado pessoal, embargado, confidencial ou rascunho inédito); `data_collection: deny` e `allow_fallbacks=false` em toda chamada pela API tarifada (`provider.zdr` só se a v7 mantiver; a DP-27 não o exige); mesma redação de prompt e `temperature` fixa em todas as execuções para comparar; modelo fixado pelo `canonical_slug` da política; todo resultado fica no ledger (pool `qualification`) e na pasta de evidências com `generation id`. **Uma passada por modelo**: sem repetir a bateria; só reexecuta falha transitória (até 20%).

## 5. Critérios de aprovação

| Critério | O que prova | Como medir | Limiar |
|---|---|---|---|
| QC-SCHEMA | Saída dentro do contrato do perfil (R4-04) | validateAgentOutput sobre cada saída | ≥ 95% válidas na qualificação, 0 inválidas aceitas; operação monitora ≥ 99% (proposta) |
| QC-USAGE | Cada chamada traz usage e evidência de geração (custo conciliável) | sampleFromResponse != null e generation id presente | 100% das chamadas |
| QC-COST | Custo real por chamada coerente com o preço de lista e nunca acima da reserva | usage.cost (conciliado com /generation) x tokens × preço; custo ≤ teto da reserva | desvio ≤ 10% (esperado) e 0 chamadas acima da reserva (proposta) |
| QC-ZDR | Endpoint de ZDR usado (INFORMATIVO: a DP-27 revogou a exigência de ZDR) | registrar provider.zdr e provider_name da geração; comparar com os endpoints ZDR listados do modelo | só informativo; não reprova |
| QC-CACHE-HIT | Cache de prompt funciona | na 2ª chamada de cada par, prompt_tokens_details.cached_tokens > 0 e cache_read cobrado ao preço de leitura | cached_tokens > 0 em 5 de 5 pares por modelo; senão a rota para (cache_failure) |
| QC-DISTINCT-AUTHOR | Checagem em provedor distinto do redator | autor = prefixo de generation.model da tentativa bem-sucedida (não o provedor de hospedagem) | 100% dos pares com autor diferente; sem autor distinto: bloqueia |
| QC-DISTINCT-AUTHOR-GATE | Revisor do gate WF02 distinto do redator | idem; Sonnet (Anthropic) nunca aprova o gate de rascunho Anthropic | 100% dos revisores do gate com autor diferente |
| QC-SEEDED-RECALL | Detecta os erros plantados | erros plantados apontados / erros plantados | ≥ 90% e nenhum erro crítico (número, atribuição) perdido (proposta) |
| QC-FALSE-POSITIVE | Não acusa erro em rascunho limpo | rascunhos limpos com alerta / rascunhos limpos | ≤ 20% (proposta) |
| QC-QUALITY-DRAFT | Qualidade PT-BR da redação frente ao golden set | avaliação cega por 2 editores com rubrica (fidelidade, clareza, ausência de cópia literal) | nota média ≥ referência acordada; limiar numérico a definir com a Editorial (proposta) |
| QC-DECISION-SHAPE | Síntese respeita autoridade | responsável inexistente → decisão rejeitada; decisão protegida → pending_verifier | 100% dos casos de armadilha tratados (proposta) |

Um modelo só é **qualificado** quando TODOS os critérios dos casos de que participa passam (`decide()` em `src/qualification.ts`); critério sem evidência ou inconclusivo impede a qualificação. Critérios por modelo:

- anthropic/claude-haiku-5.5: QC-SCHEMA, QC-USAGE, QC-COST, QC-QUALITY-DRAFT, QC-DECISION-SHAPE, QC-CACHE-HIT (+ informativo: QC-ZDR)
- openai/gpt-6.1-terra: QC-SCHEMA, QC-USAGE, QC-COST, QC-DISTINCT-AUTHOR, QC-SEEDED-RECALL, QC-FALSE-POSITIVE, QC-DISTINCT-AUTHOR-GATE, QC-CACHE-HIT (+ informativo: QC-ZDR)
- openai/gpt-6.2-sol: QC-SCHEMA, QC-USAGE, QC-COST, QC-DISTINCT-AUTHOR, QC-SEEDED-RECALL, QC-FALSE-POSITIVE, QC-DISTINCT-AUTHOR-GATE, QC-CACHE-HIT (+ informativo: QC-ZDR)
- anthropic/claude-sonnet-5.5: QC-SCHEMA, QC-USAGE, QC-COST, QC-DECISION-SHAPE, QC-CACHE-HIT (+ informativo: QC-ZDR)
- anthropic/claude-opus-5.5: QC-SCHEMA, QC-USAGE, QC-COST, QC-DECISION-SHAPE, QC-CACHE-HIT (+ informativo: QC-ZDR)

## 6. Como medir o cache (`cached_tokens > 0`)

1. Montar um prefixo estável determinístico de ~6.000 tokens (acima do mínimo cacheável do modelo: **a verificar por modelo**) e uma pergunta curta que muda.
2. **Par de chamadas** por modelo, a 2ª dentro do prazo de vida do cache (TTL: **a verificar por modelo**; os preços de gravação de 5 min e 1 h estão na política): chamada 1 grava o prefixo; chamada 2 deve ler.
3. Registrar, em cada chamada, `usage.prompt_tokens`, `usage.prompt_tokens_details.cached_tokens`, `usage.completion_tokens` e `usage.cost`.
4. Aprovar (`QC-CACHE-HIT`) se na chamada 2 `cached_tokens > 0` nos **5 de 5** pares do modelo, e o custo da chamada 2 for menor que o da chamada 1 com a mesma saída. A parte lida do cache deve ser cobrada ao preço de leitura da política (ex.: Haiku US$ 0,01 por milhão).
5. Reprovar e **parar a rota** se `cached_tokens` for 0 na chamada 2 (política: `cache_failure`: medir/parar se o custo não couber). Sem cache o custo mensal não cabe no teto (US$ 77–109 contra US$ 50, segundo o FinOps).
6. O `usage` do chat não informa gravação de cache: o custo da escrita é conciliado pela consulta de geração (`/generation`) com a credencial própria do verificador (DP-06); os campos exatos dessa resposta **não foram verificados**.

## 7. Como medir o custo por chamada

1. Antes: reservar no gateway, no pool `qualification`, o **teto** da chamada (`estimateMicro` na faixa de preço mais cara, saída máxima); custo desconhecido bloqueia.
2. Depois: gravar `usage.cost` e conciliar com o `total_cost` da geração; calcular o esperado por `tokens × preço de lista` (entrada sem cache, leitura e escrita de cache, saída).
3. Aprovar (`QC-COST`) se o desvio for ≤ 10% (proposta) e nenhuma chamada passar da reserva; chamada sem custo informado reprova.
4. Relatório por caso e por modelo: tokens, custo real, custo esperado, teto reservado, desvio.

## 8. Orçamento por etapa (DP-04 e ADR-021)

- Projeção com a política v5 (2.1-dp02-v5-proposta, sha256 `341466147a4f…`), mesmos preços da v6 para estes modelos; valores em US$.

| Etapa | Modelo | Chamadas | Esperado | Teto de reserva |
|---|---|---|---|---|
| 1 | anthropic/claude-haiku-5.5 | 48 | 0.0338 | 0.2246 |
| 1 | openai/gpt-6.1-terra | 46 | 0.3437 | 0.7579 |
| 1 | anthropic/claude-sonnet-5.5 | 28 | 0.3232 | 0.4008 |
| 2 | openai/gpt-6.1-terra | 400 | 2.2000 | 4.7600 |
| 3 | openai/gpt-6.2-sol | 46 | 0.6874 | 1.5158 |
| 3 | anthropic/claude-opus-5.5 | 19 | 0.6728 | 0.8208 |

- Por provedor, novembro (teto com reexecução): anthropic US$ 0.75; openai US$ 6.62.
- Verificações do plano: OK no_unknown_cost; OK stage1_cap; OK stage2_cap; OK november_cap; OK within_monthly_cap; OK anthropic_allocation; OK openai_allocation; OK stages_1_2_exclude_deferred_models; OK no_fable_no_deepseek_no_images; OK audit_reserve_untouched; OK public_data_only; OK stage3_opus_under_escalation_sublimit; OK stage_caps_match_decision; OK golden_label_funding_not_reserve.
- T10 e T11 decididas pelo PM (verificações `stage_caps_match_decision` e `golden_label_funding_not_reserve`); resta o Arquiteto ajustar a ADR-021 e o contrato para cap por etapa.

Parada do orçamento: ao consumir 80% do teto da etapa (fração `soft_budget_fraction` da política) o executor para e pede decisão; custo desconhecido, falha de cache, ZDR fora da lista ou 3 saídas inválidas seguidas do mesmo modelo também param a execução. Rodar no início do mês, antes da carga de produção.

## 9. Ordem de execução e evidência

**Etapa 1** (Haiku, Sonnet, GPT-6.1-terra, uma passada cada): 1. **Q-CACHE** (smoke de cache, usage, ZDR e custo; quem falha no cache já está desqualificado e não gasta o resto); 2. **Q-RITUAL-IN / Q-RITUAL-SYN** em Haiku e Sonnet; 3. **Q-DRAFT** em Haiku; 4. **Q-FACT, Q-REVIEW, Q-AUDIT** em GPT-6.1-terra (usam os rascunhos do Q-DRAFT). Decisão do PM ao final da etapa 1.
**Etapa 2** (só com a etapa 1 aprovada e ok do PM): **Q-GOLDEN**, com revisão humana de todos os rótulos antes de virarem gabarito. **Etapa 3** (pós-lançamento): Opus (Q-PREMIUM, síntese premium) e GPT-6.2-sol.
- Cada chamada grava: `generation id`, modelo que respondeu (`generation.model`), provedor de hospedagem, `usage`, custo conciliado, saída bruta, validade do esquema, e o veredito do critério. Amostras entram no `UsageRecorder` (`measure.ts`): só medição real calibra as premissas de custo dos rituais.
- O executor roda; o **verificador independente** reconsulta `/generation` com a credencial própria e confere o ledger. Ninguém aprova a própria qualificação.

## 10. Dependências abertas e não verificado

- T4, T5 (efetividade), T6 (implementação e homologação), T7 (L5), T8, T9, T10 e T11 acima.
- Mínimo de tokens cacheável e TTL do cache por modelo; como o OpenRouter repassa o marcador de cache de cada provedor; campos de `/generation` para escrita de cache.
- Preços de lista do OpenRouter de 22–23/11/2026 vencem em 7 dias (`price_expiry_days`): reconferir na data da execução. ZDR listado **não** é prova de retenção zero.
- Os perfis de token, os números de execuções, o tamanho do golden set (400 itens) e os limiares marcados (proposta) são estimativas da Frente 07; o custo real só se sabe medindo.
