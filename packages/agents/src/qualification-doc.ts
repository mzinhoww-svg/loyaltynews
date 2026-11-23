/** Artefatos do protocolo de qualificação (G2): `model-qualification-protocol.md` e `model-qualification-plan.json`. Não exportado por `index.ts`. */
import type { ModelPolicy } from '@ln/modelops';
import { buildQualificationPlan, criteriaFor, QUAL_BUDGET_PROPOSAL, QUAL_CASES, QUAL_CRITERIA } from './qualification';

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

  const byModel = new Map<string, { calls: number; ceiling: number; expected: number }>();
  for (const c of plan.costs) {
    const cur = byModel.get(c.model) ?? { calls: 0, ceiling: 0, expected: 0 };
    byModel.set(c.model, { calls: cur.calls + c.calls, ceiling: cur.ceiling + c.ceilingMicro, expected: cur.expected + c.expectedMicro });
  }

  const json = {
    schema: 'ln.agents.model-qualification-plan/1',
    nota: 'GERADO. PROJEÇÃO de custo e casos de teste: NADA foi executado e nada pode ser executado até o proprietário decidir a política (production_enabled=false; flag modelosHabilitados desligada). Perfis de token são estimativas da Frente 07, não medição.',
    politica: { arquivo: 'packages/modelops/fixtures/model.policy.proposto-DP02-v5.json', sha256: policySha, version: plan.policyVersion },
    alinhado_com: 'r0-preparacao/finops/proposta-politica-modelos-producao.md (23/11/2026)',
    orcamento_proposto: QUAL_BUDGET_PROPOSAL,
    casos: QUAL_CASES,
    criterios: QUAL_CRITERIA,
    criterios_por_modelo: Object.fromEntries([...byModel.keys()].map((m) => [m, criteriaFor(m)])),
    plano: plan,
  };

  const md = [
    '# Protocolo de qualificação de modelos (G2 / R2-07/08)',
    '',
    '> GERADO por `packages/agents/src/qualification-doc.ts`; não editar. **Nada roda até o proprietário decidir a política de produção.** Nenhuma chamada real foi feita; nenhum resultado de modelo existe. Alinhado a `r0-preparacao/finops/proposta-politica-modelos-producao.md`. Limiares marcados (proposta) são sugestões da Frente 07 a ratificar por FinOps, QA e proprietário.',
    '',
    '## 1. Travas: o que precisa estar decidido ANTES de qualquer chamada',
    '',
    '| # | Trava | Quem decide | Situação |',
    '|---|---|---|---|',
    '| T1 | Critério de produção: aceitar "ZDR listado no OpenRouter" ou exigir a política de retenção de cada provedor por escrito | Proprietário (proposta do FinOps, decisão 1) | aberta |',
    '| T2 | Regra para o DeepSeek V4 Flash como reserva de redação (a reserva de US$ 8 é exclusiva de auditoria) | Proprietário (decisão 2) | aberta; o protocolo **não** qualifica DeepSeek |',
    '| T3 | Fable 5.2 (sem ZDR listado) fora de todo trabalho não publicado | Proprietário (decisão 3) | aberta; o protocolo **não** qualifica Fable; M-board estratégico usa Opus como alternativa |',
    '| T4 | Retenção zero contratual de Google, Amazon Bedrock e Azure, sem treino, região, prazo de exclusão de logs e do cache de prompt | Security + proprietário | não verificada |',
    '| T5 | Política de dados do OpenRouter arquivada e a aprovação do processador efetiva (assinatura protegida, DP-11/P1) | Proprietário + verificador | pendente |',
    '| T6 | **Modo de qualificação no gateway** (R-Q1): hoje o roteador bloqueia modelo não qualificado (`not_qualified`) e só tem os modos `production` e `simulation`. Precisa de um modo que permita SÓ os modelos candidatos deste protocolo, tarefa `model_qualification`, dado classe `public`, `provider.zdr` por chamada, teto próprio, sem tocar a reserva de auditoria, mantendo `production_enabled=false` | Backend + FinOps (mudança de política protegida) | **não existe** |',
    '| T7 | Ledger persistente seguro entre processos (G4) para reservar e conciliar cada chamada | Backend | lacunas L1–L4 abertas |',
    '| T8 | Golden set PT-BR, rubricas e gabaritos de erros plantados (escritos por humanos, fora do modelo) | Editorial + Trust | não existe |',
    '',
    '## 2. Papéis e modelos (proposta do FinOps → casos)',
    '',
    '| Papel | Modelo principal | Reserva | Caso | Regra de política |',
    '|---|---|---|---|---|',
    '| Redação (`editorial_draft`) | claude-haiku-5-5 | nenhuma na v5 | Q-DRAFT | ZDR por chamada em trabalho não publicado |',
    '| Checagem de fatos (`fact_check`) | openai-text-review (GPT-6.1-terra) | openai-text-review-alt (GPT-6.2-sol) | Q-FACT | autor distinto do redator (Anthropic → OpenAI); sem autor distinto, bloqueia |',
    '| Revisão independente (`editorial_review`, gate WF02) | GPT-6.1-terra | GPT-6.2-sol | Q-REVIEW | só tarefas listadas do modelo OpenAI; Sonnet não vale para o gate de rascunho Anthropic |',
    '| Correção e auditoria (`wf08`, `wf18`, `postpublication_audit`) | GPT-6.1-terra | GPT-6.2-sol | Q-AUDIT | reserva de US$ 8 só acima do degrau 42 |',
    '| Rituais (insumo e síntese) | claude-haiku-5-5 (economy), claude-sonnet-5-5 (review) | — | Q-RITUAL-IN, Q-RITUAL-SYN | essenciais até o degrau 42 |',
    '| Premium / board mensal | claude-opus-5-5 | — | Q-PREMIUM, Q-RITUAL-SYN | escalonamento: motivo e sublimite de US$ 5 |',
    '| Cache e custo (todos os candidatos) | os 5 modelos acima | — | Q-CACHE | `cached_tokens > 0`; sem cache o custo não cabe (`cache_failure`) |',
    '',
    '## 3. Casos de teste',
    '',
    '| Caso | Papel | Modelos | Execuções × chamadas | Entrada (sempre classe `public`) | Precisa existir |',
    '|---|---|---|---|---|---|',
    ...QUAL_CASES.map((c) => `| ${c.id} | ${c.role} | ${c.models.map(label).join(', ')} | ${c.runsPerModel} × ${c.callsPerRun} por modelo | ${c.input} | ${c.needs} |`),
    '',
    'Regras comuns: entrada **só** classe `public` (publicada, sintética ou sanitizada; nenhum dado pessoal, embargado, confidencial ou rascunho inédito); `data_collection: deny` e `provider.zdr=true` em toda chamada; mesma redação de prompt e `temperature` fixa em todas as execuções para comparar; modelo fixado pelo `canonical_slug` da política; todo resultado fica no ledger e na pasta de evidências com `generation id`.',
    '',
    '## 4. Critérios de aprovação',
    '',
    '| Critério | O que prova | Como medir | Limiar |',
    '|---|---|---|---|',
    ...QUAL_CRITERIA.map((c) => `| ${c.id} | ${c.text} | ${c.measure} | ${c.threshold}${c.proposed ? ' (proposta)' : ''} |`),
    '',
    'Um modelo só é **qualificado** quando TODOS os critérios dos casos de que participa passam (`decide()` em `src/qualification.ts`); critério sem evidência ou inconclusivo impede a qualificação. Critérios por modelo:',
    '',
    ...[...byModel.keys()].map((m) => `- ${label(m)}: ${criteriaFor(m).join(', ')}`),
    '',
    '## 5. Como medir o cache (`cached_tokens > 0`)',
    '',
    '1. Montar um prefixo estável determinístico de ~6.000 tokens (acima do mínimo cacheável do modelo: **a verificar por modelo**) e uma pergunta curta que muda.',
    '2. **Par de chamadas** por modelo, a 2ª dentro do prazo de vida do cache (TTL: **a verificar por modelo**; os preços de gravação de 5 min e 1 h estão na política): chamada 1 grava o prefixo; chamada 2 deve ler.',
    '3. Registrar, em cada chamada, `usage.prompt_tokens`, `usage.prompt_tokens_details.cached_tokens`, `usage.completion_tokens` e `usage.cost`.',
    '4. Aprovar (`QC-CACHE-HIT`) se na chamada 2 `cached_tokens > 0` nos **5 de 5** pares do modelo, e o custo da chamada 2 for menor que o da chamada 1 com a mesma saída. A parte lida do cache deve ser cobrada ao preço de leitura da política (ex.: Haiku US$ 0,01 por milhão).',
    '5. Reprovar e **parar a rota** se `cached_tokens` for 0 na chamada 2 (política: `cache_failure`: medir/parar se o custo não couber). Sem cache o custo mensal não cabe no teto (US$ 77–109 contra US$ 50, segundo o FinOps).',
    '6. O `usage` do chat não informa gravação de cache: o custo da escrita é conciliado pela consulta de geração (`/generation`) com a credencial própria do verificador (DP-06); os campos exatos dessa resposta **não foram verificados**.',
    '',
    '## 6. Como medir o custo por chamada',
    '',
    '1. Antes: reservar no gateway o **teto** da chamada (`estimateMicro` na faixa de preço mais cara, saída máxima); custo desconhecido bloqueia.',
    '2. Depois: gravar `usage.cost` e conciliar com o `total_cost` da geração; calcular o esperado por `tokens × preço de lista` (entrada sem cache, leitura e escrita de cache, saída).',
    '3. Aprovar (`QC-COST`) se o desvio for ≤ 10% (proposta) e nenhuma chamada passar da reserva; chamada sem custo informado reprova.',
    '4. Relatório por caso e por modelo: tokens, custo real, custo esperado, teto reservado, desvio.',
    '',
    '## 7. Orçamento máximo da qualificação (DP-04)',
    '',
    `- **Teto proposto: US$ ${QUAL_BUDGET_PROPOSAL.hardCapUsd}** (≈ 10% do teto mensal de US$ 50), consumido do mês em que rodar e das verbas por provedor (Anthropic US$ 22, OpenAI US$ 20); **não** usa a reserva de US$ 8 (só auditoria) nem verba de DeepSeek/imagens (zero).`,
    `- Projeção (política v5 ${plan.policyVersion}, sha256 \`${policySha.slice(0, 12)}…\`): **${plan.totals.calls} chamadas**; esperado US$ ${usd(plan.totals.expectedMicro)}; teto de reserva US$ ${usd(plan.totals.ceilingMicro)}; com ${Math.round(QUAL_BUDGET_PROPOSAL.retryAllowance * 100)}% de reexecução US$ ${usd(plan.totals.ceilingWithRetriesMicro)} (folga de ${usd(plan.caps.hardCapMicro - plan.totals.ceilingWithRetriesMicro)} sobre o teto proposto).`,
    `- Por provedor (teto com reexecução): ${Object.entries(plan.totals.byProviderCeilingWithRetriesMicro).map(([p, v]) => `${p} US$ ${usd(v)}`).join('; ')}. Opus (escalonamento): US$ ${usd4(plan.totals.escalationCeilingWithRetriesMicro)} de no máximo US$ ${usd(plan.caps.escalationLimitMicro)} (20% do sublimite de US$ 5), com motivo registrado por execução.`,
    '',
    '| Modelo | Chamadas | Esperado (US$) | Teto de reserva (US$) |',
    '|---|---|---|---|',
    ...[...byModel.entries()].map(([m, v]) => `| ${label(m)} | ${v.calls} | ${usd4(v.expected)} | ${usd4(v.ceiling)} |`),
    '',
    `Verificações do plano: ${plan.checks.map((c) => `${c.ok ? 'OK' : 'FALHA'} ${c.id}`).join('; ')}.`,
    '',
    'Parada do orçamento: ao consumir 80% do teto da qualificação (fração `soft_budget_fraction` da política) o executor para e pede decisão; custo desconhecido, falha de cache, ZDR fora da lista ou 3 saídas inválidas seguidas do mesmo modelo também param a execução. Rodar no início do mês, antes da carga de produção, para não disputar os degraus de 35/40/42.',
    '',
    '## 8. Ordem de execução e evidência',
    '',
    '1. **Q-CACHE** (smoke de cache, usage, ZDR e custo; 50 chamadas curtas): quem falha no cache já está desqualificado e não gasta o resto.',
    '2. **Q-RITUAL-IN / Q-RITUAL-SYN** em Haiku e Sonnet; 3. **Q-DRAFT** em Haiku; 4. **Q-FACT, Q-REVIEW, Q-AUDIT** em GPT-6.1-terra e GPT-6.2-sol (usam os rascunhos do Q-DRAFT); 5. **Q-PREMIUM** e a síntese em Opus por último (escalonamento).',
    '- Cada chamada grava: `generation id`, modelo que respondeu (`generation.model`), provedor de hospedagem, `usage`, custo conciliado, saída bruta, validade do esquema, e o veredito do critério. Amostras entram no `UsageRecorder` (`measure.ts`): só medição real calibra as premissas de custo dos rituais.',
    '- O executor roda; o **verificador independente** reconsulta `/generation` com a credencial própria e conferem o ledger. Ninguém aprova a própria qualificação.',
    '',
    '## 9. Dependências abertas e não verificado',
    '',
    '- R-Q1 (modo de qualificação no gateway) e T1–T8 acima.',
    '- Mínimo de tokens cacheável e TTL do cache por modelo; como o OpenRouter repassa o marcador de cache de cada provedor; campos de `/generation` para escrita de cache.',
    '- Preços de lista do OpenRouter de 22–23/11/2026 vencem em 7 dias (`price_expiry_days`): reconferir na data da execução. ZDR listado **não** é prova de retenção zero.',
    '- Os perfis de token, os números de execuções e os limiares marcados (proposta) são estimativas da Frente 07; o custo real só se sabe medindo.',
    '',
  ].join('\n');

  return {
    'model-qualification-protocol.md': md,
    'model-qualification-plan.json': `${JSON.stringify(json, null, 2)}\n`,
  };
}
