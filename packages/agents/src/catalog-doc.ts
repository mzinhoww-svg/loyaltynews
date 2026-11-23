/** Artefatos do catálogo dos 28 rituais e 19 workflows: `catalog.json` e a tabela de lacunas. Não exportado por `index.ts`. */
import type { LoadedRegistries } from './config';
import { buildCatalog, checkReviewSameProvider, validateCatalog, writeCheckPairs } from './catalog';
import { buildOrgProfiles } from './org-profiles';
import { ARTIFACT_SCHEMAS, OUTPUT_LABEL_KIND, PROPOSED_GATES } from './catalog-schemas';

export interface CatalogArtifacts {
  'catalog.json': string;
  'catalog-gaps.md': string;
}

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');

export function buildCatalogArtifacts(registries: Pick<LoadedRegistries, 'agents' | 'meetings' | 'workflows'>): CatalogArtifacts {
  const catalog = buildCatalog(registries);
  const org = buildOrgProfiles(registries);
  const issues = validateCatalog(catalog, registries, org);
  if (issues.length) throw new Error(`catálogo inválido: ${issues.map((i) => i.code).join(', ')}`);
  const sameProvider = checkReviewSameProvider(catalog, org);
  const pairs = writeCheckPairs(catalog, org);
  const pairWf = [...new Set(pairs.map((p) => p.workflow))];

  const ritualRows = catalog.rituals.map((r) => {
    const entrada = `família \`${r.input.family}\` (ParticipantInput + payload)${r.input.event_trigger ? ' + gatilho do evento' : ''}; ${r.input.from_digest ? 'digest determinístico (ADR-014)' : 'um insumo por participante'}${r.input.depends_on.length ? `; depende de ${r.input.depends_on.join(', ')}` : ''}${r.input.workflow ? `; workflow ${r.input.workflow}` : ''}`;
    const saida = r.output.artifacts.map((a) => `${a.label} (${a.kind})`).join(', ');
    return `| \`${r.id}\` | ${r.cycle} ${cell(r.cadence.schedule_local)} | ${r.participants.length} (preside \`${r.chair}\`; quórum ${r.quorum.minimum}) | ${cell(entrada)} | ${cell(saida)} | ✓ \`MeetingOutcomeRecord\` |`;
  });

  const ruleOf = (id: string) => catalog.independence.find((r) => r.workflow === id);
  const workflowRows = catalog.workflows.map((w) => {
    const etapas = w.stages.map((s) => s.tokens.map((t) => t.token).join(' + ')).join(' → ');
    const rule = ruleOf(w.id);
    const roles = rule ? `✓ ${[...rule.authors].join('/')} ≠ ${[...rule.checkers, ...rule.reviewers].join(' ≠ ')}` : pairWf.includes(w.id) ? '✓ regra geral (escrita → checagem)' : 'sem passo de escrita seguido de checagem';
    const gates = w.gates.map((g) => `${g.id}${g.source === 'proposal' ? ' (proposta)' : ''}`).join(', ');
    const stageKinds = [...new Set(w.stages.flatMap((s) => s.tokens.map((t) => t.evidence)))].join(', ');
    return `| \`${w.id}\` | ${cell(etapas)} | \`${w.owner}\` | ${gates} | ${cell(`${w.evidence.artifact}; bloqueios: ${w.evidence.fail_closed_blockers.join(', ')}; evidência por etapa: ${stageKinds}`)} | ${roles} |`;
  });

  const kinds = Object.keys(ARTIFACT_SCHEMAS);
  const proposed = Object.entries(PROPOSED_GATES).map(([wf, g]) => `${wf} → \`${g.id}\` depois de \`${g.after}\` (${[...g.blockers, ...Object.keys(g.soft ?? {}).map((x) => `${x}: não disponível, sem bloquear`), ...Object.entries(g.routes ?? {}).map(([x, t]) => `${x} → ${t}`)].join(', ')})`);

  const md = [
    '# Catálogo dos 28 rituais e 19 workflows: tabela de lacunas (Frente 07)',
    '',
    '> GERADO por `packages/agents/src/catalog-doc.ts`; não editar. **Nada roda nem chama modelo:** é só o catálogo, desligado (`enabled=false`). Revisão: QA 3.',
    '',
    'Fonte oficial: Blueprint v2.1 §2 e §3, `contracts/meetings.registry.json` e `contracts/workflows.registry.json` (protegidos; cópias byte a byte em `packages/agents/data`, **não alterados**) e os itens R4-11 e R4-12 do backlog. O Blueprint é resumido: onde ele não detalha, o catálogo traz um esquema PROPOSTO pela frente (`catalog-schemas.ts`), marcado como proposta até o Chief Architect ratificar.',
    '',
    '## 1. O que já existia em `packages/agents` e o que o catálogo acrescenta',
    '',
    '| Item | Já existia | Catálogo |',
    '|---|---|---|',
    '| Contagens 28 rituais (18/6/3/1) e 19 workflows | `validator.ts` (`COUNT`) | `RitualSpecSchema` e `WorkflowSpecSchema` (zod estritos) e teste de contagem sobre o catálogo |',
    '| Ids únicos, participantes, presidente, dono, passos, dependências, quórum, rota | `validator.ts` | as mesmas verificações sobre o catálogo normalizado (todo participante é um dos 64 perfis) |',
    '| Cadência (horário, fuso, feriados, janela P5 v2, idempotência) | `scheduler.ts`, `calendar.ts`, `validator.ts` | `cadence` em cada ritual |',
    '| Ata persistida, decisões e tarefas idempotentes | `store.ts` (`MeetingOutcomeRecord`), `pg-store.ts`, migrações 0004/0005 | `output.minutes` em cada ritual |',
    '| Formato da entrada de cada ritual | só `ParticipantInput` genérico no agendador | **família de entrada** (`newsroom_daily`, `directorate_daily`, `sync`, `weekly`, `monthly`, `event`) com `payload` próprio, e o gatilho do evento do `X-incident` |',
    `| Esquema da saída de cada ritual | só rótulos de texto | **${kinds.length} tipos de artefato** com esquema (${kinds.join(', ')}) e o mapa dos ${Object.keys(OUTPUT_LABEL_KIND).length} rótulos distintos de \`outputs\` |`,
    '| Gate explícito de cada workflow | `auto_gate_*` em 14 dos 19 | os 5 sem gate (WF01, WF03, WF09, WF14, WF16) ganham um gate PROPOSTO que cobre os bloqueios do registro |',
    '| Evidência por etapa | só artefato, bloqueios e texto de política | esquema por etapa: `agent_output`, `deterministic_step` e `gate_verdict` (pass exige 0 bloqueios; fail exige pelo menos 1) |',
    `| Independência editorial | regra textual da política e o gate do piloto | dado por editoria em WF02, WF03, WF05 e WF08, mais a **regra geral** (quem checa um texto nunca está no provedor de quem o escreveu) aplicada a todo passo de escrita seguido de checagem (${pairWf.join(', ')}; ${pairs.length} pares) |`,
    '',
    '## 2. Rituais (28): cadência, participantes, entrada, saída e ata',
    '',
    '| Ritual | Cadência | Participantes | Entrada | Saída | Ata persistida |',
    '|---|---|---|---|---|---|',
    ...ritualRows,
    '',
    '## 3. Workflows (19): etapas, responsável, gate, evidência e independência',
    '',
    '| Workflow | Etapas | Responsável | Gate | Evidência | Independência |',
    '|---|---|---|---|---|---|',
    ...workflowRows,
    '',
    '## 4. Lacunas fechadas (ratificadas pelo Chief Architect, com ajustes) e o que continua aberto',
    '',
    '| Id | Situação | Detalhe |',
    '|---|---|---|',
    '| G-R1 | fechada (ratificada com ajustes) | formato da entrada por família de ritual (`RITUAL_INPUT_SCHEMAS`), reaproveitando o `ParticipantInput`; número sempre com `source_ref` e `null` só com `unavailable_reason`; `containment_proposals` como `{text, evidence_refs}` |',
    '| G-R2 | fechada (ratificada com ajustes) | esquema de cada saída por rótulo (`OUTPUT_LABEL_KIND`); rótulo novo sem esquema falha o validador (`OUTPUT_LABEL`); `metric_report` aceita `null` com motivo; decisão `owner_reserved` nunca executa sozinha (D01); `proposal.budget_usd` não reserva (ADR-015) |',
    '| G-R3 | fechada (ratificada com ajustes) | gatilho do `X-incident`: `raised_at` em ISO 8601 com fuso, `severity` obrigatória no `incident`, idempotência por `kind+ref`; `breaking` decide contenção e prioridade e não dispensa WF02 e WF03 |',
    `| G-W1 | fechada (semântica ratificada; WF09 e WF16 ajustados) | gate explícito nos 5 workflows sem \`auto_gate_*\`: ${proposed.join('; ')}. WF09: métrica velha ou sem provedor sai "não disponível" sem bloquear, e o gate falha só com valor velho como atual ou nenhuma métrica válida; WF16: \`overdue\` é desvio para \`escalate_overdue\`; WF03: a despublicação nunca passa pelo gate. O registro protegido NÃO foi alterado |`,
    '| G-W2 | fechada (ratificada com ajustes) | esquema de evidência por etapa (`STAGE_EVIDENCE_SCHEMAS`): `agent_output` com `provider`, `account` e `cost_ref`; `at` em ISO com fuso; bloqueios do `gate_verdict` como subconjunto dos do registro (`validateStageEvidence`) |',
    '| G-W3 | **aberta** | não existe motor de execução dos workflows (por desenho: tudo desligado até o gate R4); Integration, Backend e Editorial, depois do R4 |',
    '| G-P1 | **ratificada com ajustes** (Chief Architect, `fast-track/decisoes/ratificacao-G-P1-catalogo.md`) | os ajustes estão aplicados em `catalog-schemas.ts` e `catalog.ts`. Os esquemas de entrada, saída e evidência ficam em `@ln/agents` (não protegidos). Os 5 gates valem como contrato de código (`PROPOSED_GATES`); formalizá-los no `contracts/workflows.registry.json` é mudança protegida, por ato raiz, sem urgência (G-W3) |',
    `| G-I1 | resolvida (PM-2026-11-23-G) | checagem e revisão diferem do redator em papel e provedor e não precisam diferir entre si; sem terceiro provedor (DP-41). Checagem e revisão no mesmo provedor em: ${sameProvider.join(', ') || 'nenhum'} |`,
    '| G-I2 | resolvida (PM-2026-11-23-G) | em WF08 o texto da correção é redigido no Claude, pelo editor (tarefa `correction_draft` do perfil) ou pelo redator da editoria, e o `factcheck` segue no Codex |',
    '',
    '## 5. Não verificado',
    '',
    '- Nenhum ritual ou workflow foi executado; nenhum modelo foi chamado; o catálogo é configuração.',
    '- Os esquemas propostos não foram revisados pelas diretorias que usariam cada artefato; são ponto de partida.',
    '- A tabela compara o que está no código e nos contratos copiados; não confirmei se o Blueprint integral (além do resumo em `pacote-v2.1-completo`) traz mais detalhe.',
    '',
  ].join('\n');

  return {
    'catalog.json': `${JSON.stringify(catalog, null, 2)}\n`,
    'catalog-gaps.md': md,
  };
}
