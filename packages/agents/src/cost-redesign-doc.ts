/** Artefatos do redesenho de custo (DP-27): `cost-redesign.md` e `cost-redesign.json`. Não exportado por `index.ts`. */
import type { ModelPolicy } from '@ln/modelops';
import { loadRegistries } from './config';
import { breakEvenTokenScale, BUSINESS_DAYS_PER_MONTH, COMBOS, costCombo, LIMIT_LADDER, SCENARIOS, STEPS, SUBSCRIPTION_LIMITS_UNVERIFIED, type ComboCost } from './cost-redesign';
import { buildRoutingPlan, DEFAULT_ASSUMPTIONS } from './routing-plan';

export interface CostRedesignArtifacts {
  'cost-redesign.md': string;
  'cost-redesign.json': string;
}

const usd = (micro: number, d = 2) => (micro / 1_000_000).toFixed(d);
const tok = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} M` : `${Math.round(n / 1000)} mil`);

export function buildCostRedesignArtifacts(policy: ModelPolicy): CostRedesignArtifacts {
  const registries = loadRegistries();
  const conservative = buildRoutingPlan({ registries, policy });
  const digest = buildRoutingPlan({ registries, policy, assumptions: { ...DEFAULT_ASSUMPTIONS, digestForConsolidation: true } });
  const ritualCosts = { api: conservative.totals.expectedMicro, api_digest: digest.totals.expectedMicro };
  const costs: ComboCost[] = COMBOS.map((c) => costCombo(c, policy, ritualCosts));
  const by = new Map(costs.map((c) => [c.combo.id, c]));
  const capMicro = 50_000_000;
  const G = by.get('G')!;
  const A = by.get('A')!;
  const B = by.get('B')!;
  const A0 = by.get('A0')!;

  // Cobertura mínima da assinatura para a recomendada (G) caber em US$ 50, quando a API paga o excedente:
  // API mensal = fixo + (1 - s) × custo_por_matéria_se_tudo_na_API × volume + auditoria (sempre API)
  const gAllApi = costCombo({ ...G.combo, executors: Object.fromEntries(STEPS.map((s) => [s.id, 'api' as const])), rituals: 'api_digest' }, policy, ritualCosts);
  const auditMicro = G.steps.find((s) => s.step === 'audit')!.apiMicroPerArticle;
  const minCoverage = (perDay: number): number => {
    const vol = perDay * BUSINESS_DAYS_PER_MONTH;
    const fixed = G.fixedMonthlyApiMicro + auditMicro * vol;
    const variableIfAllApi = (gAllApi.apiMicroPerArticle - auditMicro) * vol;
    const room = capMicro - fixed;
    if (variableIfAllApi <= 0) return 0;
    return Math.max(0, Math.min(1, 1 - room / variableIfAllApi));
  };

  const json = {
    schema: 'ln.agents.cost-redesign/1',
    nota: 'GERADO. Modelo PARAMÉTRICO sem chamadas: perfis de tokens por etapa, frações de economia e volume são PREMISSAS da Frente 07; os limites das assinaturas (Claude, Codex) e dos modelos gratuitos NÃO foram verificados. Base: DP-27 (ZDR não exigido; OpenBot nas assinaturas como via principal; API tarifada como complemento dentro de US$ 50).',
    dias_uteis_por_mes: BUSINESS_DAYS_PER_MONTH,
    cenarios_materias_por_dia: SCENARIOS,
    etapas: STEPS,
    custos_rituais_na_api_usd: { conservador: usd(ritualCosts.api), digest: usd(ritualCosts.api_digest) },
    combinacoes: costs.map((c) => ({
      id: c.combo.id,
      titulo: c.combo.title,
      api_usd_por_materia: usd(c.apiMicroPerArticle, 4),
      assinatura_tokens_por_materia: c.subscriptionTokensPerArticle,
      assinatura_chamadas_por_materia: Number(c.subscriptionCallsPerArticle.toFixed(2)),
      custo_fixo_mensal_api_usd: usd(c.fixedMonthlyApiMicro),
      cenarios: Object.fromEntries(Object.entries(c.scenarios).map(([k, v]) => [k, { materias_por_mes: v.articlesPerMonth, api_mensal_usd: usd(v.apiMonthlyMicro), cabe_em_50: v.fits, assinatura_tokens_por_dia: v.subscriptionTokensPerDay }])),
      materias_por_dia_que_cabem_so_na_api: c.maxArticlesPerDayWithinCap,
      etapas: c.steps,
    })),
    sensibilidade_escala_de_tokens_ate_estourar_50: Object.fromEntries(['A', 'A0', 'E'].map((id) => [id, Object.fromEntries(SCENARIOS.map((n) => [n, Number((breakEvenTokenScale(by.get(id)!, n, capMicro) ?? 0).toFixed(2))]))])),
    cobertura_minima_da_assinatura_na_recomendada: Object.fromEntries(SCENARIOS.map((n) => [n, Number(minCoverage(n).toFixed(3))])),
    limites_das_assinaturas: SUBSCRIPTION_LIMITS_UNVERIFIED,
    degraus_no_limite: LIMIT_LADDER,
  };

  const row = (c: ComboCost) => {
    const s = c.scenarios;
    const cell = (n: number) => `${usd(s[n]!.apiMonthlyMicro)} ${s[n]!.fits ? '✓' : '✗'}`;
    return `| ${c.combo.id} | US$ ${usd(c.apiMicroPerArticle, 4)} | ${cell(15)} | ${cell(30)} | ${cell(60)} | ${c.maxArticlesPerDayWithinCap === null ? '—' : c.maxArticlesPerDayWithinCap} |`;
  };
  const subRow = (c: ComboCost) => {
    const t = c.subscriptionTokensPerArticle;
    const total = t.claude + t.codex + t.any + t.free;
    return `| ${c.combo.id} | ${c.subscriptionCallsPerArticle.toFixed(1)} | ${tok(t.claude + t.any)} | ${tok(t.codex)} | ${tok(t.free)} | ${tok(total)} | ${tok(total * 15)} / ${tok(total * 30)} / ${tok(total * 60)} |`;
  };

  const md = [
    '# Redesenho de custo por matéria (DP-27) — contribuição da Frente 07 (AgentOps)',
    '',
    '> GERADO por `packages/agents/src/cost-redesign-doc.ts`; não editar. **Sem chamadas pagas.** O FinOps lidera a consolidação; esta é a contribuição do AgentOps (modelo reproduzível: `src/cost-redesign.ts`, testado). **Premissas, não medições:** perfis de tokens por etapa, frações de economia e volume. **Não verificado:** os limites de uso das assinaturas (Claude, Codex) e dos modelos gratuitos. Preços e IDs: política de modelos (v5; os preços dos candidatos são os mesmos da v6).',
    '',
    '## 1. Resumo',
    '',
    `- **Premissas leves deste modelo** (≈ ${tok(STEPS.reduce((n, st) => n + st.callsPerArticle * (st.coverage ?? 1) * (st.profile.promptTokens + st.profile.cacheReadTokens), 0))} tokens de entrada por matéria, quase todos lidos do cache): só API tarifada (A, base DP-26) custa **US$ ${usd(A.apiMicroPerArticle, 3)} por matéria** e **US$ ${usd(A.scenarios[15]!.apiMonthlyMicro)} / ${usd(A.scenarios[30]!.apiMonthlyMicro)} / ${usd(A.scenarios[60]!.apiMonthlyMicro)} por mês** a 15/30/60 matérias por dia (inclui rituais e verificador): coube nos três cenários.`,
    `- **Isso NÃO é a conclusão.** O Arquiteto (perfis de ~110–140 mil tokens de entrada por matéria, premissas da auditoria) chega a US$ 0,08 por matéria só com cache e US$ 0,278 sem cache — **${(0.08 / (A.apiMicroPerArticle / 1_000_000)).toFixed(1)}× e ${(0.278 / (A0.apiMicroPerArticle / 1_000_000)).toFixed(1)}× o meu** (com e sem cache) — e a auditoria do FinOps dá US$ 29–37 por mês a 6 matérias por dia. Com esses perfis a API sozinha estoura em 30–60 por dia. **A decisão depende da premissa de tokens por matéria, que ninguém mediu**: ver a sensibilidade (seção 4b) e o piloto de 10 matérias.`,
    `- **Robusto às premissas:** (i) com a via OpenBot principal (DP-27) a API tarifada paga só a auditoria por amostragem e o verificador (US$ ${usd(G.scenarios[15]!.apiMonthlyMicro)}–${usd(G.scenarios[60]!.apiMonthlyMicro)} por mês neste modelo; mesmo multiplicando os tokens por ${Math.round(breakEvenTokenScale(G, 60, capMicro) ?? 0)} a 60/dia ainda caberia), então o dinheiro deixa de ser o gargalo e o gargalo vira o **limite de uso das assinaturas** (seção 4); (ii) o cache de prompt é obrigatório; (iii) a checagem de fatos por modelo em toda matéria não deve ser amostrada sem decisão (Blueprint §6/WF02).`,
    '',
    '## 2. Custo por matéria e por mês (API tarifada, esperado), por combinação',
    '',
    'Fixo mensal já incluso: rituais na API (nas combinações A, A0, E) e aceites do verificador (≈ US$ 0,50, informado pelo PM). 22 dias úteis por mês. ✓ = cabe nos US$ 50.',
    '',
    '| Combinação | API por matéria | 15/dia (US$/mês) | 30/dia | 60/dia | Máx. matérias/dia só na API |',
    '|---|---|---|---|---|---|',
    ...costs.map(row),
    '',
    ...costs.map((c) => `- **${c.combo.id}** — ${c.combo.title}`),
    '',
    '## 3. Demanda das assinaturas (o que as combinações com OpenBot exigem)',
    '',
    'Tokens por matéria = entrada + leitura de cache + saída esperada, somando as etapas que rodam no OpenBot (a via **Codex** é a de checagem e revisão: autor diferente do redator Claude, sem custo de API). Por dia = por matéria × volume.',
    '',
    '| Combinação | Chamadas por matéria | Claude (tokens/matéria) | Codex (tokens/matéria) | Gratuitos (tokens/matéria) | Total por matéria | Total por dia a 15 / 30 / 60 |',
    '|---|---|---|---|---|---|---|',
    ...costs.filter((c) => c.subscriptionCallsPerArticle > 0 || c.subscriptionTokensPerArticle.free > 0).map(subRow),
    '',
    `Limites das assinaturas: ${SUBSCRIPTION_LIMITS_UNVERIFIED.claude}; ${SUBSCRIPTION_LIMITS_UNVERIFIED.codex}; ${SUBSCRIPTION_LIMITS_UNVERIFIED.free}. O Arquiteto relata que o OpenBot não expõe tokens e que o Codex já bateu o limite na implantação: por isso proponho (e ele também) um **piloto de 10 matérias** para medir quantas matérias cabem por janela de limite, antes de fixar qualquer volume.`,
    '',
    '## 4. O que acontece quando a assinatura bate o limite',
    '',
    '| Degrau | Gatilho | Ação |',
    '|---|---|---|',
    ...LIMIT_LADDER.map((l) => `| ${l.level} | ${l.trigger} | ${l.action} |`),
    '',
    'Quanto a API precisa cobrir (recomendada G, o restante vira API): para caber em US$ 50 a assinatura precisa cobrir pelo menos **' +
      SCENARIOS.map((n) => `${Math.round(minCoverage(n) * 100)}% a ${n}/dia`).join(', ') +
      '** do trabalho de modelo (auditoria sempre na API). Abaixo disso, o orçamento da API estoura antes do fim do mês e entram os degraus 35/40/42 da política.',
    '',
    '## 4b. Sensibilidade: quanto as premissas podem estar erradas',
    '',
    'Escala de tokens (todos os perfis multiplicados) até a API tarifada estourar US$ 50 no mês, por combinação só-API e volume. Se o custo real por matéria for X vezes o deste modelo e X for maior que o número da tabela, a combinação **não cabe**.',
    '',
    '| Combinação (só API) | 15/dia | 30/dia | 60/dia |',
    '|---|---|---|---|',
    ...['A', 'A0', 'E'].map((id) => `| ${id} | ${SCENARIOS.map((n) => `${(breakEvenTokenScale(by.get(id)!, n, capMicro) ?? 0).toFixed(1)}×`).join(' | ')} |`),
    '',
    `Leitura: a combinação A a 30 por dia só aguenta tokens até ${(breakEvenTokenScale(A, 30, capMicro) ?? 0).toFixed(1)}× o deste modelo; o Arquiteto está em ~${(0.08 / (A.apiMicroPerArticle / 1_000_000)).toFixed(1)}× (com cache). Por isso a medição real de tokens por matéria (piloto) vem **antes** de fixar volume ou política.`,
    '',
    '## 5. Cada alavanca avaliada (prós, contras, impacto em qualidade e privacidade)',
    '',
    '| Alavanca | Efeito no custo (por matéria, API) | Prós | Contras e riscos | Qualidade / privacidade |',
    '|---|---|---|---|---|',
    `| (1) OpenBot nas assinaturas (B) | US$ ${usd(A.apiMicroPerArticle, 3)} → ${usd(B.apiMicroPerArticle, 3)} | custo marginal de API ~zero; Claude redige e Codex checa = autor distinto sem API | limite de uso desconhecido; sem \`generation id\`/custo conciliável (evidência de identidade do modelo mais fraca); PC ligado; **risco dos termos das assinaturas para uso automatizado ACEITO pelo proprietário (DP-30)**: mitigar separando o uso de produto do de implementação e mantendo a rota de API pronta; revoga a regra "assinatura só para implementação" (DP-04/DP-05) | qualidade igual (mesmos modelos); privacidade: DP-27 aceita retenção; **dado pessoal continua fora** até decisão |`,
    `| (2) Modelos gratuitos (F) | US$ ${usd(B.apiMicroPerArticle, 3)} → ${usd(by.get('F')!.apiMicroPerArticle, 3)} (só tira tokens da assinatura) | alivia o limite das assinaturas em triagem, social e entidades | qualidade NÃO verificada; política de dados dos gratuitos desconhecida; instabilidade de limite | só em etapas de baixo risco e de matéria já publicada; nunca na checagem; atrás de flag (Arquiteto concorda) |`,
    `| (3) Cache agressivo, prompts menores, lote | A0→A: US$ ${usd(by.get('A0')!.apiMicroPerArticle, 3)} → ${usd(A.apiMicroPerArticle, 3)} (cache); prompts −25%: ver E/G | maior alavanca na API; o cache é obrigatório na política | cache precisa ser comprovado por modelo (G2: \`cached_tokens > 0\`); sem cache a API não cabe | nenhum impacto de qualidade |`,
    `| (4) Determinístico no lugar de modelo (C) | US$ ${usd(B.apiMicroPerArticle, 3)} → ${usd(by.get('C')!.apiMicroPerArticle, 3)} na API; tira ${tok(B.subscriptionTokensPerArticle.claude + B.subscriptionTokensPerArticle.codex + B.subscriptionTokensPerArticle.any - (by.get('C')!.subscriptionTokensPerArticle.claude + by.get('C')!.subscriptionTokensPerArticle.codex + by.get('C')!.subscriptionTokensPerArticle.any))} tokens/matéria da assinatura | barato, auditável, reproduzível (dedupe, whitelist de fontes, formatação, conferir números e citações contra a fonte) | só funciona onde há regra; exige código e testes | melhora a verificabilidade; não substitui a checagem factual por modelo |`,
    `| (5) Checagem por amostragem (D) | tira o custo de checagem das 70% restantes | economiza assinatura e API | **o Blueprint §6/WF02 e o ADR exigem checagem por outro provedor em toda matéria**: amostrar é mudar requisito, não otimizar. Alternativa segura: checagem + editor em UMA chamada (−24% segundo o Arquiteto) e checagem determinística de números/fontes em 100% | amostragem reduz a garantia de qualidade; **só com decisão do proprietário** |`,
    '',
    '## 6. Recomendação',
    '',
    '1. **Via principal OpenBot (G sem o corte de amostragem):** redação (Claude), checagem e revisão (Codex, autor distinto), rituais, social e entidades nas assinaturas; **API tarifada só para auditoria por amostragem, verificador (≈ US$ 0,50) e excedente** quando a assinatura bater o limite.',
    '2. **Não amostrar a checagem de fatos** (requisito do Blueprint); em vez disso: checagem determinística de números e fontes em 100% + checagem e revisão do editor numa chamada só nas matérias de baixo risco + fila por risco quando o limite apertar.',
    `3. **Cache e prompts menores** em toda chamada da API (obrigatório pela política; neste modelo, sem cache a combinação A custa ${(by.get('A0')!.apiMicroPerArticle / A.apiMicroPerArticle).toFixed(1)}× mais).`,
    '4. **Piloto de 10 matérias antes de fixar o volume**, para medir tokens por matéria, matérias por janela de limite de cada assinatura e a qualidade; só então escolher 15, 30 ou 60 por dia.',
    '5. **Gratuitos:** só social/SEO/entidades de matéria já publicada, atrás de flag, depois de medir a qualidade.',
    '',
    '## 7. O que muda na política (DP-26 → DP-27; o Arquiteto edita a v7, eu não toco no contrato protegido)',
    '',
    '- **Revogado:** ZDR por chamada como critério de privacidade (DP-26 a). O protocolo de qualificação já trata `QC-ZDR` como informativo.',
    '- **Muda a regra de acesso:** a política v5/v6 diz "acesso medido só via OpenRouter; assinaturas do OpenBot não valem para chamada de modelo do produto". A DP-27 inverte a ordem: **rota OpenBot principal**, API tarifada complementar. A v7 precisa de uma rota `openbot_subscription` e de regras para ela.',
    '- **Evidência e ledger:** a chamada pela assinatura não tem `generation id` nem custo do OpenRouter: precisa de evidência própria (id da execução do agente, modelo informado, tokens estimados) e de um contador de uso (quota, não dinheiro). Autor distinto passa a ser **identidade do agente** (Claude × Codex), mais fraca que o prefixo de `generation.model`.',
    '- **Mantém-se:** sem reserva na redação, Fable fora do não publicado, reserva de US$ 8 só para auditoria, teto de US$ 50 na API, dado pessoal fora até decisão, checagem por outro provedor em toda matéria.',
    '- **ADR-003:** hoje manda toda chamada de modelo passar pelo gateway do LN e pelo OpenRouter; a DP-27 exige emenda do ADR (execução direta pelos agentes do OpenBot).',
    '',
    '## 8. Cruzamento com o modelo do Arquiteto',
    '',
    'O Arquiteto publicou `fast-track/custo/redesenho-custo-arquiteto.md` (modelo próprio, premissas da auditoria): só API, US$ 0,278 por matéria (sem cache) → 0,042 (tudo aplicado); 15/dia US$ 19, 30/dia US$ 38, 60/dia US$ 75 (estoura). Meus números partem de outro conjunto de premissas (perfis de tokens por etapa do protocolo de qualificação) e dão custo por matéria diferente; **a diferença vem das premissas, não de erro de conta**: cabe ao FinOps reconciliar os dois modelos e travar uma única base. As conclusões coincidem: o cache decide, a API sozinha só aguenta volumes menores, o OpenBot principal resolve o dinheiro e traz o risco de limite, e a checagem por amostragem conflita com o Blueprint.',
    '',
    '## 9. Não verificado',
    '',
    '- Limites e janelas de uso das assinaturas; se o OpenBot expõe consumo; política de dados dos modelos gratuitos. O risco dos termos dos provedores para uso automatizado em produção é **aceito pelo proprietário (DP-30)**: registrar na política v7 e no livro; mitigação recomendada: separar produto e implementação e manter a rota de complemento pela API pronta.',
    '- Todos os perfis de tokens, as frações de economia e a premissa de 22 dias úteis por mês; o custo real só se sabe medindo (protocolo de medição e piloto).',
    '- Preços de lista de 22–23/11/2026 (vencem em 7 dias).',
    '',
  ].join('\n');

  return { 'cost-redesign.md': md, 'cost-redesign.json': `${JSON.stringify(json, null, 2)}\n` };
}
