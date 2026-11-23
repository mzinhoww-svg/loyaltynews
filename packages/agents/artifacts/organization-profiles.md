# Organização completa: perfis dos 64 agentes (rascunho, política v7)

> GERADO por `packages/agents/src/org-profiles-doc.ts`; não editar. **Nada foi criado no OpenBot e nenhum modelo foi chamado.** Revisão: QA 3. Criar agentes só com OK do PM.

Política: `2.1-dp02-v7-dp27` (r0-preparacao/arquitetura/model.policy.proposto-DP02-v7.json; sha256 `52377930d5cd9d50846209316fa2824fdc9d392e4d1424f62799fd98f0bb8fb6`; proposta; contrato protegido sem a v7 até a cerimônia (commit raiz da v7 e baseline do trust.json)).

## 1. Resumo

- 64 perfis, todos `enabled=false`: 46 na conta Claude, 12 na conta Codex, 5 determinísticos (sem modelo), 1 sem canal (imagem), 8 com bloqueio de dado.
- Canal primário de todos: assinatura pelo adaptador OpenBot (ADR-003), fora do teto (DP-27). **Claude** para redação, entidades, social, rituais, dailies e análises; **Codex** só para checagem, revisão editorial e auditoria pós-publicação (OpenAI só na rota de revisão; autor distinto do redator).
- Backup: no limite da assinatura a tarefa volta a `pending` e espera a janela. O complemento pela API tarifada (rotas da v7: economy = claude-haiku-5-5, review = claude-sonnet-5-5 ou openai-text-review, premium e strategic = claude-opus-5-5) existe só dentro do teto de US$ 50, na ordem de corte da ADR-015 (degraus 35/40/42), e está **desligado** no piloto (DP-41). A redação não tem modelo alternativo (DP-26 b).
- Nunca: publicar sem checagem por provedor distinto do redator; DeepSeek; Fable em trabalho não publicado; checagem por amostragem.
- Este rascunho **não inclui** Gemini (Antigravity) nem OpenCode: eles são backups do PILOTO (decisão do PM, 23/11) e não constam da v7 nem da DP-41.
- A hipótese de 8 agentes OpenBot (um por diretoria mais o Publisher) vem de `openbot-profiles.draft.json`; cada execução carrega um perfil sob demanda (ADR-004).

## 2. Perfis por diretoria

### executivo (1 perfis; hospedados por `ln_executivo`)

| Perfil | Reporta a | Tarefa | Conta principal | Complemento pela API (desligado) | Presidência / workflows | Bloqueios |
|---|---|---|---|---|---|---|
| `publisher` | — | ritual | claude (anthropic) | strategic: claude-opus-5-5 | preside D-sync; preside W-cross; preside M-board; preside X-incident; dono WF12; dono WF15; dono WF16 | — |

### editorial (24 perfis; hospedados por `ln_editorial`)

| Perfil | Reporta a | Tarefa | Conta principal | Complemento pela API (desligado) | Presidência / workflows | Bloqueios |
|---|---|---|---|---|---|---|
| `director_editorial` | publisher | ritual | claude (anthropic) | premium: claude-opus-5-5 | preside D-editorial; preside W-pautas; dono WF02; dono WF03 | — |
| `editor_mercado` (mercado) | director_editorial | editorial_review | codex (openai) | review: openai-text-review, openai-text-review-alt | preside D-mercado | — |
| `writer_mercado` (mercado) | editor_mercado | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | — | — |
| `editor_programas` (programas) | director_editorial | editorial_review | codex (openai) | review: openai-text-review, openai-text-review-alt | preside D-programas | — |
| `writer_programas` (programas) | editor_programas | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | — | — |
| `editor_pontos` (pontos) | director_editorial | editorial_review | codex (openai) | review: openai-text-review, openai-text-review-alt | preside D-pontos | — |
| `writer_pontos` (pontos) | editor_pontos | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | — | — |
| `editor_bancos` (bancos) | director_editorial | editorial_review | codex (openai) | review: openai-text-review, openai-text-review-alt | preside D-bancos | — |
| `writer_bancos` (bancos) | editor_bancos | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | — | — |
| `editor_varejo` (varejo) | director_editorial | editorial_review | codex (openai) | review: openai-text-review, openai-text-review-alt | preside D-varejo | — |
| `writer_varejo` (varejo) | editor_varejo | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | — | — |
| `editor_travel` (travel) | director_editorial | editorial_review | codex (openai) | review: openai-text-review, openai-text-review-alt | preside D-travel | — |
| `writer_travel` (travel) | editor_travel | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | — | — |
| `editor_tech` (tech) | director_editorial | editorial_review | codex (openai) | review: openai-text-review, openai-text-review-alt | preside D-tech | — |
| `writer_tech` (tech) | editor_tech | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | — | — |
| `editor_crm` (crm) | director_editorial | editorial_review | codex (openai) | review: openai-text-review, openai-text-review-alt | preside D-crm | — |
| `writer_crm` (crm) | editor_crm | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | — | — |
| `editor_global` (global) | director_editorial | editorial_review | codex (openai) | review: openai-text-review, openai-text-review-alt | preside D-global | — |
| `writer_global` (global) | editor_global | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | — | — |
| `editor_regulacao` (regulacao) | director_editorial | editorial_review | codex (openai) | review: openai-text-review, openai-text-review-alt | preside D-regulacao | — |
| `writer_regulacao` (regulacao) | editor_regulacao | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | — | — |
| `newsdesk` | director_editorial | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | dono WF01 | — |
| `agenda` | director_editorial | editorial_draft | claude (anthropic) | economy: claude-haiku-5-5 (sem alternativo) | — | — |
| `talks` | director_editorial | editorial_draft | claude (anthropic) | review: claude-sonnet-5-5 (sem alternativo) | — | — |

### creative (6 perfis; hospedados por `ln_creative`)

| Perfil | Reporta a | Tarefa | Conta principal | Complemento pela API (desligado) | Presidência / workflows | Bloqueios |
|---|---|---|---|---|---|---|
| `director_creative` | publisher | ritual | claude (anthropic) | premium: claude-opus-5-5 | preside D-creative | — |
| `art` | director_creative | analysis | claude (anthropic) | review: claude-sonnet-5-5 | — | — |
| `designer` | art | deterministic | determinístico | — | — | — |
| `media` | art | analysis | claude (anthropic) | economy: claude-haiku-5-5 | — | — |
| `image` | art | concept_image | sem canal | — | — | a rota `image_fast` da v7 não tem modelo (lista vazia): o perfil fica desligado até a política habilitar imagem |
| `visualqa` | art | analysis | claude (anthropic) | economy: claude-haiku-5-5 | — | — |

### growth (9 perfis; hospedados por `ln_growth`)

| Perfil | Reporta a | Tarefa | Conta principal | Complemento pela API (desligado) | Presidência / workflows | Bloqueios |
|---|---|---|---|---|---|---|
| `director_growth` | publisher | ritual | claude (anthropic) | premium: claude-opus-5-5 | preside D-growth; preside W-performance; dono WF04; dono WF05; dono WF09 | — |
| `social` | director_growth | social_copy | claude (anthropic) | review: claude-sonnet-5-5 | — | — |
| `linkedin` | social | social_copy | claude (anthropic) | economy: claude-haiku-5-5 | — | — |
| `instagram` | social | social_copy | claude (anthropic) | economy: claude-haiku-5-5 | — | — |
| `seo` | director_growth | social_copy | claude (anthropic) | economy: claude-haiku-5-5 | — | — |
| `newsletter` | director_growth | social_copy | claude (anthropic) | review: claude-sonnet-5-5 | — | — |
| `publisher_social` | social | deterministic | determinístico | — | — | — |
| `growth_analytics` | director_growth | analysis | claude (anthropic) | review: claude-sonnet-5-5 | — | — |
| `community` | social | social_copy | claude (anthropic) | economy: claude-haiku-5-5 | — | — |

### intelligence (9 perfis; hospedados por `ln_intelligence`)

| Perfil | Reporta a | Tarefa | Conta principal | Complemento pela API (desligado) | Presidência / workflows | Bloqueios |
|---|---|---|---|---|---|---|
| `director_intelligence` | publisher | ritual | claude (anthropic) | premium: claude-opus-5-5 | preside D-intelligence; preside W-intel; dono WF06; dono WF07; dono WF14 | — |
| `discovery` | director_intelligence | entity_extraction | claude (anthropic) | economy: claude-haiku-5-5 | — | — |
| `people` | director_intelligence | entity_extraction | claude (anthropic) | economy: claude-haiku-5-5 | — | dado pessoal além de nome, cargo e empresa de fonte pública: bloqueado até operador aprovado (exceção P4/DP-11) |
| `company` | director_intelligence | entity_extraction | claude (anthropic) | economy: claude-haiku-5-5 | — | — |
| `orgchart` | director_intelligence | entity_extraction | claude (anthropic) | review: claude-sonnet-5-5 | — | só nome, cargo e empresa de fonte pública (exceção P4/DP-11); o resto é dado pessoal bloqueado |
| `moves` | director_intelligence | entity_extraction | claude (anthropic) | review: claude-sonnet-5-5 | — | só nome, cargo e empresa de fonte pública (exceção P4/DP-11); o resto é dado pessoal bloqueado |
| `graph` | director_intelligence | entity_extraction | claude (anthropic) | economy: claude-haiku-5-5 | — | — |
| `marketdata` | director_intelligence | analysis | claude (anthropic) | review: claude-sonnet-5-5 | — | — |
| `dataqa` | director_intelligence | analysis | claude (anthropic) | review: claude-sonnet-5-5 | — | — |

### commercial (5 perfis; hospedados por `ln_commercial`)

| Perfil | Reporta a | Tarefa | Conta principal | Complemento pela API (desligado) | Presidência / workflows | Bloqueios |
|---|---|---|---|---|---|---|
| `director_commercial` | publisher | ritual | claude (anthropic) | premium: claude-opus-5-5 | preside D-commercial; preside M-commercial; dono WF10 | — |
| `adops` | director_commercial | deterministic | determinístico | — | — | — |
| `sales` | director_commercial | analysis | claude (anthropic) | economy: claude-haiku-5-5 | — | insumo comercial confidencial: bloqueado até operador aprovado (v7, classes de dado) |
| `pricing` | director_commercial | analysis | claude (anthropic) | review: claude-sonnet-5-5 | — | insumo comercial confidencial: bloqueado até operador aprovado (v7, classes de dado) |
| `account` | director_commercial | analysis | claude (anthropic) | economy: claude-haiku-5-5 | — | insumo comercial confidencial: bloqueado até operador aprovado (v7, classes de dado) |

### technology (5 perfis; hospedados por `ln_technology`)

| Perfil | Reporta a | Tarefa | Conta principal | Complemento pela API (desligado) | Presidência / workflows | Bloqueios |
|---|---|---|---|---|---|---|
| `director_technology` | publisher | ritual | claude (anthropic) | premium: claude-opus-5-5 | preside D-technology; preside W-finops; preside M-model; dono WF11; dono WF13; dono WF17 | — |
| `sre` | director_technology | deterministic | determinístico | — | — | — |
| `finops` | director_technology | deterministic | determinístico | — | — | — |
| `platform` | director_technology | analysis | claude (anthropic) | premium: claude-opus-5-5 | — | — |
| `security` | director_technology | analysis | claude (anthropic) | review: claude-sonnet-5-5 | — | — |

### trust (5 perfis; hospedados por `ln_trust`)

| Perfil | Reporta a | Tarefa | Conta principal | Complemento pela API (desligado) | Presidência / workflows | Bloqueios |
|---|---|---|---|---|---|---|
| `director_trust` | publisher | ritual | claude (anthropic) | premium: claude-opus-5-5 | preside D-trust; preside W-trust; dono WF08; dono WF18; dono WF19 | — |
| `factcheck` | director_trust | fact_check | codex (openai) | review: openai-text-review, openai-text-review-alt | — | — |
| `rights` | director_trust | analysis | claude (anthropic) | economy: claude-haiku-5-5 | — | — |
| `privacy` | director_trust | analysis | claude (anthropic) | premium: claude-opus-5-5 | — | dado pessoal: bloqueado até base legal e operador aprovados (v7, classes de dado) |
| `audit` | director_trust | postpublication_audit | codex (openai) | review: openai-text-review, openai-text-review-alt | — | — |

## 3. Decisões em aberto

1. Piloto × DP-41: o kit do piloto prevê backups no Gemini (Antigravity) e na pauta no OpenCode (DeepSeek gratuito), por decisão do PM de 23/11; a DP-41 fala em "Claude e Codex" e a v7 lista DeepSeek em `never`. Decidir se esses backups valem no piloto e, se valerem, se entram na política (mudança protegida) antes da organização completa.
2. A rota `image_fast` da v7 não tem modelo: o perfil `image` fica sem canal até a política habilitar imagem.
3. Perfis com insumo pessoal ou comercial confidencial ficam bloqueados até o operador ser aprovado (v7, classes de dado).
4. Volume de uso da assinatura por perfil e por ritual NÃO foi medido: a organização completa só liga depois de o piloto medir janelas e limites de Claude e Codex (uma conta por provedor, sem separar produto e implementação).
5. Hipótese de 8 agentes OpenBot (um por diretoria mais Publisher) segue sem medição; ver `openbot-profiles.draft.json`.

## 4. Não verificado

- id exato do modelo de cada assinatura e capacidades (declarados pelo OpenBot no UsageReport)
- limites reais de Claude e Codex e a hora de retomada informada pelo OpenBot
- termos das assinaturas para uso automatizado (risco aceito na DP-30, não verificado)
- qualidade dos 64 perfis em PT-BR (nenhuma chamada de modelo foi feita)
