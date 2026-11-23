/** Artefatos do piloto de 10 matérias (DP-27/DP-28/DP-30). Não exportado por `index.ts`. */
import type { LoadedRegistries } from './config';
import { buildPilotAgents, buildPilotPrompts, CLASS_C_EXCLUDED, PILOT_SHEET_COLUMNS, PILOT_SOURCES, PILOT_STAGES, sheetCsvHeader } from './pilot';

export interface PilotArtifacts {
  'pilot-prompts-v1.md': string;
  'pilot-agents.draft.json': string;
  'pilot-measurement-sheet.csv': string;
  'pilot-protocol.md': string;
}

export function buildPilotArtifacts(registries: Pick<LoadedRegistries, 'agents'>): PilotArtifacts {
  const prompts = buildPilotPrompts(registries);
  const agents = buildPilotAgents(prompts);

  const promptsMd = [
    '# Prompts versionados do piloto de 10 matérias (v1)',
    '',
    '> GERADO por `packages/agents/src/pilot.ts`; não editar. Mudar o texto muda o `promptVersion` (sha256). Os campos de saída vêm do registro de perfis (contratos de saída), não de memória. Nada foi enviado a nenhum modelo.',
    '',
    ...prompts.flatMap((p) => [
      `## ${p.id} — conta ${p.account} — \`${p.promptVersion}\``,
      `Perfis cujo contrato vale: ${p.profiles.join(', ')}.`,
      '',
      '```text',
      p.text,
      '```',
      '',
    ]),
  ].join('\n');

  const agentsJson = {
    schema: 'ln.agents.pilot-agents-draft/1',
    status: 'RASCUNHO',
    created: false,
    approval_required_from: 'Program Manager',
    nota: 'Nenhum agente foi criado no OpenBot. Criar só depois do adaptador ligado, do modo qualification homologado e da política v7, com aval explícito do PM. Sem a API tarifada: o complemento OpenRouter fica desligado no piloto.',
    risco_aceito: 'DP-30: o proprietário aceita o risco dos termos das assinaturas Anthropic e OpenAI para uso automatizado. Mitigação recomendada: separar, quando possível, o uso de produto do uso de implementação (contas/assinaturas distintas), para que uma suspensão não pare a equipe de implementação; manter pronta a rota de complemento pela API.',
    agentes: agents,
  };

  const sourcesRows = PILOT_SOURCES.map((s) => `| ${s.id} | ${s.termsClass} | ${s.editoria} | ${s.articles} | ${s.status === 'to_confirm_by_editorial' ? 'proposta: Editorial confirma' : 'Editorial revisa os termos e habilita pelos handlers da Fábrica (MFA)'} |`);
  const protocol = [
    '# Protocolo de execução do piloto de 10 matérias pelo canal OpenBot',
    '',
    '> GERADO por `packages/agents/src/pilot-doc.ts`; não editar. Complementa `fast-track/custo/piloto-10-materias-openbot.md` (Arquiteto): aqui estão os agentes, os prompts versionados e a planilha. **Nada roda** antes das pré-condições abaixo. Sem custo de API. Os dados dos testes do avaliador são SIMULADOS.',
    '',
    '## 1. Decisões que valem',
    '',
    '- **DP-27:** canal principal = agentes OpenBot nas assinaturas (Claude, Codex; fora do teto); API tarifada só como complemento dentro de US$ 50. O piloto vem **antes** da etapa 1 paga da qualificação; se o canal cobrir redação e checagem, a etapa 1 encolhe.',
    '- **DP-28:** fontes de mercado autorizadas com risco aceito pelo proprietário; citar e linkar a fonte, sem reproduzir além do necessário; robots respeitado; nunca contornar 403/429; **classe C fora** (' + CLASS_C_EXCLUDED.join(', ') + ') salvo revisão caso a caso registrada; Intelligence segue "fato + fonte + link + data, nunca o trecho".',
    '- **DP-30:** o proprietário **aceita o risco dos termos das assinaturas** Anthropic e OpenAI para uso automatizado do produto. Registrar na política v7 e no livro. Mitigação recomendada: separar o uso de produto do uso de implementação e manter a rota de complemento pela API pronta.',
    '- **DP-26 (a) revogado pela DP-27:** ZDR não é exigido. Dado pessoal continua fora.',
    '',
    '## 2. Fontes e volume (10 matérias, NÃO publicadas)',
    '',
    '| Fonte | Classe de termos | Editoria | Matérias | Situação |',
    '|---|---|---|---|---|',
    ...sourcesRows,
    '',
    `Total: ${PILOT_SOURCES.reduce((n, s) => n + s.articles, 0)} matérias (3 Senado, 3 Câmara e 4 de mercado, classe D). As de mercado são a **proposta** do Arquiteto a confirmar pelo Editorial (ABEMF, Livelo imprensa, Febraban). As 10 ficam como rascunho aprovado ou bloqueado no staging e são descartadas depois.`,
    '',
    '## 3. Etapas, contas e prompts',
    '',
    '| Etapa | Conta | Agente (rascunho) | Prompt versionado |',
    '|---|---|---|---|',
    ...(Object.keys(PILOT_STAGES) as (keyof typeof PILOT_STAGES)[]).map((st) => {
      const a = agents.find((x) => x.stage === st);
      return `| ${PILOT_STAGES[st].label} | ${PILOT_STAGES[st].account} | ${a ? a.draft_id : 'sem agente: código determinístico da Fábrica'} | ${a ? `\`${a.prompt_version}\`` : '—'} |`;
    }),
    '',
    'O checador é de **autor diferente** do redator (Claude × Codex): o prompt manda declarar o modelo e bloquear com `same_author` se coincidir; a independência é conferida pelo `model` do `UsageReport`, não pela palavra do agente.',
    '',
    '## 4. Pré-condições (todas registradas antes de rodar)',
    '',
    '1. Adaptador da ADR-003 (`POST /api/openbot/pull|heartbeat|callback`), fila e ledger reais, homologados.',
    '2. Flag `openbotDispatch` ligada **só no staging**, por decisão registrada; kill switch testado.',
    '3. Modo `qualification` homologado (ADR-021), mesmo sem uso da API neste piloto.',
    '4. Política v7 no contrato, com o risco da DP-30 registrado.',
    '5. As três fontes de mercado e as duas institucionais habilitadas pelo Editorial, com os termos revisados e registrados.',
    '6. Os três agentes criados pelo AgentOps **com aval explícito do PM**, com os prompts versionados acima.',
    '7. Complemento OpenRouter **desligado** (limite atingido = tarefa `pending`, sem fallback), para medir o limite de verdade.',
    '8. Contas: se possível, as assinaturas do piloto separadas das de implementação (DP-30), para que um limite ou uma suspensão não pare a equipe.',
    '',
    '## 5. Como executar e registrar',
    '',
    '1. Despachar as 10 matérias em ordem, uma de cada vez por etapa, em horário comercial (a janela de limite se mede em horas, não em minutos).',
    '2. Para cada tarefa, gravar UMA linha na planilha (`pilot-measurement-sheet.csv`; ver colunas na seção 6) logo que o callback chega, **passando-a a `PilotSession.append(linha)`** (`src/pilot.ts`): ela avalia a parada imediata e a validade A CADA LINHA. **Só despache a próxima tarefa se `session.canDispatch()` for verdadeiro** (ou `canDispatchNext(linhas).allowed`); depois de uma parada ou de uma linha inválida a sessão recusa novas linhas. Nunca grave de memória.',
    '3. Quando uma conta devolver limite: gravar `pending_limit`, o texto e a hora (`limit_message`, `limit_at`), **não** usar a API, esperar a conta voltar e gravar `account_resumed_at`.',
    '4. Depois de cada `check_edit`, o Editorial lê o rascunho aprovado e preenche `unsupported_facts` (fatos materiais sem evidência, pela rubrica).',
    '5. Ao fim, rodar `evaluatePilot(linhas)` e arquivar o relatório com as linhas. **Uma linha inválida invalida a amostra inteira** (`overall: invalid`): corrigir a linha e refazer a avaliação; nunca pontuar uma amostra inválida.',
    '',
    '## 6. Planilha de medição (colunas)',
    '',
    PILOT_SHEET_COLUMNS.map((c) => `\`${c}\``).join(', ') + '.',
    '',
    '`tokens_measured` é sempre `false`: o OpenBot não expõe tokens; registrar `packet_chars` (tamanho do pacote) como substituto e anotar "não medido". `declared_model` vem do `UsageReport`. `cross_provider_ok` registra a conferência de autor distinto.',
    '',
    '## 7. Critérios de saída e parada imediata',
    '',
    '- **Janelas:** matérias e tarefas por janela de limite, por conta, com o intervalo e a hora de retomada. Se **nenhuma** conta bater o limite nas 10 matérias, registrar isso e **repetir com 30** (`repeat_with_30`).',
    '- **Independência:** valida-se cada PAR redator→checador da mesma revisão: cada `check_edit` informa em `reviewed_draft_task_id` o rascunho que recebeu (sem vínculo, vínculo ambíguo, de outra matéria ou anterior ao fim do rascunho = falha); o rascunho FINAL de cada matéria precisa ter checagem vinculada; 100% dos pares com modelo declarado de autor diferente, e `gate_reasons` com `same_author` (ou qualquer motivo bloqueante com veredito `approved`) reprova.',
    '- **Qualidade:** 0 fato material sem evidência nos rascunhos aprovados (rubrica do Editorial; o golden set completo não é exigido). Sem a avaliação de todos os aprovados, o critério fica **inconclusivo**.',
    '- **Latência e falhas:** p50/p95 por etapa, tentativas repetidas, tarefas falhas e leases expirados.',
    '- **PARADA IMEDIATA, linha a linha:** qualquer tentativa de publicar, qualquer chamada à API tarifada, qualquer segredo em log ou qualquer ferramenta fora do contrato. Avaliada a cada linha por `PilotSession`/`canDispatchNext`: a linha que dispara a parada fecha a sessão e nenhuma tarefa nova é despachada. Este kit não despacha por conta própria: o despachante (adaptador) tem de consultar `canDispatchNext` antes de cada tarefa.',
    '',
    '## 8. Quem faz',
    '',
    '- **AgentOps:** agentes (rascunho aqui), prompts versionados, planilha e avaliador; **cria os agentes só com o aval do PM**.',
    '- **Editorial:** termos e habilitação das fontes, rubrica e leitura dos 10 rascunhos.',
    '- **Backend:** rotas do adaptador, fila e ledger. **Arquiteto:** política v7 e revisão do resultado. **QA:** confere que nada foi publicado e que nenhuma chamada saiu para a API tarifada. **FinOps:** registra o risco aceito (DP-30) no livro.',
    '',
    '## 9. Não verificado',
    '',
    '- Limites e janelas de uso das assinaturas (é o que o piloto mede), se o OpenBot devolve a hora de retomada e o formato da mensagem de limite.',
    '- Se o OpenBot permite um agente por conta e separar as contas de produto e de implementação; se envia os cabeçalhos assinados do adaptador.',
    '- Termos das assinaturas: risco **aceito** pelo proprietário (DP-30), não verificado em documento dos provedores.',
    '- As fontes de mercado de classe D são proposta até o Editorial confirmar; Senado e Câmara estão `termsStatus: pending` e desabilitadas hoje.',
    '',
  ].join('\n');

  return {
    'pilot-prompts-v1.md': promptsMd,
    'pilot-agents.draft.json': `${JSON.stringify(agentsJson, null, 2)}\n`,
    'pilot-measurement-sheet.csv': sheetCsvHeader(),
    'pilot-protocol.md': protocol,
  };
}
