/**
 * Artefatos versionados da organização agêntica (em `packages/agents/artifacts/`):
 *  - `organization.manifest.json`: perfis, diretorias, redações, workflows e rituais resolvidos;
 *  - `routing-plan.json`: roteamento de modelos e projeção de custo dentro do teto de US$ 50;
 *  - `activation-plan.md`: plano de ativação por fases, com os números do plano de roteamento.
 *
 * Gerados de forma DETERMINÍSTICA (sem data/hora) a partir de `data/` e da política de modelos, e
 * conferidos por teste contra os arquivos do repositório: o artefato não pode ficar para trás.
 * Para regenerar: `UPDATE_ARTIFACTS=1 npx vitest run packages/agents/src/artifacts.test.ts`.
 * Uso de fs/crypto: este módulo não é exportado por `index.ts` (o pacote principal não depende de Node).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPolicyFile } from '@ln/modelops';
import { createBrCalendar } from './calendar';
import { loadRegistries } from './config';
import { buildOrganization, parseSteps } from './organization';
import { buildRoutingPlan, CONSOLIDATION_RITUAL_IDS, DEFAULT_ASSUMPTIONS, type RoutingPlan } from './routing-plan';
import { validateOrganization } from './validator';
import { PKG_DIR, POLICY_FIXTURE } from './paths';
import { buildGateAndDraftArtifacts, type ExtraArtifacts } from './artifacts-extra';
import { buildQualificationArtifacts, type QualificationArtifacts } from './qualification-doc';
import { buildCostRedesignArtifacts, type CostRedesignArtifacts } from './cost-redesign-doc';

export { PKG_DIR, POLICY_FIXTURE };

const usd = (micro: number) => (micro / 1_000_000).toFixed(2);

export interface Artifacts extends ExtraArtifacts, QualificationArtifacts, CostRedesignArtifacts {
  'organization.manifest.json': string;
  'routing-plan.json': string;
  'activation-plan.md': string;
}

function planSummary(p: RoutingPlan) {
  return {
    ok: p.ok,
    expected_usd: usd(p.totals.expectedMicro),
    ceiling_usd: usd(p.totals.ceilingMicro),
    essential_ceiling_usd: usd(p.totals.essentialCeilingMicro),
    non_essential_ceiling_usd: usd(p.totals.nonEssentialCeilingMicro),
    escalation_ceiling_usd: usd(p.totals.escalationCeilingMicro),
    anthropic_headroom_usd: usd(p.headroomMicro.anthropic),
    openai_headroom_usd: usd(p.headroomMicro.openai),
    escalation_headroom_usd: usd(p.headroomMicro.escalation),
  };
}

export function generateArtifacts(): Artifacts {
  const registries = loadRegistries();
  const org = buildOrganization(registries);
  const validation = validateOrganization(org);
  if (!validation.ok) throw new Error(`organização inválida: ${validation.issues.filter((i) => i.severity === 'error').map((i) => i.code).join(', ')}`);

  const policyText = readFileSync(POLICY_FIXTURE);
  const check = loadPolicyFile(POLICY_FIXTURE);
  if (!check.ok || !check.policy) throw new Error(`política de modelos inválida: ${check.errors.join('; ')}`);
  const policySha = createHash('sha256').update(policyText).digest('hex');
  const sources = JSON.parse(readFileSync(join(PKG_DIR, 'data/SOURCES.json'), 'utf8')) as { arquivos: Record<string, { origem: string; sha256: string }> };

  const agentIds = new Set(registries.agents.map((a) => a.id));
  const manifest = {
    schema: 'ln.agents.organization-manifest/1',
    nota: 'GERADO por packages/agents/src/artifacts.ts; não editar. Tudo desligado (enabled=false); nenhum agente OpenBot criado.',
    fontes: sources.arquivos,
    meetings_version: registries.meetingsVersion,
    holiday_calendar: createBrCalendar().version,
    contagens: validation.counts,
    flags_necessarias: ['rituais', 'modelosHabilitados'],
    diretorias: org.directorates,
    redacoes: org.newsrooms.map((n) => ({ editoria: n.editoria, nome: n.name, editor: n.editor, writer: n.writer, director: n.director, daily: n.daily_meeting, memory_scope: n.memory_scope, interactions: n.interactions.map((i) => ({ directorate: i.directorate, agents: i.agents, workflows: i.workflows })) })),
    perfis: registries.agents.map((a) => ({
      id: a.id, name: a.name, department: a.department, reports_to: a.reports_to, scope: a.scope,
      default_route_hint: a.default_route_hint, allowed_tools: a.allowed_tools, kpi: a.kpi, enabled: a.enabled,
      required_result_fields: a.required_result_fields,
    })),
    workflows: registries.workflows.map((w) => ({
      id: w.id, name: w.name, trigger: w.trigger, owner: w.owner, output: w.output, blockers: w.blockers, enabled: w.enabled,
      steps: parseSteps(w.steps, agentIds).map((r) => (r.kind === 'agent' ? { agent: r.agents.length === 1 ? r.agents[0] : r.token, expands_to: r.agents.length > 1 ? r.agents : undefined } : { step: r.token })),
    })),
    rituais: registries.meetings.map((m) => ({
      id: m.id, title: m.title, cycle: m.cycle, schedule_local: m.schedule_local, timezone: m.timezone, chair: m.chair,
      participants: m.participants, quorum_minimum: m.quorum.minimum, route: m.route, depends_on: m.depends_on ?? [], workflow: m.workflow ?? null,
      essential: ['D-editorial', 'D-trust', 'D-sync', 'X-incident'].includes(m.id), consolidation: CONSOLIDATION_RITUAL_IDS.includes(m.id), enabled: m.enabled,
    })),
    recovery_policy: registries.recoveryPolicy,
  };

  const conservative = buildRoutingPlan({ registries, policy: check.policy });
  const digest = buildRoutingPlan({ registries, policy: check.policy, assumptions: { ...DEFAULT_ASSUMPTIONS, digestForConsolidation: true } });
  const routing = {
    schema: 'ln.agents.routing-plan/1',
    nota: 'GERADO. PROJEÇÃO com premissas de tokens NÃO medidas; não é cobrança nem autorização de chamada. Modelos não qualificados (R2-07/08) e production_enabled=false: nenhuma chamada real é feita.',
    politica: { arquivo: 'packages/modelops/fixtures/model.policy.proposto-DP02-v5.json', sha256: policySha, version: check.policy.version, rate_card_as_of: check.policy.rate_card_as_of, status: 'proposta v5 aprovada pelo QA; contrato protegido ainda em v2.1' },
    unidade_de_custo: 'micro-USD (1 USD = 1_000_000)',
    cenario_conservador: { descricao: 'todo participante gera insumo por chamada de modelo', resumo: planSummary(conservative), plano: conservative },
    cenario_digest_na_consolidacao: { descricao: `insumos dos rituais de consolidação (${CONSOLIDATION_RITUAL_IDS.join(', ')}) vêm de digest determinístico (ADR-014); só a síntese do presidente chama modelo`, resumo: planSummary(digest), plano: digest },
  };

  return {
    'organization.manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'routing-plan.json': `${JSON.stringify(routing, null, 2)}\n`,
    'activation-plan.md': renderActivationPlan(validation.counts, conservative, digest, policySha),
    ...buildGateAndDraftArtifacts(registries, conservative),
    ...buildQualificationArtifacts(check.policy, policySha),
    ...buildCostRedesignArtifacts(check.policy),
  };
}

function renderActivationPlan(counts: Record<string, number>, c: RoutingPlan, d: RoutingPlan, policySha: string): string {
  const top = [...c.rituals].sort((x, y) => y.ceilingMicro - x.ceilingMicro).slice(0, 4);
  return `# Plano de ativação — organização agêntica (Frente 07)

> GERADO por \`packages/agents/src/artifacts.ts\`; não editar. Estado: **nada ativado**. Nenhum agente criado no OpenBot, nenhuma rotina real, nenhuma chamada de modelo.

## 1. O que existe hoje (entregue e testado)
- ${counts.agents} perfis, ${counts.directorates} diretorias, ${counts.newsrooms} redações, ${counts.workflows} workflows e ${counts.meetings} rituais (${counts.dailies} diários, ${counts.weeklies} semanais, ${counts.monthlies} mensais, ${counts.events} por evento) como configuração tipada e validada (\`organization.manifest.json\`).
- Agendador determinístico com janela de recuperação P5 v2, feriados nacionais, idempotência pela data original, atas, decisões e tarefas persistidas em PostgreSQL (migrações 0004/0005 de \`@ln/db\`).
- Tudo \`enabled=false\`; flags \`rituais\` e \`modelosHabilitados\` desligadas em \`@ln/contracts\`.

## 2. Condições para ligar (gates; nenhuma é decidida por este pacote)
| # | Condição | Quem decide | Situação |
|---|---|---|---|
| G1 | Ratificar P5 v2 (item 11 das mudanças protegidas) em lote separado, depois do aceite de R4-11 | Proprietário + verificador | proposta aprovada pelo QA; **não ratificada** |
| G2 | Qualificar modelos (R2-07/08): ID exato, preço, ZDR, avaliação PT-BR | Verificador / FinOps | nenhum modelo qualificado |
| G3 | Banco de staging com as migrações 0004 e 0005 | DevOps | não existe |
| G4 | Ledger de orçamento e saldo do provedor persistidos em PostgreSQL (modelops) | Backend + FinOps | pendente no pacote modelops |
| G5 | Adaptador OpenBot (disparo, webhooks, custos) e mapeamento perfil → agente | Integration + PM | **não criado**; exige aval do PM |
| G6 | Worker determinístico de insumos (05:30, ADR-014) e coletor de insumos estruturados | Backend/Editorial | não existe |
| G7 | Ligar flags em ambiente: \`rituais\` (primeiro só em staging), depois \`modelosHabilitados\` | Proprietário | desligadas |

Critérios medíveis, dono e limiar de cada gate: \`gates.md\` / \`gates.json\` (o que o repositório já prova está marcado "OK offline"; nenhum gate é declarado atendido). Medição real de tokens por chamada para calibrar o custo: \`token-measurement-protocol.md\` e o harness \`src/measure.ts\` (só amostras medidas calibram). Rascunho dos 8 perfis OpenBot (7 diretorias + Publisher), **não criados**: \`openbot-profiles.draft.json\`, para aval do Program Manager.

## 3. Fases (cada uma reversível desligando a flag; só avança com evidência da anterior)
| Fase | O que liga | Modelo? | Critério para avançar | Reversão |
|---|---|---|---|---|
| F0 | Configuração + validador + testes (**feito**) | não | \`npm test\`, validador e artefatos conferem | — |
| F1 | Staging, \`rituais\` ON, coletor do banco, sem insumos | não | Todos os rituais do dia viram \`status_only\` sem insumo; reinício não duplica; feriado e janela corretos (testes R4-11 com calendário 2026–2027) | flag \`rituais\` OFF |
| F2 | 10 dailies de redação com insumos de digest determinístico (G6) | não | Atas e tarefas persistidas; \`model_calls = 0\` | flag OFF |
| F3 | Modelos nos 10 dailies de redação e nos dailies de diretoria (rota economy) | sim (G2, G4, G7) | Custo real ≤ projeção do teto; saída fora do esquema rejeitada (R4-04) | \`modelosHabilitados\` OFF |
| F4 | Consolidação: D-editorial, D-trust, D-sync (essenciais) | sim | D-sync espera os 5 dailies; sem estouro de janela | desligar o ritual |
| F5 | Semanais e mensais; premium/strategic só com motivo e sublimite | sim | Escalonamento ≤ sublimite; decisões protegidas vão ao verificador | desligar o ritual |
| F6 | X-incident (evento) | sim | Teste de incidente simulado | desligar o ritual |

## 4. Roteamento de modelos e teto de US$ 50 (política v5, sha256 \`${policySha.slice(0, 12)}…\`; mês ${c.monthKey})
Premissas de tokens **não medidas** (medir em R4): insumo de participante ${c.assumptions.participantInput.promptTokens}+${c.assumptions.participantInput.cacheReadTokens} (cache) tokens de entrada e até ${c.assumptions.participantInput.maxOutputTokens} de saída; síntese do presidente ${c.assumptions.chairSynthesis.promptTokens}+${c.assumptions.chairSynthesis.cacheReadTokens} de entrada (+${c.assumptions.chairSynthesis.extraPromptTokensPerParticipant} por insumo) e até ${c.assumptions.chairSynthesis.maxOutputTokens} de saída; ${c.assumptions.incidentsPerMonth} incidentes/mês.

| Cenário | Esperado | Teto (reserva) | Escalonamento Opus/Fable (teto) | Folga Anthropic | Verificações |
|---|---|---|---|---|---|
| Conservador (todo insumo por modelo) | US$ ${usd(c.totals.expectedMicro)} | US$ ${usd(c.totals.ceilingMicro)} | US$ ${usd(c.totals.escalationCeilingMicro)} de US$ ${usd(c.caps.escalationSublimitMicro)} | US$ ${usd(c.headroomMicro.anthropic)} de US$ ${usd(c.caps.anthropicAllocationMicro)} | ${c.ok ? 'dentro das regras' : 'FALHA'}${c.checks.some((k) => !k.ok && k.severity === 'warning') ? ' (com aviso de heurística)' : ''} |
| Digest na consolidação | US$ ${usd(d.totals.expectedMicro)} | US$ ${usd(d.totals.ceilingMicro)} | US$ ${usd(d.totals.escalationCeilingMicro)} de US$ ${usd(d.caps.escalationSublimitMicro)} | US$ ${usd(d.headroomMicro.anthropic)} de US$ ${usd(d.caps.anthropicAllocationMicro)} | ${d.ok ? 'dentro das regras' : 'FALHA'}${d.checks.some((k) => !k.ok && k.severity === 'warning') ? ' (com aviso de heurística)' : ''} |

- Rotas: dailies economy (Haiku 5.5), consolidação e semanais review (Sonnet 5.5), premium (Opus 5.5: W-cross, M-model, X-incident) e strategic (Fable 5.2: M-board) **só na síntese do presidente**; participantes de rituais premium/strategic usam review. OpenAI fica só na rota de revisão (fact-check, auditoria): rituais não a usam. Imagens e DeepSeek: verba zero.
- Maiores consumidores (teto): ${top.map((r) => `${r.meeting_id} US$ ${usd(r.ceilingMicro)}`).join('; ')}.
- A projeção cobre **só os rituais**. A verba restante (Anthropic e os US$ ${usd(c.caps.openaiAllocationMicro)} da OpenAI, mais a reserva de auditoria) é do trabalho editorial, que tem de caber depois: o volume de matérias não é um dado do Blueprint e não foi assumido aqui.
- O teto é de reserva (faixa de preço mais cara, saída máxima); a cobrança real é conciliada pelo gateway. Degraus 35/40/42/50 e rituais essenciais até 42 seguem ADR-015.

## 5. Mapeamento para o OpenBot (PROPOSTA; nada foi criado)
Pelo ADR-004 os perfis são contratos executados sob demanda, não processos residentes. Hipótese inicial a medir em R4: um agente OpenBot por diretoria (7) mais o Publisher (1), cada um carregando o perfil, o glossário e a memória setorial pedidos pelo disparo. **Requer aval do Program Manager** antes de qualquer criação (G1–G6 atendidos e aval explícito); o tamanho ideal do conjunto ainda não foi medido.

Decisões do PM (23/11/2026): nomes e títulos dos 8 perfis aprovados **como proposta**; a Diretoria Editorial (24 perfis) fica em **1 agente** até a medição real de R4 (menos custo e coordenação). **Critério para dividir a Editorial** (qualquer um, em 30+ execuções medidas; limiares são proposta da Frente 07, a ratificar pelo PM): S1 — p95 do total de entrada por chamada acima de 50% da janela de contexto do menor modelo elegível da rota (a janela não consta da política: verificar em G2); S2 — p95 do tempo do D-editorial (primeiro disparo → ata) acima de 30 min, pois o D-sync das 07:25 depende dele; S3 — p95 da espera do agente editorial pelo lease acima de 5 min, com os 10 dailies das 06:00 e o D-editorial das 06:20 concorrendo. Sem medição, não se divide.

## 6. Riscos e pendências conhecidas
- Rituais dependem do PC ligado de madrugada (DP-03); a janela de recuperação é de 120 min inclusive, depois vira registro de status.
- "Mensal substitui o semanal da mesma semana" não está decidido nem implementado.
- Decisões protegidas (\`pending_verifier\`) e atos reservados (\`pending_human\`) não geram tarefas; falta o fluxo que as materializa depois da aprovação.
- Colisão de ocorrências só foi exercitada com calendário sintético; \`PgStore\` só foi testado em PGlite.
- Feriados: só nacionais; estaduais/municipais e pontos facultativos ficam de fora.
`;
}
