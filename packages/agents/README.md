# @ln/agents — organização agêntica (Frente 07)

Dono: LN AgentOps Engineer. Não cria agentes nem rotinas no OpenBot (ADR-004: perfis são contratos executados sob demanda, não processos residentes). Tudo nasce **desligado** (`enabled: false`; flag `rituais` desligada em `@ln/contracts`).

## O que há aqui
| Peça | Arquivo | Conteúdo |
|---|---|---|
| Configuração tipada | `data/*.json` + `src/config.ts` | 64 perfis, 19 workflows, 28 rituais (cópias byte a byte dos contratos v2.1; rituais = proposta **P5 v2** (aprovada pelo QA) com `recovery_policy`; sha256 em `data/SOURCES.json`). Validada por zod estrito (`src/schemas.ts`) **e** pelos schemas de `@ln/contracts` (`AgentProfile`, `Workflow`, `Ritual`) |
| Organização | `src/organization.ts` | 7 diretorias, 10 redações (editor + redator + diretor + memória setorial `memory_scope` + interações com diretorias, cruzadas com os passos dos workflows) |
| Validador | `src/validator.ts` | Contagens (64/7/10/19/28; 18 dailies, 6 semanais, 3 mensais, 1 evento) e referências cruzadas (hierarquia sem ciclo, dono/passos de workflow, presidente/participantes/quórum/dependências de ritual, rotas da `model.policy`, janela P5 = 120 min inclusive, tudo desligado). Falha fechado |
| Saída por perfil | `src/output.ts` | `validateAgentOutput(perfil, saída)` — R4-04: saída fora do `output_contract` é rejeitada |
| Calendário | `src/calendar.ts` | Dias úteis, feriados nacionais (versão `BR-nacional-v1`, 2025–2028, falha fechado fora), 1º dia útil do mês, fuso `America/Sao_Paulo` via Intl |
| Agendador | `src/scheduler.ts` | Diário/semanal/mensal/evento; janela de recuperação P5 (+120 min inclusive, mesmo dia útil, depois `status_only` sem modelo); semanal em feriado → próximo dia útil; D-sync espera os 5 dailies; quórum; regra do silêncio; idempotência P5 v2 = `meeting_id + data ORIGINAL da ocorrência` (+ `#instance` em eventos): ocorrência movida por feriado mantém a chave original e registra `rescheduled_date`; colisão (duas ocorrências na mesma data efetiva) roda uma vez com todas as chaves em `idempotency_keys`; reagendamento e colisão ficam na ata (`notes`), no log do `tick` e nas colunas de `meeting_runs`; atas, decisões, tarefas com responsável e prazo em dias úteis; `escalateOverdue` e `completeAction` (WF16: conclusão exige evidência). **Determinístico: não chama modelo** (`model_calls = 0`) |
| Memória setorial | `src/memory.ts` | Por editoria, versionada (append-only); só editor, redator e diretor editorial da editoria escrevem |
| Persistência | tabelas em `@ln/db/schema` (`packages/db/src/schema/agents.ts`, migrações 0004 e 0005); `src/store.ts` (`InMemoryStore`), `src/pg-store.ts` (`PgStore`), `src/pg-adapter.ts` | `sector_memory`, `meeting_runs`, `meeting_minutes`, `meeting_decisions`, `action_items`, `meeting_inputs` |

## Uso
```ts
import { loadRegistries, buildOrganization, validateOrganization, RitualScheduler, StoreInputCollector, createBrCalendar, PgStore, pgDbFromPool } from '@ln/agents';

const org = buildOrganization(loadRegistries());
const report = validateOrganization(org);          // { ok, counts, issues }

const store = new PgStore(pgDbFromPool(pool));      // pool = pg.Pool
const scheduler = new RitualScheduler({
  registries: org.registries, calendar: createBrCalendar(), store,
  collector: new StoreInputCollector(store),        // insumos estruturados já gravados (async_structured_first)
  flags: { rituais: true },                         // padrão: desligado -> tick() não faz nada
});
await scheduler.tick(new Date());                   // idempotente; chamar a cada minuto pelo worker
```
O `InputCollector` é o ponto de ligação com o adaptador OpenBot (R4): ele produz os `ParticipantInput` (um por participante) e informa `model_calls`. Aqui só existe o coletor que lê o banco.

## Mapeamento e alçadas (decisões do Chief Architect, rodada 2)
- O modelo do banco prevalece; `@ln/contracts` espelha as tabelas (`MeetingRun`, `MeetingDecision`, `ActionItem`, `SectorMemoryEntry`).
- **Alçada da decisão (D01):** `automatic` → `approved`; `protected` (governança) → `pending_verifier`, vai ao verificador, sem aprovação humana de rotina; `owner_reserved` (ato legal/contratual reservado ao responsável) → `pending_human`. Só as aprovadas geram tarefas; as demais ficam na ata.
- **Rodada 3 (P5 v2), mudança em arquivos do arquiteto — a conferir no merge:** `packages/db/src/schema/agents.ts` + migração `0005_agents_reschedule` (colunas `rescheduled_date`, `reschedule_reason`, `idempotency_keys` em `meeting_runs`; CHECK de coerência; status `pending_verifier` em `meeting_decisions`) e `packages/contracts/src/org.ts` (campos equivalentes em `MeetingRun`/`MeetingDecision`). `local_date` passa a ser a data ORIGINAL; a unique `(meeting_id, local_date, instance)` não mudou.

## Decisões em aberto / limites (não verificado)
- **Meetings = P5 v2, ainda proposta** (item 11 de `mudancas-protegidas-a-ratificar`; ratificação em lote separado, depois de R4-11). `data/meetings.registry.json` é a P5 v2 (`a18e0a71…`); as 28 entradas são iguais às do contrato v2.1.
- **"Mensal substitui o semanal da mesma semana"** (ADR-014, "regra a confirmar"): **não implementado**; mensais e semanais rodam ambos.
- **Feriados**: só nacionais (inclui 20/11 e Sexta-feira Santa). Carnaval, Quarta de Cinzas e Corpus Christi (pontos facultativos) e feriados estaduais/municipais **não** entram; `createBrCalendar(extras)` aceita datas extras.
- Decisões `protected`/`owner_reserved` **não criam tarefas** (as ações propostas ficam em `notes` da ata). Ainda não há fluxo que, após o verificador ou o responsável aprovarem, materialize as tarefas.
- O texto de saída do M-board no registro ("decisões sujeitas a aprovação humana") **não** é tratado como aprovação humana de rotina (D01): vale a alçada declarada em cada decisão.
- Colisão só foi exercitada com calendário sintético (feriados extras); no calendário real de 2026–2027 nenhuma colisão ocorre. "Janela" como causa de colisão não existe separada: ocorrência movida que perde a janela vira `status_only` com a mesma chave e o mesmo registro de reagendamento.
- Perfis `agenda` e `talks` não participam de nenhum ritual do registro (aviso `AGENT_NO_MEETING`, não erro).
- Horário de pico dos provedores e tamanho ideal do conjunto de agentes OpenBot: não medidos (ADR-004/014).
- `PgStore` foi testado em PGlite (PostgreSQL em WASM) sobre as migrações oficiais, **não** em PostgreSQL 18 real nem com `pg.Pool` real (o adaptador de `pg.Pool` é testado só com cliente simulado).
