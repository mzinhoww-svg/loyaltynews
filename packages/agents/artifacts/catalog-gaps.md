# Catálogo dos 28 rituais e 19 workflows: tabela de lacunas (Frente 07)

> GERADO por `packages/agents/src/catalog-doc.ts`; não editar. **Nada roda nem chama modelo:** é só o catálogo, desligado (`enabled=false`). Revisão: QA 3.

Fonte oficial: Blueprint v2.1 §2 e §3, `contracts/meetings.registry.json` e `contracts/workflows.registry.json` (protegidos; cópias byte a byte em `packages/agents/data`) e os itens R4-11 e R4-12 do backlog. O Blueprint é resumido: o que ele não detalha aparece abaixo como lacuna, não como dado inventado.

## 1. O que já existe em `packages/agents` e o que este lote acrescenta

| Item | Já existia | Acrescentado agora |
|---|---|---|
| Contagens 28 rituais (18 diários, 6 semanais, 3 mensais, 1 evento) e 19 workflows | `validator.ts` (`COUNT`) e `validator.test.ts` | catálogo tipado com `RitualSpecSchema` e `WorkflowSpecSchema` (zod estrito) e teste de contagem sobre o catálogo |
| Ids únicos, participantes, presidente, dono, passos, dependências, quórum, rota | `validator.ts` | as mesmas verificações sobre o catálogo normalizado (todo participante é um dos 64 perfis) |
| Cadência (horário, fuso, feriados, janela de recuperação P5 v2, idempotência) | `scheduler.ts`, `calendar.ts`, `validator.ts` | cadência exposta no catálogo (`cadence`) |
| Ata persistida (resumo, bloqueios, evidências, saídas), decisões e tarefas idempotentes | `store.ts` (`MeetingOutcomeRecord`), `pg-store.ts`, migrações 0004/0005 | declarada em cada ritual (`output.minutes`) |
| Etapas, responsável, gate e evidência de cada workflow | só a string `steps`, `owner`, `output`, `blockers` e `policy` do registro | etapas em ordem com agentes expandidos por editoria, gates `auto_gate_*`, evidência (artefato, bloqueios fail-closed, política) |
| Independência editorial (redação ≠ checagem ≠ revisão, provedores diferentes) | regra textual da política e o gate do piloto | dado + validação por editoria em WF02, WF03, WF05 e WF08 contra os provedores dos 64 perfis na v7 |

## 2. Rituais (28): cadência, participantes, entrada, saída e ata

| Ritual | Cadência | Participantes | Entrada | Saída | Ata persistida | Lacunas |
|---|---|---|---|---|---|---|
| `D-mercado` | weekday 06:00 | 2 (preside `editor_mercado`; quórum 2) | async_structured_first; um insumo estruturado por participante | pauta priorizada, tarefas, bloqueios | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-programas` | weekday 06:00 | 2 (preside `editor_programas`; quórum 2) | async_structured_first; um insumo estruturado por participante | pauta priorizada, tarefas, bloqueios | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-pontos` | weekday 06:00 | 2 (preside `editor_pontos`; quórum 2) | async_structured_first; um insumo estruturado por participante | pauta priorizada, tarefas, bloqueios | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-bancos` | weekday 06:00 | 2 (preside `editor_bancos`; quórum 2) | async_structured_first; um insumo estruturado por participante | pauta priorizada, tarefas, bloqueios | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-varejo` | weekday 06:00 | 2 (preside `editor_varejo`; quórum 2) | async_structured_first; um insumo estruturado por participante | pauta priorizada, tarefas, bloqueios | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-travel` | weekday 06:00 | 2 (preside `editor_travel`; quórum 2) | async_structured_first; um insumo estruturado por participante | pauta priorizada, tarefas, bloqueios | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-tech` | weekday 06:00 | 2 (preside `editor_tech`; quórum 2) | async_structured_first; um insumo estruturado por participante | pauta priorizada, tarefas, bloqueios | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-crm` | weekday 06:00 | 2 (preside `editor_crm`; quórum 2) | async_structured_first; um insumo estruturado por participante | pauta priorizada, tarefas, bloqueios | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-global` | weekday 06:00 | 2 (preside `editor_global`; quórum 2) | async_structured_first; um insumo estruturado por participante | pauta priorizada, tarefas, bloqueios | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-regulacao` | weekday 06:00 | 2 (preside `editor_regulacao`; quórum 2) | async_structured_first; um insumo estruturado por participante | pauta priorizada, tarefas, bloqueios | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-editorial` | weekday 06:20 | 12 (preside `director_editorial`; quórum 8) | async_structured_first; insumos por digest determinístico (ADR-014) | daily brief, decisões, tarefas | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-creative` | weekday 06:40 | 6 (preside `director_creative`; quórum 4) | async_structured_first; um insumo estruturado por participante | status, tarefas, escalonamentos | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-growth` | weekday 06:45 | 9 (preside `director_growth`; quórum 6) | async_structured_first; um insumo estruturado por participante | status, tarefas, escalonamentos | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-intelligence` | weekday 06:10 | 9 (preside `director_intelligence`; quórum 6) | async_structured_first; um insumo estruturado por participante | status, tarefas, escalonamentos | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-commercial` | weekday 08:30 | 5 (preside `director_commercial`; quórum 4) | async_structured_first; um insumo estruturado por participante | status, tarefas, escalonamentos | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-technology` | weekday 08:15 | 5 (preside `director_technology`; quórum 4) | async_structured_first; um insumo estruturado por participante | status, tarefas, escalonamentos | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-trust` | weekday 07:15 | 5 (preside `director_trust`; quórum 4) | async_structured_first; um insumo estruturado por participante | status, tarefas, escalonamentos | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `D-sync` | weekday 07:25 | 6 (preside `publisher`; quórum 4) | async_structured_first; insumos por digest determinístico (ADR-014); depende de D-trust, D-intelligence, D-editorial, D-creative, D-growth | prioridade aprovada, dependências, impedimentos | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `W-pautas` | weekly MON 08:00 | 15 (preside `director_editorial`; quórum 10) | async_structured_first; insumos por digest determinístico (ADR-014); workflow WF12 | calendário, pautas, hipóteses | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `W-cross` | weekly MON 09:00 | 8 (preside `publisher`; quórum 6) | async_structured_first; insumos por digest determinístico (ADR-014); workflow WF15 | OKRs, decisões, alocação proposta | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `W-performance` | weekly FRI 15:00 | 7 (preside `director_growth`; quórum 5) | async_structured_first; insumos por digest determinístico (ADR-014) | experimentos, aprendizados, tarefas | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `W-finops` | weekly FRI 14:00 | 5 (preside `director_technology`; quórum 4) | async_structured_first; insumos por digest determinístico (ADR-014) | recomendações de routing, riscos, orçamento proposto | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `W-trust` | weekly THU 14:00 | 7 (preside `director_trust`; quórum 5) | async_structured_first; insumos por digest determinístico (ADR-014) | achados, ações corretivas | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `W-intel` | weekly WED 14:00 | 8 (preside `director_intelligence`; quórum 6) | async_structured_first; insumos por digest determinístico (ADR-014) | plano de enriquecimento, casos inconclusivos | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `M-board` | monthly FIRST_BUSINESS_DAY 10:00 | 8 (preside `publisher`; quórum 6) | async_structured_first; insumos por digest determinístico (ADR-014) | ata, decisões sujeitas a aprovação humana, plano mensal | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `M-model` | monthly FIRST_BUSINESS_DAY 14:00 | 8 (preside `director_technology`; quórum 6) | async_structured_first; insumos por digest determinístico (ADR-014) | evals, proposta de promoção ou rollback | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `M-commercial` | monthly FIRST_BUSINESS_DAY 15:00 | 6 (preside `director_commercial`; quórum 4) | async_structured_first; insumos por digest determinístico (ADR-014) | forecast, propostas, ações | ✓ `MeetingOutcomeRecord` | G-R1, G-R2 |
| `X-incident` | event incident / breaking / dependency | 4 (preside `publisher`; quórum 3) | async_structured_first; um insumo estruturado por participante | contenção, decisão, responsáveis | ✓ `MeetingOutcomeRecord` | G-R1, G-R2, G-R3 |

## 3. Workflows (19): etapas, responsável, gate, evidência e independência

| Workflow | Etapas | Responsável | Gate | Evidência | Independência | Lacunas |
|---|---|---|---|---|---|---|
| `WF01` | writer_{editoria} → editor_{editoria} | `newsdesk` | — (sem gate explícito) | triaged; bloqueios: duplicate, rights_unknown | não editorial | G-W2, G-W3, G-W1 |
| `WF02` | writer_{editoria} → factcheck + rights → editor_{editoria} → auto_gate_editor | `director_editorial` | auto_gate_editor | article.approved; bloqueios: unsupported_claim, rights_unknown, approval_missing, rights_basis_unresolved, copy_literal, cross_provider_check_failed | ✓ writer_{editoria} ≠ factcheck ≠ editor_{editoria} | G-W2, G-W3 |
| `WF03` | validate_revision → transactional_publish → outbox → postpublication_audit → unpublish_if_failed | `director_editorial` | — (sem gate explícito) | article.published; bloqueios: stale_approval, embargo | ✓ writer_{editoria} ≠ audit | G-W2, G-W3, G-W1 |
| `WF04` | discovery + media → art → designer + linkedin + instagram_if_enabled → visualqa → auto_gate_social → publisher_social | `director_growth` | auto_gate_social | social.receipt; bloqueios: no_image, mention_unverified, no_receipt | não editorial | G-W2, G-W3 |
| `WF05` | newsletter → factcheck → auto_gate_editor → esp_send | `director_growth` | auto_gate_editor | newsletter.sent; bloqueios: consent_missing, stale_revision | ✓ newsletter ≠ factcheck | G-W2, G-W3 |
| `WF06` | discovery → people + company → graph → dataqa → auto_gate_data | `director_intelligence` | auto_gate_data | entity.revision; bloqueios: ambiguous_identity, conflicting_evidence | não editorial | G-W2, G-W3 |
| `WF07` | orgchart + moves → dataqa → auto_gate_data | `director_intelligence` | auto_gate_data | org.snapshot; bloqueios: unverified_reporting, sensitive_change | não editorial | G-W2, G-W3 |
| `WF08` | editor_{editoria} → factcheck → auto_gate_editor → republish → social_reconcile → entity_rebuild | `director_trust` | auto_gate_editor | correction.closed; bloqueios: missing_evidence, remote_unresolved | ✓ writer_{editoria} ≠ factcheck ≠ editor_{editoria} | G-W2, G-W3 |
| `WF09` | collect_providers → validate_periods → aggregate → publish_snapshot | `director_growth` | — (sem gate explícito) | metrics.snapshot; bloqueios: stale_data, provider_unavailable | não editorial | G-W2, G-W3, G-W1 |
| `WF10` | sales → pricing → auto_gate_sales → adops → account | `director_commercial` | auto_gate_sales | campaign.report; bloqueios: inventory_conflict, approval_missing | não editorial | G-W2, G-W3 |
| `WF11` | finops → reconcile → budget_alert → auto_gate_admin | `director_technology` | auto_gate_admin | budget.snapshot; bloqueios: unknown_rate, budget_exhausted | não editorial | G-W2, G-W3 |
| `WF12` | director_editorial + director_creative + director_growth + director_intelligence + director_commercial + director_technology + director_trust → publisher → auto_gate_owner | `publisher` | auto_gate_owner | plan.approved; bloqueios: policy_conflict, budget_exceeded | não editorial | G-W2, G-W3 |
| `WF13` | sre → security → auto_gate_ops → recover → audit | `director_technology` | auto_gate_ops | incident.closed; bloqueios: unsafe_replay, missing_approval | não editorial | G-W2, G-W3 |
| `WF14` | match_active_subscriptions → dedupe → consent_check → notify | `director_intelligence` | — (sem gate explícito) | alert.receipt; bloqueios: unverified_event, optout | não editorial | G-W2, G-W3, G-W1 |
| `WF15` | snapshot → structured_inputs → chair_synthesis → challenge_if_needed → validate_decisions → auto_gate_gate_if_needed → transactional_actions | `publisher` | auto_gate_gate_if_needed | meeting.closed; bloqueios: missing_inputs, invalid_authority, budget_exhausted | não editorial | G-W2, G-W3 |
| `WF16` | validate_authority → assign → track_due_date → verify_evidence → escalate_overdue | `publisher` | — (sem gate explícito) | action.updated; bloqueios: missing_owner, overdue, unverified_completion | não editorial | G-W2, G-W3, G-W1 |
| `WF17` | refresh_catalog → offline_eval → cost_review → security_review → auto_gate_approval → canary → monitor_or_rollback | `director_technology` | auto_gate_approval | model.policy_version; bloqueios: unknown_model, unknown_price, regression, approval_missing | não editorial | G-W2, G-W3 |
| `WF18` | intake → preserve_evidence → triage → auto_gate_response → errata → social_reconcile → notify_owner_if_legal | `director_trust` | auto_gate_response | response.receipt; bloqueios: unverified_request | não editorial | G-W2, G-W3 |
| `WF19` | intake → verify_identity → restrict_processing → auto_gate_privacy → rectify_or_remove → audit | `director_trust` | auto_gate_privacy | privacy.receipt; bloqueios: identity_unverified, legal_conflict | não editorial | G-W2, G-W3 |

## 4. Lacunas (o que o documento oficial não detalha ou o código ainda não faz)

| Id | Lacuna | Quem decide ou faz |
|---|---|---|
| G-R1 | O registro de rituais traz `mode` e `purpose`, mas **não define o formato da entrada** de cada ritual (o que exatamente cada participante entrega). O catálogo deriva "um insumo estruturado por participante" (ou digest, ADR-014) | Chief Architect (contrato protegido) e Editorial/Diretorias (conteúdo) |
| G-R2 | As saídas (`outputs`) são rótulos de texto, **sem esquema por ritual**; a ata guarda `outputs: string[]`. Falta o schema de cada artefato (pauta priorizada, daily brief, plano mensal etc.) | Chief Architect e o dono de cada ritual |
| G-R3 | `X-incident` é por evento: não tem horário, só gatilho (incidente, breaking, dependência); o formato do gatilho não está no registro | Chief Architect e SRE |
| G-W1 | Workflows **sem gate automático explícito** nas etapas: WF01, WF03, WF09, WF14, WF16. Hoje só os bloqueios fail-closed os protegem | Chief Architect (contrato protegido) |
| G-W2 | A evidência de cada workflow é o artefato de saída mais os bloqueios e o texto de política; **não há esquema de evidência por etapa** | Chief Architect e Security & Governance |
| G-W3 | **Não existe motor de execução dos workflows** (por desenho: tudo desligado até o gate R4). O catálogo descreve etapas e responsáveis; quem as executa é a Fábrica/adaptador, ainda não ligados | Integration, Backend e Editorial, depois do R4 |
| G-I1 | **Independência com dois provedores:** o pedido diz "redação ≠ checagem ≠ revisão, em provedores diferentes", mas a DP-41 só tem Claude e Codex. A v7 exige que checagem e revisão difiram do **redator**, não entre si; por isso WF02, WF08 e WF03 usam Codex na checagem e na revisão (mesmo provedor: WF02, WF08) contra o redator Claude. Os três papéis são perfis diferentes e a validação garante isso, mas três provedores distintos só existiriam com um terceiro (fora da DP-41) | PM |
| G-I2 | **WF08 (correção):** o texto corrigido é redigido por `editor_{editoria}` (Codex) e checado por `factcheck` (Codex). A v7 compara a checagem com o autor do conteúdo sob correção (o redator original, Claude, satisfeito), mas o texto da correção em si não tem checagem de outro provedor | PM e Editorial |

## 5. Não verificado

- Nenhum ritual ou workflow foi executado; nenhum modelo foi chamado; o catálogo é configuração.
- A tabela compara o que está no código e nos contratos copiados; não confirmei se o Blueprint integral (além do resumo em `pacote-v2.1-completo`) traz mais detalhe.
