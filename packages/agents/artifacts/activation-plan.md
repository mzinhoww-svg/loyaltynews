# Plano de ativação — organização agêntica (Frente 07)

> GERADO por `packages/agents/src/artifacts.ts`; não editar. Estado: **nada ativado**. Nenhum agente criado no OpenBot, nenhuma rotina real, nenhuma chamada de modelo.

## 1. O que existe hoje (entregue e testado)
- 64 perfis, 7 diretorias, 10 redações, 19 workflows e 28 rituais (18 diários, 6 semanais, 3 mensais, 1 por evento) como configuração tipada e validada (`organization.manifest.json`).
- Agendador determinístico com janela de recuperação P5 v2, feriados nacionais, idempotência pela data original, atas, decisões e tarefas persistidas em PostgreSQL (migrações 0004/0005 de `@ln/db`).
- Tudo `enabled=false`; flags `rituais` e `modelosHabilitados` desligadas em `@ln/contracts`.

## 2. Condições para ligar (gates; nenhuma é decidida por este pacote)
| # | Condição | Quem decide | Situação |
|---|---|---|---|
| G1 | Ratificar P5 v2 (item 11 das mudanças protegidas) em lote separado, depois do aceite de R4-11 | Proprietário + verificador | proposta aprovada pelo QA; **não ratificada** |
| G2 | Qualificar modelos (R2-07/08): ID exato, preço, ZDR, avaliação PT-BR | Verificador / FinOps | nenhum modelo qualificado |
| G3 | Banco de staging com as migrações 0004 e 0005 | DevOps | não existe |
| G4 | Ledger de orçamento e saldo do provedor persistidos em PostgreSQL (modelops) | Backend + FinOps | pendente no pacote modelops |
| G5 | Adaptador OpenBot (disparo, webhooks, custos) e mapeamento perfil → agente | Integration + PM | **não criado**; exige aval do PM |
| G6 | Worker determinístico de insumos (05:30, ADR-014) e coletor de insumos estruturados | Backend/Editorial | não existe |
| G7 | Ligar flags em ambiente: `rituais` (primeiro só em staging), depois `modelosHabilitados` | Proprietário | desligadas |

## 3. Fases (cada uma reversível desligando a flag; só avança com evidência da anterior)
| Fase | O que liga | Modelo? | Critério para avançar | Reversão |
|---|---|---|---|---|
| F0 | Configuração + validador + testes (**feito**) | não | `npm test`, validador e artefatos conferem | — |
| F1 | Staging, `rituais` ON, coletor do banco, sem insumos | não | Todos os rituais do dia viram `status_only` sem insumo; reinício não duplica; feriado e janela corretos (testes R4-11 com calendário 2026–2027) | flag `rituais` OFF |
| F2 | 10 dailies de redação com insumos de digest determinístico (G6) | não | Atas e tarefas persistidas; `model_calls = 0` | flag OFF |
| F3 | Modelos nos 10 dailies de redação e nos dailies de diretoria (rota economy) | sim (G2, G4, G7) | Custo real ≤ projeção do teto; saída fora do esquema rejeitada (R4-04) | `modelosHabilitados` OFF |
| F4 | Consolidação: D-editorial, D-trust, D-sync (essenciais) | sim | D-sync espera os 5 dailies; sem estouro de janela | desligar o ritual |
| F5 | Semanais e mensais; premium/strategic só com motivo e sublimite | sim | Escalonamento ≤ sublimite; decisões protegidas vão ao verificador | desligar o ritual |
| F6 | X-incident (evento) | sim | Teste de incidente simulado | desligar o ritual |

## 4. Roteamento de modelos e teto de US$ 50 (política v5, sha256 `2641a8fe3d19…`; mês 2026-12)
Premissas de tokens **não medidas** (medir em R4): insumo de participante 1500+6000 (cache) tokens de entrada e até 700 de saída; síntese do presidente 2000+6000 de entrada (+400 por insumo) e até 1500 de saída; 2 incidentes/mês.

| Cenário | Esperado | Teto (reserva) | Escalonamento Opus/Fable (teto) | Folga Anthropic | Verificações |
|---|---|---|---|---|---|
| Conservador (todo insumo por modelo) | US$ 6.66 | US$ 12.39 | US$ 0.44 de US$ 5.00 | US$ 9.61 de US$ 22.00 | dentro das regras (com aviso de heurística) |
| Digest na consolidação | US$ 2.33 | US$ 6.51 | US$ 0.44 de US$ 5.00 | US$ 15.49 de US$ 22.00 | dentro das regras |

- Rotas: dailies economy (Haiku 5.5), consolidação e semanais review (Sonnet 5.5), premium (Opus 5.5: W-cross, M-model, X-incident) e strategic (Fable 5.2: M-board) **só na síntese do presidente**; participantes de rituais premium/strategic usam review. OpenAI fica só na rota de revisão (fact-check, auditoria): rituais não a usam. Imagens e DeepSeek: verba zero.
- Maiores consumidores (teto): D-editorial US$ 3.19; D-sync US$ 1.69; W-pautas US$ 0.72; D-intelligence US$ 0.64.
- A projeção cobre **só os rituais**. A verba restante (Anthropic e os US$ 20.00 da OpenAI, mais a reserva de auditoria) é do trabalho editorial, que tem de caber depois: o volume de matérias não é um dado do Blueprint e não foi assumido aqui.
- O teto é de reserva (faixa de preço mais cara, saída máxima); a cobrança real é conciliada pelo gateway. Degraus 35/40/42/50 e rituais essenciais até 42 seguem ADR-015.

## 5. Mapeamento para o OpenBot (PROPOSTA; nada foi criado)
Pelo ADR-004 os perfis são contratos executados sob demanda, não processos residentes. Hipótese inicial a medir em R4: um agente OpenBot por diretoria (7) mais o Publisher (1), cada um carregando o perfil, o glossário e a memória setorial pedidos pelo disparo. **Requer aval do Program Manager** antes de qualquer criação; o tamanho ideal do conjunto ainda não foi medido.

## 6. Riscos e pendências conhecidas
- Rituais dependem do PC ligado de madrugada (DP-03); a janela de recuperação é de 120 min inclusive, depois vira registro de status.
- "Mensal substitui o semanal da mesma semana" não está decidido nem implementado.
- Decisões protegidas (`pending_verifier`) e atos reservados (`pending_human`) não geram tarefas; falta o fluxo que as materializa depois da aprovação.
- Colisão de ocorrências só foi exercitada com calendário sintético; `PgStore` só foi testado em PGlite.
- Feriados: só nacionais; estaduais/municipais e pontos facultativos ficam de fora.
