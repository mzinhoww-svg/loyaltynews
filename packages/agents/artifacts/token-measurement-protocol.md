# Protocolo de medição de tokens por chamada (R4)

> GERADO. Sem chamadas reais: o harness (`packages/agents/src/measure.ts`) só estima por caracteres e só calibra com amostras MEDIDAS.

**Objetivo:** Trocar as premissas de tokens do plano de custo por medição real, sem estourar o teto.

## Pré-condições
- G2 (modelos qualificados) e G4 (ledger persistido) atendidos
- flag modelosHabilitados ligada somente em staging
- tudo pelo gateway do LN → OpenRouter (nenhuma chamada direta ao provedor)

## Amostragem
- Mínimo de 30 amostras medidas por papel (participant_input, chair_synthesis); rotas: economy, review, premium, strategic.
- rituais premium/strategic têm poucas ocorrências por mês: medir com ocorrências de ensaio em staging, dentro do sublimite de escalonamento.

## Campos registrados por chamada
- generationId
- model (generation.model)
- promptTokens (sem cache)
- cacheReadTokens
- completionTokens
- maxOutputTokens
- cost (usage.cost)

## Limitações
- o usage do chat do OpenRouter não informa gravação de cache: o custo de escrita no cache é conciliado por /generation
- amostras SIMULADAS e estimadas por caracteres nunca calibram

## Saídas
- premissas calibradas (p95 de entrada, máx. de saída × 1,25, fração de saída média)
- plano de custo recalculado e deriva frente às premissas atuais

## Linha de base ESTIMADA por caracteres (não é medição)
Para os 64 perfis, sem memória setorial: parte estável (missão + contrato de saída + política de ferramentas) em média 285 tokens (p95 321, máx. 326); parte variável da pauta 45 tokens (máx. 45). A premissa do plano de custo é 6000 tokens em cache e 1500 sem cache por insumo: a diferença para a base estimada é a memória setorial e o contexto que ainda não existem, e a medição deve revelá-la. Conversão usada: 100 tokens por 360 caracteres (3,6 caracteres/token em PT-BR, sem tokenizador).
