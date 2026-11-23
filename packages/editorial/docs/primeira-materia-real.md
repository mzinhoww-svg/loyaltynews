# Roteiro da primeira matéria real (staging) — Fábrica editorial

Estado: **pronto para ensaio em staging, NÃO operacional.** Tudo abaixo roda hoje só com dados MOCK (testes). Nenhuma fonte está habilitada,
nenhuma flag está ligada, nenhum modelo foi chamado. Este roteiro diz o que precisa existir e em que ordem ligar. Quem decide cada ato está
em **negrito**; o agente de Editorial não liga flag, não habilita fonte e não publica.

## 0. O que já está provado (testes) e o que não está
| Provado | Onde |
|---|---|
| Habilitar fonte pelas rotas do Studio (revisão humana ≠ pesquisador + habilitação), estado no PostgreSQL | `apps/web/app/api/editorial/fabrica-ponta-a-ponta.test.ts` |
| Coleta (robots, anti-SSRF/DNS fixado, Crawl-delay, limite/hora) → redação → checagem em provedor distinto → aprovada | idem + `packages/editorial/src/tests/factory.test.ts` |
| Recibo (`POST /api/materias/:id/recibos`) e publicação (`POST /api/studio/editorial/articles/:id/publication`) com o MESMO hash; outbox, auditoria e Portal público | idem |
| Servidor com `publicacaoPortal` desligada: rota recusa (`FEATURE_DISABLED`), a rodada para, nada publicado | idem |
| Prompts versionados, gateway LLM por transporte, adaptador sobre `@ln/modelops` (simulado), ZDR bloqueando sem verificação | `factory.test.ts`, `apps/workers/src/editorial-factory.test.ts` |

**Não verificado / não existe ainda** (cada item abaixo é pré-requisito do passo 3):
1. Nenhuma chamada a modelo real foi feita; formato e qualidade das respostas dos modelos reais em JSON são **desconhecidos**. A primeira rodada real é também o primeiro teste dos prompts.
2. Termos de uso das fontes: só trechos extraídos por ferramenta (`docs/fontes-verificacao.md`); a revisão humana precisa ler os termos oficiais.
3. ZDR (retenção zero) por modelo: nenhum modelo verificado ⇒ o gateway **bloqueia** o trabalho editorial não publicado (`no_eligible_candidate`).
4. **Ledger de orçamento persistente** (teto de US$ 50/mês, ADR-015): só existe `MemoryLedgerStore`. Sem ele `modelosHabilitados` é recusada pelo comando da fábrica.
5. Política de modelos aprovada (a em uso é a PROPOSTA DP-02 v5) com `production_enabled`; chave do provedor; saldo.
6. Banco de staging migrado, workers e reconciliador no ar, Redis/BullMQ reais (testados só com PGlite/classes falsas).
7. Intelligence/social: seguem desligados (`intelligencePessoas`, mLabs); nada é publicado fora do Portal.

## 1. Pré-condições (marque antes de seguir)
| # | Condição | Dono | Como conferir |
|---|---|---|---|
| 1 | Banco de staging migrado (`npm run migrate -w @ln/db`), editorias cadastradas, `editorial_*` e `outbox` presentes | DevOps/Backend | `GET /api/ready`; `select count(*) from editorias` = 10 |
| 2 | Usuários com MFA: revisor, editor-chefe, admin (papel com `materias:publish`) | Backend/Responsável | login no Studio |
| 3 | Fonte escolhida e **termos lidos por humano** (não pelo agente de Editorial) | **Responsável + parecer jurídico (R0-10)** | nota na revisão da fonte |
| 4 | Política de modelos aprovada, ZDR verificado em ≥ 1 modelo de cada papel (redator, checador de outro provedor, revisor), chave e saldo, ledger persistente | **Proprietário** + FinOps/Backend | painel ModelOps do Studio; teste do gateway |
| 5 | Workers no ar (`apps/workers`), Redis, reconciliador | DevOps | logs `[workers] no ar` |
| 6 | Studio acessível; Portal em modo `api` lendo `/api/publico/*` | Frontend/Backend | abrir `/noticia/<slug>` de uma matéria de teste |

**Escolha da fonte (decisão do responsável).** A pesquisa deixou fontes com feed confirmado: BCB, CVM, LATAM IR, IATA, Senado, Câmara, Brasscom, Salesforce,
HubSpot, ABRAREC, Procon-SP (ver `docs/fontes-verificacao.md`). Atenção: gov.br usa CC BY-ND (sem derivações); IATA, ABECS, Accor e as RIs de companhias
aéreas restringem reprodução/raspagem. A fábrica reescreve a partir de fatos e cita a fonte, mas isso é **ponto jurídico** — não presumir autorização.
Comece por UMA fonte, com `maxArticles = 1`.

## 2. Ordem de ligar as flags (cada uma é decisão registrada do dono)
1. `editorialCollector` — só coleta/relata (dry-run). 2. `editorialPipeline` — redação e checagem (modelo SIMULADO primeiro).
3. `modelosHabilitados` — **só** com as condições 3–4 acima. 4. `publicacaoPortal` — registro de publicação pelo Studio.
5. `publicacaoAutonoma` — NÃO ligar na primeira matéria (é de disparo por agente/worker, só depois dos gates de R6).
As flags da fábrica vêm de `LN_FACTORY_FLAGS` (lista restrita em `parseFactoryFlags`); as do servidor (`publicacaoPortal`) são as de `@ln/contracts` no deploy.

## 3. Passo a passo
Build do comando: `npm run build:factory -w @ln/workers` → `apps/workers/dist/editorial-factory.js`.
Variáveis: `DATABASE_URL`, `LN_FACTORY_FLAGS`, opcional `LN_MODEL_POLICY` (caminho da política).

**P0 — Habilitar a fonte (Studio → Fontes).** Revisor ≠ `ln-editorial-engineer`: abre os termos oficiais, confere a URL e o `robots.txt`, confirma "sem login/paywall" e registra a nota
(`POST /api/studio/editorial/sources/<id>/review`). Depois o editor-chefe/admin habilita (`.../enabled`). Mudou host, prefixo, URL ou termos ⇒ a revisão vence e a fonte volta a desabilitada.

**P1 — Dry-run (seguro, é o padrão).**
`LN_FACTORY_FLAGS=editorialCollector node dist/editorial-factory.js` → JSON com fontes tentadas, itens coletados, duplicatas e motivos de descarte (`robots_disallow`, `gated`, `rate_limited`, `crawl_delay_excessive`, `no_feed`).
Confira: itens são da fonte certa; nenhum login/paywall; evidências com URL, data e hash. **Nada é gravado.**

**P2 — Rodada simulada.** `LN_FACTORY_FLAGS=editorialCollector,editorialPipeline node dist/editorial-factory.js --run --simulate --max 1`
O cliente SIMULADO responde "SIMULADO": a matéria deve ficar **`bloqueado` com `invalid_model_output`** (prova de que mock nunca vira matéria). Se virar `aprovado`, PARE e abra incidente.

**P3 — Rodada real (hoje BLOQUEADA pelo item 4 do "não verificado").** Só com as condições 3–4: `--max 1` e a flag `modelosHabilitados`. O comando recusa enquanto não houver ledger persistente.
Esperado: `aprovado`, rascunho com `slug` e `resumo`, checagem de fatos de **outro provedor** (`rec.factcheck.provider ≠ rec.draft.modelProvider`), estágios `triage>context>draft>factcheck>review`.
Se vier `bloqueado`: leia `findings` (citação/número fora da fonte, cópia literal, evidência suspeita, orçamento); **não** relaxe regra para passar.

**P4 — Revisão humana no Studio** (`/studio` → fila → matéria): confira o **gate recalculado** (`gate.passou`), independência do checador, claims aprovadas, fontes e links, assinatura **Redação Loyalty News**,
ausência de foto (sem base de direito, D08), título × texto × resumo. Registre a decisão (`confirm`) ou devolva (`send_back`). Humano **não força** aprovação.

**P5 — Recibo e publicação (rotas oficiais, pelo Studio).** Editor-chefe/admin com sessão MFA:
1. recibo `POST /api/materias/<id>/recibos` (cria a linha em `articles` com o conteúdo aprovado e o recibo com o hash do rascunho);
2. publicação `POST /api/studio/editorial/articles/<id>/publication` `{ receiptId, url: <SITE>/noticia/<slug> }` (flag `publicacaoPortal` no servidor).
Conferir: `publication.contentSha256` = `conteudoSha256` do recibo; item de outbox `article.published:<id>:<sha>`; auditoria `article.published`; `GET /api/publico/materias/<slug>` = 200 e a página `/noticia/<slug>` abre.
A fábrica também faz 1+2 por `publishApproved` (cliente HTTP com transporte injetado), mas **na primeira matéria faça pelo Studio, com uma pessoa**.

**P6 — Depois de publicar.** Auditoria pós-publicação (WF), checar `intelligence-ingest` na fila `entidades` (cargos só com `intelligencePessoas`; desligada ⇒ só organizações), **não** publicar social (mLabs) nesta etapa.

## 4. Critérios de aceite da primeira matéria
- [ ] fonte habilitada por revisão humana registrada (revisor ≠ pesquisador); evidência com URL, data e SHA-256
- [ ] nenhum trecho ≥ 8 palavras iguais à fonte; todo número/aspas está na fonte; nenhuma entrevista/apuração própria; assinatura institucional
- [ ] checagem de fatos em provedor distinto, todas as claims `pass`; revisão humana registrada
- [ ] recibo e publicação com o mesmo hash; outbox e auditoria presentes; Portal mostra a matéria com crédito e link da fonte
- [ ] custo da rodada registrado no ledger e dentro do teto; nenhum dado pessoal/segredo em prompt, log ou resposta pública (`generatedBy`, provedor, modelo ausentes da API pública)

## 5. Rollback e parada
| Situação | Ação | Quem |
|---|---|---|
| Matéria errada no ar | despublicar (Studio) e abrir caso de correção; `applyCorrection` republica como `corrigido` com aviso | editor-chefe |
| Fonte problemática | desabilitar (`.../enabled { enabled:false }`: revisor também pode) | revisor/chefe |
| Rodada fora de controle | desligar `editorialPipeline`/`editorialCollector`; kill switch global/rota do modelops | proprietário/DevOps |
| Orçamento | o gateway para sozinho (`budget_*`); a fábrica interrompe a rodada (`haltedBy`) | automático |

## 6. Diagnóstico rápido
| Sintoma | Causa provável | Ação |
|---|---|---|
| relatório sem fontes | nenhuma fonte revisada/habilitada (ou revisão vencida) | P0 |
| `robots_unavailable` / `gated` / `rate_limited` | robots 403/5xx; login/paywall; limite por hora | não contornar; ver `docs/fontes-verificacao.md` |
| `crawl_delay_excessive` | `Crawl-delay` > 120 s (ex.: LATAM 10 s é aceito) | configurar `maxCrawlDelaySec` só com decisão do dono |
| `invalid_model_output` | modelo não devolveu JSON no formato | ver prompt/versão; nunca relaxar o validador |
| `no_eligible_candidate` / `zdr_unverified` | sem ZDR verificado ou modelo não qualificado | condição 4 |
| `cross_provider_check_failed` | checador do mesmo provedor do redator | rota do modelops precisa de segundo provedor qualificado |
| `receipt_hash_mismatch` | projeção em `articles` diverge do rascunho | PARE; abrir incidente com Backend |
| `FEATURE_DISABLED` na publicação | `publicacaoPortal` desligada no servidor | decisão do dono |
| `slug_taken` / `slug_immutable` | slug já usado / matéria já publicada com outro slug | revisar manchete/slug antes da 1ª publicação |
