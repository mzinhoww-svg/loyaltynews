# Piloto de 10 matérias: checklist de prontidão (revisão, integração, fontes; DP-41)

Estado em 24/11/2026. Dono: AgentOps (Frente 07). Revisor: QA 3. **Nada foi ativado, criado nem chamado**: nenhum agente no OpenBot, nenhuma flag ligada, nenhum modelo chamado.

Legenda: **✓** feito e conferido por mim (SHA existe e o ancestral confere com `git merge-base --is-ancestor`; parecer lido em `r0-preparacao/qa/`); **◐** relato de outro dono que eu li mas não reproduzi; **○** aberto. "main" = `origin/main` `ce05999` (PR #23); eu li os pareceres, não repeti os testes das outras frentes.

## 1. Revisão (QA independente)

| # | Item | Estado | SHA da evidência | Parecer |
|---|---|---|---|---|
| R1 | Kit do piloto (5 perfis, prompts `editorial-0.3`, planilhas, folha de leitura, critério PC-03) | ✓ homologado, na main | `ft/agents` `5bd03ef`…`4967d2c` (na main) | QA 3, `ft-organizacao-agentica.md` |
| R2 | Avaliador por gravidade (0 altas, até 1 média) e `applyRowPatch` | ✓ homologado, na main | `f32358f`, `041a74f` | QA 3, idem |
| R3 | Prompts `editorial-0.3` e tom lint da Editorial | ✓ homologado, na main | `ft/editorial` `b040e53` (blob `a7e58bdc24fd`) | QA 3, `ft-fabrica-editorial.md` |
| R4 | Termos e habilitação documental das fontes (Senado, Câmara, classe D; DP-28) | ✓ documental homologado; **a habilitação em si é ○ (ato humano)** | `676e059` | QA 3, `ft-fabrica-editorial.md` |
| R5 | Rotas do Backend e adaptador (`cb9e0dd`, merge da `ft/growth`) | ✓ aprovado no escopo offline | `ft/backend` `cb9e0dd` (na main) | QA 2, `ft-backend-cb9e0dd-qa2.md` |
| R6 | Exportação da planilha em CSV no Studio (leitor 1) | ✓ homologado; **ainda não está na main** | `ft/studio-2` `35fa9c4` | QA 5, `ft-studio-2-35fa9c4-qa5.md` |
| R7 | Fiação do piloto na Fábrica e checklist da Integration (`d0d0de1`, `752b714`) | ✓ **na main** (conferido: ancestrais de `origin/main`); parecer próprio de QA: não conferi | `ft/growth` `d0d0de1`, `752b714` | — |
| R8 | Conjunto final antes do disparo (ensaio no staging real) | ○ | — | a cargo do PM |

## 2. Integração

| # | Item | Estado | SHA / onde | Observação |
|---|---|---|---|---|
| I1 | `ft/agents ≥ f32358f` integrada na `ft/backend` (o piloto falhava fechado sem o `canDispatchNext` no índice) | ✓ | `f32358f` e `4967d2c` na main | conferido: ancestral de `origin/main` |
| I2 | `PgTaskIo` guarda `meta.articleId` | ◐ feito pelo Backend | `ft/backend` `cb9e0dd` | relato da Integration; QA 2 aprovou o merge |
| I3 | Rota de retomada depois de uma parada (`POST /api/studio/openbot/pilot/resume`, só admin, auditada) | ◐ feito | `cb9e0dd` | idem |
| I4 | Flag `openbotDispatch` no contrato: `staging = 'DP-41'`, `production = null` | ✓ | `ft/backend-2` `467ba9e` (na main) | em produção a subida é recusada, segundo o ensaio da Integration |
| I5 | `OpenBotModelGateway` ligado à Fábrica e `pilotSink` (veredito) | ◐ **fiação presente na main** (`apps/workers/src/openbot-wiring.ts`, `editorial-factory.main.ts`, `pilot-sink.ts`); **falta provar no staging real** | `ft/editorial` `8262175` e `ft/growth` `d0d0de1` (ambos na main) | a Editorial grava o veredito, confere com `applyRowPatch` (`f32358f`) e, se falhar, só registra `pilot_row_patch_failed` (melhor esforço); falha fechada sem staging, sem `LN_OPENBOT_PILOT=1` ou sem a flag |
| I6 | Colunas da planilha: AgentOps = `PilotRow` = Integration = Studio 2 | ✓ **conferido agora** | teste `pilot-columns.test.ts` neste commit; fixture `fixtures/pilot-csv-consumers.json` | ao vivo: `LN_PILOT_COLUMNS_LIVE=1` (9 testes: 7 offline e 2 contra `origin/main` e `ft/studio-2`, todos verdes) |
| I7 | Contrato de variáveis da Vertra (`OPENBOT_HMAC_SECRET`, `LN_FLAGS_ON`, `LN_OPENBOT_PILOT`) só no staging | ○ | — | DevOps |
| I8 | Segredo HMAC no cofre (atual e anterior) | ○ não criado | — | proprietário/DevOps; nunca no chat |
| I9 | Staging na Fase 3 (banco e migrações) | ◐ o PM informa staging rodando a `int/012` (`82decac`, migrações até a 0027) | `82decac` (fora da main) | não reverifiquei o ambiente |
| I10 | Ensaio ponta a ponta sem modelo (código real, agentes de mentira) | ◐ passa em PGlite | `apps/web/app/api/openbot/staging-dryrun.test.ts` (`ft/growth`) | **não** prova o OpenBot real, o PostgreSQL do staging nem os limites das contas |
| I11 | Kill switch e ensaio no staging real | ○ | — | Integration + DevOps, depois de I5, I7, I8 |
| I12 | Tela de leitura do editor-chefe e do QA 3 (rascunho, evidências, leituras) | ◐ telas do Studio 2 existem (ver R6) | `ft/studio-2` | fora da main |
| I13 | OpenBot real chamando o endpoint com cabeçalhos assinados | ○ **não verificado** | — | risco de plataforma; só se prova com o agente criado |

## 3. Fontes (DP-28, DP-41)

| # | Item | Estado | Observação |
|---|---|---|---|
| F1 | Termos de cada fonte revisados e documentados | ✓ | `676e059`, QA 3 |
| F2 | Fontes do piloto: Senado, Câmara, ABEMF, Livelo, Abrarec (a Febraban saiu); Senado e Câmara bastam para as 10 | ✓ definido | `pilot.ts` `PILOT_SOURCES`; classe C fora |
| F3 | **Habilitar** as fontes em `/studio/fontes/fabrica` (admin ou editor-chefe com MFA; revisor ≠ pesquisador) | ○ | só o proprietário é humano hoje; o PM pede quando a tela estiver pronta e o staging na Fase 3 |
| F4 | Leitura dos rascunhos: proprietário (leitor 1) e QA 3 (leitor 2 nas matérias 1, 4, 6 e 9) | ○ depende de F3 e de R7/I5 | critério aprovado: 0 altas e no máximo 1 média nas 10 |

## 4. Conformidade com a DP-41 (só assinaturas Claude e Codex, sem API tarifada, sem publicação)

| Exigência | Onde está garantida | Prova |
|---|---|---|
| Só Claude e Codex | `PilotAccount = claude \| codex \| deterministic`; linha com outra conta é inválida; pauta só em modelo Haiku ou Sonnet | `pilot.test.ts` e `pilot-columns.test.ts`; QA 3 |
| Redação sem alternativo; checagem e revisão só no Codex, sem backup | `PILOT_STAGES`, perfis do piloto | QA 3 |
| Checagem independente do redator | `authorOfDeclaredModel`, conta × modelo declarado | QA 3 (F1) |
| Sem API tarifada | `tarifada_api_call` é parada imediata; `must_not` em todos os perfis | `pilot.test.ts` |
| Sem publicação | `published_attempt` é parada imediata; a Fábrica não publica no piloto | `pilot.test.ts`, ensaio da Integration ◐ |
| Adaptador recusa conta fora de Claude e Codex | `DP41_ACCOUNTS` (422 e piloto parado) | relato da Integration ◐ (`pilot.test.ts`, 12 testes do bloco DP-41) |
| Agentes do OpenBot **não criados** | PM-2026-11-23-F (sinal do PM); `pilot-agents.draft.json` com `created:false` | — |

## 5. O que bloqueia ligar o piloto (resumo)

1. **Provar no staging real a fiação da Fábrica ao gateway e ao `pilotSink`** (I5): o código já está na main; falta ensaio com o staging, os agentes e o segredo (um patch que falha só deixa rastro de auditoria e uma linha sem veredito).
2. **Staging real:** contrato de variáveis (I7), segredo HMAC (I8), ensaio e kill switch no staging (I11).
3. **Agentes do OpenBot** (sinal do PM) e a prova de que o OpenBot real chama o endpoint assinado (I13).
4. **Fontes habilitadas** pelo proprietário (F3) e a tela de leitura disponível (I12).
5. Merge na main de `ft/studio-2` (R6, `35fa9c4`); a `ft/growth` (R7) já está na main.

## 6. Não verificado por mim

- Tudo marcado ◐: li o parecer ou o documento, não reproduzi.
- O ambiente do staging (migrações até a 0027, `int/012`), os limites das contas Claude e Codex, o modelo exato de cada assinatura e a hora de retomada informada pelo OpenBot.
- Se a `ft/growth` `d0d0de1` e `752b714` receberam parecer de QA.
