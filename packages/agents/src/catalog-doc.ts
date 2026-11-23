/** Artefatos do catálogo dos 28 rituais e 19 workflows: `catalog.json` e a tabela de lacunas. Não exportado por `index.ts`. */
import type { LoadedRegistries } from './config';
import { buildCatalog, checkReviewSameProvider, validateCatalog } from './catalog';
import { buildOrgProfiles } from './org-profiles';

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

  const ritualRows = catalog.rituals.map((r) => {
    const entrada = `${r.input.mode}; ${r.input.from_digest ? 'insumos por digest determinístico (ADR-014)' : 'um insumo estruturado por participante'}${r.input.depends_on.length ? `; depende de ${r.input.depends_on.join(', ')}` : ''}${r.input.workflow ? `; workflow ${r.input.workflow}` : ''}`;
    const lacunas = ['G-R1', 'G-R2', ...(r.cycle === 'event' ? ['G-R3'] : [])].join(', ');
    return `| \`${r.id}\` | ${r.cycle} ${cell(r.cadence.schedule_local)} | ${r.participants.length} (preside \`${r.chair}\`; quórum ${r.quorum.minimum}) | ${cell(entrada)} | ${cell(r.output.artifacts.join(', '))} | ✓ \`MeetingOutcomeRecord\` | ${lacunas} |`;
  });

  const ruleOf = (id: string) => catalog.independence.find((r) => r.workflow === id);
  const workflowRows = catalog.workflows.map((w) => {
    const etapas = w.stages.map((s) => s.tokens.map((t) => t.token).join(' + ')).join(' → ');
    const rule = ruleOf(w.id);
    const indep = rule ? `✓ ${rule.authors.join('/')} ≠ ${[...rule.checkers, ...rule.reviewers].join(' ≠ ')}` : 'não editorial';
    const lacunas = ['G-W2', 'G-W3', ...(w.gates.length === 0 ? ['G-W1'] : [])].join(', ');
    return `| \`${w.id}\` | ${cell(etapas)} | \`${w.owner}\` | ${w.gates.length ? w.gates.join(', ') : '— (sem gate explícito)'} | ${cell(`${w.evidence.artifact}; bloqueios: ${w.evidence.fail_closed_blockers.join(', ')}`)} | ${indep} | ${lacunas} |`;
  });
  const noGate = catalog.workflows.filter((w) => w.gates.length === 0).map((w) => w.id);

  const md = [
    '# Catálogo dos 28 rituais e 19 workflows: tabela de lacunas (Frente 07)',
    '',
    '> GERADO por `packages/agents/src/catalog-doc.ts`; não editar. **Nada roda nem chama modelo:** é só o catálogo, desligado (`enabled=false`). Revisão: QA 3.',
    '',
    'Fonte oficial: Blueprint v2.1 §2 e §3, `contracts/meetings.registry.json` e `contracts/workflows.registry.json` (protegidos; cópias byte a byte em `packages/agents/data`) e os itens R4-11 e R4-12 do backlog. O Blueprint é resumido: o que ele não detalha aparece abaixo como lacuna, não como dado inventado.',
    '',
    '## 1. O que já existe em `packages/agents` e o que este lote acrescenta',
    '',
    '| Item | Já existia | Acrescentado agora |',
    '|---|---|---|',
    '| Contagens 28 rituais (18 diários, 6 semanais, 3 mensais, 1 evento) e 19 workflows | `validator.ts` (`COUNT`) e `validator.test.ts` | catálogo tipado com `RitualSpecSchema` e `WorkflowSpecSchema` (zod estrito) e teste de contagem sobre o catálogo |',
    '| Ids únicos, participantes, presidente, dono, passos, dependências, quórum, rota | `validator.ts` | as mesmas verificações sobre o catálogo normalizado (todo participante é um dos 64 perfis) |',
    '| Cadência (horário, fuso, feriados, janela de recuperação P5 v2, idempotência) | `scheduler.ts`, `calendar.ts`, `validator.ts` | cadência exposta no catálogo (`cadence`) |',
    '| Ata persistida (resumo, bloqueios, evidências, saídas), decisões e tarefas idempotentes | `store.ts` (`MeetingOutcomeRecord`), `pg-store.ts`, migrações 0004/0005 | declarada em cada ritual (`output.minutes`) |',
    '| Etapas, responsável, gate e evidência de cada workflow | só a string `steps`, `owner`, `output`, `blockers` e `policy` do registro | etapas em ordem com agentes expandidos por editoria, gates `auto_gate_*`, evidência (artefato, bloqueios fail-closed, política) |',
    '| Independência editorial (redação ≠ checagem ≠ revisão, provedores diferentes) | regra textual da política e o gate do piloto | dado + validação por editoria em WF02, WF03, WF05 e WF08 contra os provedores dos 64 perfis na v7 |',
    '',
    '## 2. Rituais (28): cadência, participantes, entrada, saída e ata',
    '',
    '| Ritual | Cadência | Participantes | Entrada | Saída | Ata persistida | Lacunas |',
    '|---|---|---|---|---|---|---|',
    ...ritualRows,
    '',
    '## 3. Workflows (19): etapas, responsável, gate, evidência e independência',
    '',
    '| Workflow | Etapas | Responsável | Gate | Evidência | Independência | Lacunas |',
    '|---|---|---|---|---|---|---|',
    ...workflowRows,
    '',
    '## 4. Lacunas (o que o documento oficial não detalha ou o código ainda não faz)',
    '',
    '| Id | Lacuna | Quem decide ou faz |',
    '|---|---|---|',
    '| G-R1 | O registro de rituais traz `mode` e `purpose`, mas **não define o formato da entrada** de cada ritual (o que exatamente cada participante entrega). O catálogo deriva "um insumo estruturado por participante" (ou digest, ADR-014) | Chief Architect (contrato protegido) e Editorial/Diretorias (conteúdo) |',
    '| G-R2 | As saídas (`outputs`) são rótulos de texto, **sem esquema por ritual**; a ata guarda `outputs: string[]`. Falta o schema de cada artefato (pauta priorizada, daily brief, plano mensal etc.) | Chief Architect e o dono de cada ritual |',
    '| G-R3 | `X-incident` é por evento: não tem horário, só gatilho (incidente, breaking, dependência); o formato do gatilho não está no registro | Chief Architect e SRE |',
    `| G-W1 | Workflows **sem gate automático explícito** nas etapas: ${noGate.join(', ')}. Hoje só os bloqueios fail-closed os protegem | Chief Architect (contrato protegido) |`,
    '| G-W2 | A evidência de cada workflow é o artefato de saída mais os bloqueios e o texto de política; **não há esquema de evidência por etapa** | Chief Architect e Security & Governance |',
    '| G-W3 | **Não existe motor de execução dos workflows** (por desenho: tudo desligado até o gate R4). O catálogo descreve etapas e responsáveis; quem as executa é a Fábrica/adaptador, ainda não ligados | Integration, Backend e Editorial, depois do R4 |',
    `| G-I1 | **Independência com dois provedores:** o pedido diz "redação ≠ checagem ≠ revisão, em provedores diferentes", mas a DP-41 só tem Claude e Codex. A v7 exige que checagem e revisão difiram do **redator**, não entre si; por isso WF02, WF08 e WF03 usam Codex na checagem e na revisão (mesmo provedor: ${sameProvider.join(', ') || 'nenhum'}) contra o redator Claude. Os três papéis são perfis diferentes e a validação garante isso, mas três provedores distintos só existiriam com um terceiro (fora da DP-41) | PM |`,
    '| G-I2 | **WF08 (correção):** o texto corrigido é redigido por `editor_{editoria}` (Codex) e checado por `factcheck` (Codex). A v7 compara a checagem com o autor do conteúdo sob correção (o redator original, Claude, satisfeito), mas o texto da correção em si não tem checagem de outro provedor | PM e Editorial |',
    '',
    '## 5. Não verificado',
    '',
    '- Nenhum ritual ou workflow foi executado; nenhum modelo foi chamado; o catálogo é configuração.',
    '- A tabela compara o que está no código e nos contratos copiados; não confirmei se o Blueprint integral (além do resumo em `pacote-v2.1-completo`) traz mais detalhe.',
    '',
  ].join('\n');

  return {
    'catalog.json': `${JSON.stringify(catalog, null, 2)}\n`,
    'catalog-gaps.md': md,
  };
}
