/** Artefatos de gates, perfis OpenBot (rascunho) e protocolo de medição. Parte de `artifacts.ts`; não exportado por `index.ts`. */
import type { loadRegistries } from './config';
import { evaluateGatesOffline, GATES } from './gates';
import { buildCallPrompt, estimateTokens, MEASUREMENT_PROTOCOL, stat } from './measure';
import { buildOpenBotDraft, validateOpenBotDraft } from './openbot-profiles';
import type { RoutingPlan } from './routing-plan';

export interface ExtraArtifacts {
  'gates.json': string;
  'gates.md': string;
  'openbot-profiles.draft.json': string;
  'token-measurement-protocol.md': string;
}

export function buildGateAndDraftArtifacts(registries: ReturnType<typeof loadRegistries>, plan: RoutingPlan): ExtraArtifacts {
  const evaluation = evaluateGatesOffline();
  const draft = buildOpenBotDraft(registries);
  const draftIssues = validateOpenBotDraft(draft, registries);
  if (draftIssues.length) throw new Error(`rascunho de perfis OpenBot inválido: ${draftIssues.map((i) => i.code).join(', ')}`);

  const evalById = new Map(evaluation.map((e) => [e.criterion, e]));
  const gates = GATES.map((g) => ({
    id: g.id,
    name: g.name,
    decidedBy: g.decidedBy,
    atendido: false, // nenhum gate é declarado atendido por este pacote
    criterios: g.criteria.map((c) => ({ ...c, avaliacao_offline: evalById.get(c.id) ?? null })),
  }));
  const gatesJson = {
    schema: 'ln.agents.gates/1',
    nota: 'GERADO. `met_offline` = conferido no repositório; `external` = depende de staging, ratificação, medição real ou terceiros. Nenhum gate está atendido: a decisão é de quem consta em decidedBy.',
    gates,
  };

  const label: Record<string, string> = { met_offline: 'OK offline', unmet: 'NÃO atendido', external: 'externo' };
  const gatesMd = [
    '# Gates G1–G6 — critérios medíveis',
    '',
    '> GERADO por `packages/agents/src/artifacts.ts`; não editar. Nenhum gate está atendido: "OK offline" é só o que o repositório prova; o restante depende de staging, ratificação, medição real ou terceiros. Limiares marcados (proposta) são sugestões da Frente 07 a ratificar.',
    '',
    ...GATES.flatMap((g) => [
      `## ${g.id} — ${g.name}`,
      `Decide: ${g.decidedBy}`,
      '',
      '| Critério | Como medir | Limiar | Dono | Hoje |',
      '|---|---|---|---|---|',
      ...g.criteria.map((c) => {
        const e = evalById.get(c.id);
        return `| ${c.id} ${c.text} | ${c.measure} | ${c.threshold}${c.proposedThreshold ? ' (proposta)' : ''} | ${c.owner} | ${c.timeDependent ? 'depende da data' : label[e?.status ?? 'external']}${e ? ` — ${e.evidence}` : ''} |`;
      }),
      '',
    ]),
  ].join('\n');

  // linha de base de tamanho de prompt, por caracteres, com os dados reais dos perfis (sem memória setorial)
  const meeting = registries.meetings[0]!;
  const base = registries.agents.map((a) => buildCallPrompt({ profile: a, meeting, role: 'participant_input' }));
  const staticTokens = stat(base.map((b) => b.cacheReadTokens));
  const taskTokens = stat(base.map((b) => b.promptTokens));
  const protocol = [
    '# Protocolo de medição de tokens por chamada (R4)',
    '',
    '> GERADO. Sem chamadas reais: o harness (`packages/agents/src/measure.ts`) só estima por caracteres e só calibra com amostras MEDIDAS.',
    '',
    `**Objetivo:** ${MEASUREMENT_PROTOCOL.objective}`,
    '',
    '## Pré-condições',
    ...MEASUREMENT_PROTOCOL.preconditions.map((x) => `- ${x}`),
    '',
    '## Amostragem',
    `- Mínimo de ${MEASUREMENT_PROTOCOL.sampling.minSamplesPerRolePerRoute} amostras medidas por papel (${MEASUREMENT_PROTOCOL.sampling.strata.join(', ')}); rotas: ${MEASUREMENT_PROTOCOL.sampling.routes.join(', ')}.`,
    `- ${MEASUREMENT_PROTOCOL.sampling.note}.`,
    '',
    '## Campos registrados por chamada',
    ...MEASUREMENT_PROTOCOL.recordedFields.map((x) => `- ${x}`),
    '',
    '## Limitações',
    ...MEASUREMENT_PROTOCOL.limitations.map((x) => `- ${x}`),
    '',
    '## Saídas',
    ...MEASUREMENT_PROTOCOL.outputs.map((x) => `- ${x}`),
    '',
    '## Linha de base ESTIMADA por caracteres (não é medição)',
    `Para os ${registries.agents.length} perfis, sem memória setorial: parte estável (missão + contrato de saída + política de ferramentas) em média ${Math.round(staticTokens.mean)} tokens (p95 ${Math.round(staticTokens.p95)}, máx. ${Math.round(staticTokens.max)}); parte variável da pauta ${Math.round(taskTokens.mean)} tokens (máx. ${Math.round(taskTokens.max)}). A premissa do plano de custo é ${plan.assumptions.participantInput.cacheReadTokens} tokens em cache e ${plan.assumptions.participantInput.promptTokens} sem cache por insumo: a diferença para a base estimada é a memória setorial e o contexto que ainda não existem, e a medição deve revelá-la. Conversão usada: ${estimateTokens('x'.repeat(360))} tokens por 360 caracteres (3,6 caracteres/token em PT-BR, sem tokenizador).`,
    '',
  ].join('\n');

  return {
    'gates.json': `${JSON.stringify(gatesJson, null, 2)}\n`,
    'gates.md': `${gatesMd}\n`,
    'openbot-profiles.draft.json': `${JSON.stringify(draft, null, 2)}\n`,
    'token-measurement-protocol.md': protocol,
  };
}
