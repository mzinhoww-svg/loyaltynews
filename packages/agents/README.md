# @ln/agents — organização agêntica (Frente 07)

Dono: LN AgentOps Engineer. Não cria agentes nem rotinas no OpenBot (ADR-004: perfis são contratos executados sob demanda, não processos residentes). Tudo nasce **desligado** (`enabled: false`; flag `rituais` desligada em `@ln/contracts`).

## O que há aqui
| Peça | Arquivo | Conteúdo |
|---|---|---|
| Configuração tipada | `data/*.json` + `src/config.ts` | 64 perfis, 19 workflows, 28 rituais (cópias byte a byte dos contratos v2.1; rituais = proposta **P5** com `recovery_policy`; sha256 em `data/SOURCES.json`). Validada por zod estrito (`src/schemas.ts`) **e** pelos schemas de `@ln/contracts` (`AgentProfile`, `Workflow`, `Ritual`) |
| Organização | `src/organization.ts` | 7 diretorias, 10 redações (editor + redator + diretor + memória setorial `memory_scope` + interações com diretorias, cruzadas com os passos dos workflows) |
| Validador | `src/validator.ts` | Contagens (64/7/10/19/28; 18 dailies, 6 semanais, 3 mensais, 1 evento) e referências cruzadas (hierarquia sem ciclo, dono/passos de workflow, presidente/participantes/quórum/dependências de ritual, rotas da `model.policy`, janela P5 = 120 min inclusive, tudo desligado). Falha fechado |
| Saída por perfil | `src/output.ts` | `validateAgentOutput(perfil, saída)` — R4-04: saída fora do `output_contract` é rejeitada |
| Calendário | `src/calendar.ts` | Dias úteis, feriados nacionais (versão `BR-nacional-v1`, 2025–2028, falha fechado fora), 1º dia útil do mês, fuso `America/Sao_Paulo` via Intl |
| Agendador | `src/scheduler.ts` | Diário/semanal/mensal/evento; janela de recuperação P5 (+120 min inclusive, mesmo dia útil, depois `status_only` sem modelo); semanal em feriado → próximo dia útil; D-sync espera os 5 dailies; quórum; regra do silêncio; idempotência `meeting_id + local_date (+ instance)`; atas, decisões, tarefas com responsável e prazo em dias úteis; `escalateOverdue` e `completeAction` (WF16: conclusão exige evidência). **Determinístico: não chama modelo** (`model_calls = 0`) |
| Memória setorial | `src/memory.ts` | Por editoria, versionada (append-only); só editor, redator e diretor editorial da editoria escrevem |
| Persistência | `sql/001_agentic_org.sql`, `src/db-schema.ts` (Drizzle), `src/store.ts` (`InMemoryStore`), `src/pg-store.ts` (`PgStore`), `src/pg-adapter.ts` | Tabelas `sector_memory`, `meeting_runs`, `meeting_minutes`, `meeting_decisions`, `action_items`, `meeting_inputs` |

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

## Para o Chief Architect (mudança fora desta pasta)
1. Incorporar `src/db-schema.ts` em `packages/db` (`export * from '@ln/agents/db-schema'` ou arquivo próprio em `src/schema/`) e gerar a migração. O DDL gerado a partir dele foi aplicado no PGlite nos testes; `sql/001_agentic_org.sql` é o equivalente manual.
2. `@ln/contracts` `Decision`/`Meeting` (camelCase, `prazo`, `alcada`, `idempotencyKey`) não são usados aqui: o modelo persistido desta frente é `meeting_runs`/`meeting_decisions`/`action_items` (snake_case). Se o contrato deve prevalecer, decidir o mapeamento (a lógica do agendador não muda).

## Decisões em aberto / limites (não verificado)
- **Meetings = P5, ainda proposta** (item 11 de `mudancas-protegidas-a-ratificar`, depende do aceite de R4-11 e de QA). `data/meetings.registry.json` é a P5; as 28 entradas são iguais às do contrato v2.1.
- **"Mensal substitui o semanal da mesma semana"** (ADR-014, "regra a confirmar"): **não implementado**; mensais e semanais rodam ambos.
- **Feriados**: só nacionais (inclui 20/11 e Sexta-feira Santa). Carnaval, Quarta de Cinzas e Corpus Christi (pontos facultativos) e feriados estaduais/municipais **não** entram; `createBrCalendar(extras)` aceita datas extras.
- Decisões que exigem aprovação humana (M-board ou `needs_human_approval`) ficam `pending_human` e **as ações propostas não são criadas** (ficam em `notes` da ata). Não há ainda fluxo de aprovação humana → criação das tarefas.
- Perfis `agenda` e `talks` não participam de nenhum ritual do registro (aviso `AGENT_NO_MEETING`, não erro).
- Horário de pico dos provedores e tamanho ideal do conjunto de agentes OpenBot: não medidos (ADR-004/014).
- `PgStore` foi testado em PGlite (PostgreSQL em WASM), **não** em PostgreSQL 18 real nem com `pg.Pool` real.
