/** Artefatos do protocolo de qualificação (G2): `model-qualification-protocol.md` e `model-qualification-plan.json`. Não exportado por `index.ts`. */
import type { ModelPolicy } from '@ln/modelops';
import { buildQualificationPlan, criteriaFor, requiredCriteriaFor, QUAL_BUDGET_PROPOSAL, QUAL_CASES, QUAL_CRITERIA, QUAL_STAGES, type QualStage } from './qualification';

export interface QualificationArtifacts {
  'model-qualification-protocol.md': string;
  'model-qualification-plan.json': string;
}

const usd = (micro: number) => (micro / 1_000_000).toFixed(2);
const usd4 = (micro: number) => (micro / 1_000_000).toFixed(4);

export function buildQualificationArtifacts(policy: ModelPolicy, policySha: string): QualificationArtifacts {
  const plan = buildQualificationPlan(policy);
  const modelOf = new Map(policy.models.map((m) => [m.id, m]));
  const label = (id: string) => modelOf.get(id)?.binding?.openrouter_id ?? id;
  const stages: QualStage[] = [1, 2, 3];

  const byModelStage = new Map<string, { stage: QualStage; model: string; calls: number; ceiling: number; expected: number }>();
  for (const c of plan.costs) {
    const k = `${c.stage}|${c.model}`;
    const cur = byModelStage.get(k) ?? { stage: c.stage, model: c.model, calls: 0, ceiling: 0, expected: 0 };
    byModelStage.set(k, { ...cur, calls: cur.calls + c.calls, ceiling: cur.ceiling + c.ceilingMicro, expected: cur.expected + c.expectedMicro });
  }
  const allModels = [...new Set(plan.costs.map((c) => c.model))];

  const json = {
    schema: 'ln.agents.model-qualification-plan/2',
    nota: 'GERADO. PROJEÇÃO de custo e casos de teste: NADA foi executado e nada pode ser executado antes do G4 fechado e do modo qualification homologado (production_enabled=false; flag modelosHabilitados desligada). Perfis de token são estimativas da Frente 07, não medição.',
    decisoes: [
      'DP-26 (proprietário, 23/11/2026): política de modelos de produção = proposta do FinOps; (a) privacidade = ZDR listado no OpenRouter + política de dados do OpenRouter arquivada [REVOGADO pela DP-27]; (b) sem reserva na redação (DeepSeek fora; reserva de US$ 8 só para auditoria); (c) Fable fora de todo trabalho não publicado',
      'DP-27 (proprietário, 23/11/2026): ZDR NÃO é mais exigido (máquina e assinaturas exclusivas do projeto; retenção aceita); prioridade = executar redação, checagem e rituais por agentes do OpenBot nas assinaturas já pagas (Claude, Codex; fora do teto), com a API tarifada só como complemento dentro de US$ 50; "sem reserva na redação" e "Fable fora do não publicado" seguem',
      'ADR-021 (Chief Architect): política v6 = v5 + DP-26; modo qualification (T6) definido e DESLIGADO; tarefa model_qualification, classe public, provider.zdr por chamada, allow_fallbacks=false, pool qualification, cap_usd = 5, exige production_enabled=false',
      'PM (23/11/2026): qualificação em etapas, total <= US$ 15 em novembro; etapa 1 (<= US$ 5): Haiku, Sonnet e GPT-6.1-terra, uma passada cada; etapa 2 (<= US$ 10, só se a etapa 1 passar e com ok do PM): rotulagem do golden set; Opus sai de novembro (pós-lançamento, sob o sublimite de escalonamento)',
    ],
    politica: { arquivo: 'packages/modelops/fixtures/model.policy.proposto-DP02-v5.json', sha256: policySha, version: plan.policyVersion, nota: 'preços e IDs dos 5 candidatos; a v6 (DP-26) altera rotas e verbas, não esses preços; migrar o fixture quando a v6 virar contrato' },
    alinhado_com: ['r0-preparacao/finops/proposta-politica-modelos-producao.md (23/11/2026)', 'fast-track/decisoes/ADR-021-politica-modelos-dp26-qualificacao.md'],
    etapas: QUAL_STAGES,
    orcamento_proposto: QUAL_BUDGET_PROPOSAL,
    casos: QUAL_CASES,
    criterios: QUAL_CRITERIA,
    criterios_por_modelo: Object.fromEntries(allModels.map((m) => [m, requiredCriteriaFor(m)])),
    plano: plan,
  };

  const stageRow = (st: QualStage) => {
    const t = plan.stageTotals[st];
    const cap = QUAL_STAGES[st].capUsd;
    return `| ${st} | ${QUAL_STAGES[st].title} | ${t.calls} | ${usd(t.expectedMicro)} | ${usd(t.ceilingMicro)} | ${usd(t.ceilingWithRetriesMicro)} | ${cap === null ? 'fora de novembro' : `US$ ${cap}`} | ${QUAL_STAGES[st].requires} |`;
  };

  const md = [
    '# Protocolo de qualificação de modelos (G2 / R2-07/08)',
    '',
    '> GERADO por `packages/agents/src/qualification-doc.ts`; não editar. **Nada roda antes do G4 fechado e do modo `qualification` homologado.** Nenhuma chamada real foi feita; nenhum resultado de modelo existe. Alinhado a `r0-preparacao/finops/proposta-politica-modelos-producao.md`, à DP-26 (proprietário), à ADR-021 (política v6 e modo de qualificação) e à decisão do PM de qualificar em etapas. Limiares marcados (proposta) são sugestões da Frente 07 a ratificar por FinOps, QA e proprietário.',
    '',
    '## 1. Decisões que valem e travas que restam',
    '',
    '| # | Trava | Situação |',
    '|---|---|---|',
    '| T1 | Critério de produção / privacidade | **Revogada pela DP-27:** a DP-26 (a) exigia ZDR listado; agora ZDR **não é mais exigido** (máquina e assinaturas exclusivas do projeto; retenção aceita). O ZDR continua medido só como informação (`QC-ZDR`, não reprova). A ADR-021 e a política v6 ainda dizem `provider.zdr` por chamada: o Arquiteto atualiza para a v7 |',
    '| T2 | Reserva na redação | **Decidida (DP-26 b):** sem reserva e sem fallback na redação; **DeepSeek fora** (modelos, rotas, classe public e verba); a reserva de US$ 8 é só WF08, WF18 e auditoria pós-publicação. Este protocolo **não** qualifica DeepSeek |',
    '| T3 | Fable 5.2 | **Decidida (DP-26 c):** fora de todo trabalho não publicado; na v6, fora de toda rota (`strategic` = só Opus). Este protocolo **não** qualifica Fable |',
    '| T4 | Retenção contratual de Google, Amazon Bedrock e Azure (sem treino, região, prazo de exclusão de logs e do cache) | **Provavelmente dispensada pela DP-27** (retenção aceita pelo proprietário); a ADR-021 ainda a lista como pré-condição. Confirmar com o PM/Arquiteto na v7; até lá, **não verificada** |',
    '| T5 | Processador OpenRouter | Política de dados **arquivada** (23/11). A aprovação efetiva do processador (assinatura protegida, DP-11/P1) segue pendente |',
    '| T6 | Modo de qualificação no gateway | **Decidida (ADR-021):** definido e **desligado**: candidatos, tarefa `model_qualification`, classe `public`, `provider.zdr` por chamada, `allow_fallbacks=false`, pool `qualification`, evidência por chamada, exige `production_enabled=false`. **Implementação do Backend** (após L1–L5 do ledger) e **homologação do QA** pendentes |',
    '| T7 | Ledger persistente (G4) | L1–L4 corrigidos na 0019 (ft/modelops 5de5e5c, PostgreSQL 18.7 real); **L5 aberta**: o commit aceita custo real negativo. G4 não fechado |',
    '| T8 | Golden set humano | Não existe. A **etapa 2** o rotula com ajuda de modelo; todo rótulo é proposta até a revisão de um humano da Editorial/Trust |',
    '| T9 | Recarga de crédito | O PM pedirá ao proprietário quando G4 e o modo estiverem homologados, somando os aceites do verificador (≈ US$ 0,50) |',
    '| T10 | Teto do modo por etapa | A ADR-021 fixa `cap_usd = 5` (cobre a etapa 1). A etapa 2 (até US$ 10) e o total de US$ 15 exigem ajustar o cap por etapa ou usar pool próprio, **antes de rodar** |',
    '| T11 | Fonte de verba da rotulagem | O PM indicou "verba de auditoria"; a DP-26 (b) e a v6 restringem a reserva de US$ 8 a WF08/WF18/auditoria pós-publicação, e rotular não é nenhuma delas. Este plano contabiliza na verba da OpenAI, **não** na reserva; decisão do PM/Arquiteto |',
    '',
    '## 2. Etapas (decisão do PM, 23/11/2026)',
    '',
    '| Etapa | Escopo | Chamadas | Esperado (US$) | Teto de reserva (US$) | Teto com 20% de reexecução (US$) | Teto da etapa | Pré-condição |',
    '|---|---|---|---|---|---|---|---|',
    ...stages.map(stageRow),
    '',
    `Total de novembro (etapas 1 + 2): **US$ ${usd(plan.novemberTotals.ceilingWithRetriesMicro)}** no teto com reexecução (limite US$ ${QUAL_BUDGET_PROPOSAL.novemberCapUsd}); esperado US$ ${usd(plan.novemberTotals.expectedMicro)}. Mais ≈ US$ ${QUAL_BUDGET_PROPOSAL.verifierAcceptancesUsd.toFixed(2)} de aceites do verificador (a somar no pedido de recarga). Tudo dentro do teto mensal de US$ 50 e **sem tocar a reserva de US$ 8**. A etapa 2 só roda se a etapa 1 passar e com ok explícito do PM. A etapa 3 (Opus e GPT-6.2-sol) fica para depois do lançamento, com o Opus sob o sublimite de escalonamento de US$ 5.`,
    '',
    '## 3. Papéis e modelos (proposta do FinOps → casos → etapa)',
    '',
    '| Papel | Modelo principal | Reserva | Caso | Etapa | Regra de política |',
    '|---|---|---|---|---|---|',
    '| Redação (`editorial_draft`) | claude-haiku-5-5 | **nenhuma** (DP-26 b) | Q-DRAFT | 1 | ZDR por chamada; sem fallback |',
    '| Checagem de fatos (`fact_check`) | openai-text-review (GPT-6.1-terra) | GPT-6.2-sol (etapa 3) | Q-FACT | 1 (sol: 3) | autor distinto do redator (Anthropic → OpenAI); sem autor distinto, bloqueia |',
    '| Revisão independente (`editorial_review`, gate WF02) | GPT-6.1-terra | GPT-6.2-sol (etapa 3) | Q-REVIEW | 1 (sol: 3) | só tarefas listadas do modelo OpenAI; Sonnet não vale para o gate de rascunho Anthropic |',
    '| Correção e auditoria (`wf08`, `wf18`, `postpublication_audit`) | GPT-6.1-terra | GPT-6.2-sol (etapa 3) | Q-AUDIT | 1 (sol: 3) | reserva de US$ 8 só acima do degrau 42 |',
    '| Rituais (insumo e síntese) | claude-haiku-5-5 (economy), claude-sonnet-5-5 (review) | — | Q-RITUAL-IN, Q-RITUAL-SYN | 1 | essenciais até o degrau 42 |',
    '| Premium / board mensal (síntese premium e strategic) | claude-opus-5-5 | — | Q-PREMIUM, Q-RITUAL-SYN | **3** (pós-lançamento) | escalonamento: motivo e sublimite de US$ 5; Fable fora |',
    '| Golden set (rotulagem assistida) | GPT-6.1-terra (proposta: ZDR listado, autor diferente do redator, barato) | — | Q-GOLDEN | 2 | rótulo = proposta até revisão humana; fonte de verba: ver T11 |',
    '| Cache e custo | haiku, sonnet, GPT-6.1-terra (etapa 1); sol e Opus (etapa 3) | — | Q-CACHE | 1 / 3 | `cached_tokens > 0`; sem cache o custo não cabe (`cache_failure`) |',
    '',
    '## 4. Casos de teste',
    '',
    '| Caso | Papel | Modelos (etapa) | Execuções × chamadas | Entrada (sempre classe `public`) | Precisa existir |',
    '|---|---|---|---|---|---|',
    ...QUAL_CASES.map((c) => `| ${c.id} | ${c.role} | ${c.models.map((m) => `${label(m)} (${c.stages[m] ?? '?'})`).join(', ')} | ${c.runsPerModel} × ${c.callsPerRun} por modelo | ${c.input} | ${c.needs} |`),
    '',
    'Regras comuns: entrada **só** classe `public` (publicada, sintética ou sanitizada; nenhum dado pessoal, embargado, confidencial ou rascunho inédito); `data_collection: deny` e `allow_fallbacks=false` em toda chamada pela API tarifada (`provider.zdr` só se a v7 mantiver; a DP-27 não o exige); mesma redação de prompt e `temperature` fixa em todas as execuções para comparar; modelo fixado pelo `canonical_slug` da política; todo resultado fica no ledger (pool `qualification`) e na pasta de evidências com `generation id`. **Uma passada por modelo**: sem repetir a bateria; só reexecuta falha transitória (até 20%).',
    '',
    '## 5. Critérios de aprovação',
    '',
    '| Critério | O que prova | Como medir | Limiar |',
    '|---|---|---|---|',
    ...QUAL_CRITERIA.map((c) => `| ${c.id} | ${c.text} | ${c.measure} | ${c.threshold}${c.proposed ? ' (proposta)' : ''} |`),
    '',
    'Um modelo só é **qualificado** quando TODOS os critérios dos casos de que participa passam (`decide()` em `src/qualification.ts`); critério sem evidência ou inconclusivo impede a qualificação. Critérios por modelo:',
    '',
    ...allModels.map((m) => `- ${label(m)}: ${requiredCriteriaFor(m).join(', ')}${criteriaFor(m).length > requiredCriteriaFor(m).length ? ' (+ informativo: QC-ZDR)' : ''}`),
    '',
    '## 6. Como medir o cache (`cached_tokens > 0`)',
    '',
    '1. Montar um prefixo estável determinístico de ~6.000 tokens (acima do mínimo cacheável do modelo: **a verificar por modelo**) e uma pergunta curta que muda.',
    '2. **Par de chamadas** por modelo, a 2ª dentro do prazo de vida do cache (TTL: **a verificar por modelo**; os preços de gravação de 5 min e 1 h estão na política): chamada 1 grava o prefixo; chamada 2 deve ler.',
    '3. Registrar, em cada chamada, `usage.prompt_tokens`, `usage.prompt_tokens_details.cached_tokens`, `usage.completion_tokens` e `usage.cost`.',
    '4. Aprovar (`QC-CACHE-HIT`) se na chamada 2 `cached_tokens > 0` nos **5 de 5** pares do modelo, e o custo da chamada 2 for menor que o da chamada 1 com a mesma saída. A parte lida do cache deve ser cobrada ao preço de leitura da política (ex.: Haiku US$ 0,01 por milhão).',
    '5. Reprovar e **parar a rota** se `cached_tokens` for 0 na chamada 2 (política: `cache_failure`: medir/parar se o custo não couber). Sem cache o custo mensal não cabe no teto (US$ 77–109 contra US$ 50, segundo o FinOps).',
    '6. O `usage` do chat não informa gravação de cache: o custo da escrita é conciliado pela consulta de geração (`/generation`) com a credencial própria do verificador (DP-06); os campos exatos dessa resposta **não foram verificados**.',
    '',
    '## 7. Como medir o custo por chamada',
    '',
    '1. Antes: reservar no gateway, no pool `qualification`, o **teto** da chamada (`estimateMicro` na faixa de preço mais cara, saída máxima); custo desconhecido bloqueia.',
    '2. Depois: gravar `usage.cost` e conciliar com o `total_cost` da geração; calcular o esperado por `tokens × preço de lista` (entrada sem cache, leitura e escrita de cache, saída).',
    '3. Aprovar (`QC-COST`) se o desvio for ≤ 10% (proposta) e nenhuma chamada passar da reserva; chamada sem custo informado reprova.',
    '4. Relatório por caso e por modelo: tokens, custo real, custo esperado, teto reservado, desvio.',
    '',
    '## 8. Orçamento por etapa (DP-04 e ADR-021)',
    '',
    `- Projeção com a política v5 (${plan.policyVersion}, sha256 \`${policySha.slice(0, 12)}…\`), mesmos preços da v6 para estes modelos; valores em US$.`,
    '',
    '| Etapa | Modelo | Chamadas | Esperado | Teto de reserva |',
    '|---|---|---|---|---|',
    ...[...byModelStage.values()].sort((a, b) => a.stage - b.stage).map((v) => `| ${v.stage} | ${label(v.model)} | ${v.calls} | ${usd4(v.expected)} | ${usd4(v.ceiling)} |`),
    '',
    `- Por provedor, novembro (teto com reexecução): ${Object.entries(plan.novemberTotals.byProviderCeilingWithRetriesMicro).map(([p, v]) => `${p} US$ ${usd(v)}`).join('; ')}.`,
    `- Verificações do plano: ${plan.checks.map((c) => `${c.ok ? 'OK' : c.severity === 'warning' ? 'AVISO' : 'FALHA'} ${c.id}`).join('; ')}.`,
    '- Avisos (decisão pendente, não reprovam o plano): `adr021_mode_cap` (T10) e `golden_label_funding` (T11).',
    '',
    'Parada do orçamento: ao consumir 80% do teto da etapa (fração `soft_budget_fraction` da política) o executor para e pede decisão; custo desconhecido, falha de cache, ZDR fora da lista ou 3 saídas inválidas seguidas do mesmo modelo também param a execução. Rodar no início do mês, antes da carga de produção.',
    '',
    '## 9. Ordem de execução e evidência',
    '',
    '**Etapa 1** (Haiku, Sonnet, GPT-6.1-terra, uma passada cada): 1. **Q-CACHE** (smoke de cache, usage, ZDR e custo; quem falha no cache já está desqualificado e não gasta o resto); 2. **Q-RITUAL-IN / Q-RITUAL-SYN** em Haiku e Sonnet; 3. **Q-DRAFT** em Haiku; 4. **Q-FACT, Q-REVIEW, Q-AUDIT** em GPT-6.1-terra (usam os rascunhos do Q-DRAFT). Decisão do PM ao final da etapa 1.',
    '**Etapa 2** (só com a etapa 1 aprovada e ok do PM): **Q-GOLDEN**, com revisão humana de todos os rótulos antes de virarem gabarito. **Etapa 3** (pós-lançamento): Opus (Q-PREMIUM, síntese premium) e GPT-6.2-sol.',
    '- Cada chamada grava: `generation id`, modelo que respondeu (`generation.model`), provedor de hospedagem, `usage`, custo conciliado, saída bruta, validade do esquema, e o veredito do critério. Amostras entram no `UsageRecorder` (`measure.ts`): só medição real calibra as premissas de custo dos rituais.',
    '- O executor roda; o **verificador independente** reconsulta `/generation` com a credencial própria e confere o ledger. Ninguém aprova a própria qualificação.',
    '',
    '## 10. Dependências abertas e não verificado',
    '',
    '- T4, T5 (efetividade), T6 (implementação e homologação), T7 (L5), T8, T9, T10 e T11 acima.',
    '- Mínimo de tokens cacheável e TTL do cache por modelo; como o OpenRouter repassa o marcador de cache de cada provedor; campos de `/generation` para escrita de cache.',
    '- Preços de lista do OpenRouter de 22–23/11/2026 vencem em 7 dias (`price_expiry_days`): reconferir na data da execução. ZDR listado **não** é prova de retenção zero.',
    '- Os perfis de token, os números de execuções, o tamanho do golden set (400 itens) e os limiares marcados (proposta) são estimativas da Frente 07; o custo real só se sabe medindo.',
    '',
  ].join('\n');

  return {
    'model-qualification-protocol.md': md,
    'model-qualification-plan.json': `${JSON.stringify(json, null, 2)}\n`,
  };
}
