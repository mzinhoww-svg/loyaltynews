# Piloto de 10 matérias pelo OpenBot — perfis, roteiro, critérios e custo zero tarifado

> GERADO por `packages/agents/src/pilot-doc.ts`; não editar. Complementa `fast-track/custo/piloto-10-materias-openbot.md` (Arquiteto). **Nenhum agente foi criado e nenhum modelo foi chamado**: tudo aqui espera o OK explícito do PM. Os dados dos testes do avaliador são SIMULADOS. Os limites das assinaturas e do OpenCode grátis NÃO são conhecidos: medi-los é o objetivo do piloto.

## 1. Decisões que valem

- **DP-27:** canal principal = agentes OpenBot nas assinaturas (Claude redige, Codex confere), fora do teto; API tarifada só como complemento dentro de US$ 50 e **desligada no piloto**. O piloto vem **antes** da etapa 1 paga da qualificação; se o canal cobrir redação e checagem, a etapa 1 encolhe.
- **DP-26 (b) e (c):** sem reserva (nem fallback) na redação; Fable fora do trabalho não publicado. **DP-26 (a) revogada pela DP-27:** ZDR não é exigido. Dado pessoal continua fora.
- **DP-28:** fontes de mercado autorizadas com risco aceito; citar e linkar, sem reproduzir além do necessário; robots respeitado; nunca contornar 403/429; classe C fora (Azul, GOL, ABECS, IATA, Nubank, Accor, Marriott, Salesforce, HubSpot, Zendesk, oneworld, ABAV). **DP-29:** a IA lê e reescreve com palavras próprias (a Editorial aplica `copy_literal` de forma determinística).
- **DP-30:** o proprietário aceita o risco dos termos das assinaturas Anthropic e OpenAI. Mitigação recomendada: contas de produto separadas das de implementação; rota de complemento pela API pronta (desligada).

## 2. Fontes e volume (10 matérias, NÃO publicadas)

| Fonte | Classe de termos | Editoria | Matérias | Situação |
|---|---|---|---|---|
| senado-noticias | institucional | regulacao | 3 | Editorial revisa os termos e habilita pelos handlers da Fábrica (MFA) |
| camara-noticias | institucional | regulacao | 3 | Editorial revisa os termos e habilita pelos handlers da Fábrica (MFA) |
| abemf | D | programas | 2 | proposta: Editorial confirma |
| livelo-imprensa | D | pontos | 1 | proposta: Editorial confirma |
| febraban | D | bancos | 1 | proposta: Editorial confirma |

Total: 10 matérias (3 Senado, 3 Câmara e 4 de mercado classe D). As de mercado são proposta a confirmar pelo Editorial. As 10 ficam como rascunho aprovado ou bloqueado no staging e são descartadas depois.

## 3. Perfis dos agentes do piloto (rascunho; modelo principal e backups)

Os prompts são os da Editorial: versão `editorial-0.2` (tom `tom-0.1`, provisório), arquivo `packages/editorial/src/factory/prompts.ts` em `ft/editorial` @ `7b35efa` (blob `fd9a9f2f2a84`). Cada agente executa UMA classe de tarefa da fábrica; o formato de saída é o dela. O modelo real de cada agente é o **declarado no `UsageReport`** (o identificador exato depende da conta e não foi verificado).

| Agente | Etapa | Classe da fábrica | Tipo no adaptador | Modelo principal | Backups | Se o limite bater |
|---|---|---|---|---|---|---|
| ln_pilot_pauta | triage | `triage` | classification | opencode: DeepSeek (OpenCode, camada gratuita): declarado no UsageReport (id exato não verificado) | claude (OpenCode indisponível ou com limite; só nesta etapa) | se o backup também bater o limite: a pauta fica pending; sem API |
| ln_pilot_redator | draft | `draft` | editorial_draft | claude: Claude (assinatura): declarado no UsageReport (id exato não verificado) | nenhum | SEM backup: a política (DP-26 b) não admite fallback na redação, e o complemento OpenRouter está desligado; a tarefa fica pending e o limite é medido |
| ln_pilot_checador | factcheck | `factcheck` | fact_check | codex: Codex/OpenAI (assinatura): declarado no UsageReport (id exato não verificado) | nenhum | SEM backup no piloto: o único backup independente seria a API (GPT-6.1-terra pelo OpenRouter), desligada; a tarefa fica pending e a matéria não é publicada (falha fechada) |
| ln_pilot_revisor | review | `review` | **lacuna** | codex: Codex/OpenAI (assinatura): declarado no UsageReport (id exato não verificado) | nenhum | SEM backup no piloto: a tarefa fica pending (a revisão do gate WF02 não pode ser do mesmo autor do redator) |
| ln_pilot_social (opcional) | social_pack | `social_pack` | **lacuna** | claude: Claude (assinatura): declarado no UsageReport (id exato não verificado) | nenhum | adiar: etapa de baixa prioridade; fica pending e não conta contra os critérios de saída |

**Regras de backup (política):** só a **pauta** tem backup (OpenCode grátis → Claude, ambos fora da API). **Redação, checagem e revisão não têm backup** no piloto: a política não admite fallback na redação (DP-26 b) e o único backup independente da checagem seria a API (GPT-6.1-terra pelo OpenRouter), que fica desligada; nesses casos a tarefa fica `pending` e a matéria **não** é publicada (falha fechada). Todo backup precisa respeitar a independência: o checador e o revisor **nunca** são do mesmo autor do redator (Claude × OpenAI); a Editorial passa `excludeProviders: [anthropic]` na checagem.

**DeepSeek grátis via OpenCode:** só para a pauta (tarefa simples, saída de 200 tokens). Entrada só de item de fonte pública. A política de dados e os limites da camada gratuita NÃO foram verificados; a DP-27 aceita a retenção; dado pessoal nunca. Se a qualidade da pauta ficar abaixo da Claude, trocar a principal por Claude (decisão registrada).

## 4. Roteiro de execução

**Antes (go/no-go, tudo registrado):** ver seção 8. Sem OK do PM não se cria nenhum agente.

**Por matéria (ordem fixa):**
1. **Coleta determinística** pela Fábrica (robots, ritmo, anti-SSRF; fonte habilitada pelo Editorial). Sem modelo.
2. **Pauta** (`triage`, OpenCode grátis; backup Claude). Item irrelevante termina aqui.
3. **Redação** (`draft`, Claude). Saída = rascunho com claims ancoradas em evidências; fonte `secondary` só com âncora primária (a Fábrica bloqueia sem âncora, antes de gastar modelo).
4. **Gates determinísticos** da Fábrica (`copy_literal`, números e datas nas evidências, assinatura institucional, direitos).
5. **Checagem** (`factcheck`, Codex) com o rascunho exato da etapa 3 (`reviewed_draft_task_id`).
6. **Revisão** (`review`, Codex) com o mesmo rascunho. **Variante:** nas matérias 6 a 10 usar a chamada única `check_edit` (checagem + revisão) para medir a economia de quota de cerca de 24% que o Arquiteto estima; as matérias 1 a 5 usam as duas etapas separadas.
7. **Opcional depois de aprovada:** `social_pack` e `roles` (Claude), como rascunho; nada é publicado.

**Por tarefa:** (a) despachar só se `PilotSession.canDispatch()` (ou `canDispatchNext(linhas).allowed`); (b) ao chegar o callback, gravar UMA linha na planilha e passá-la a `PilotSession.append`; (c) se a conta devolver limite: gravar `pending_limit` com o texto e a hora, **não** usar a API, esperar a conta voltar e gravar `account_resumed_at`; (d) depois do `review` (ou `check_edit`), o Editorial lê o rascunho aprovado e preenche `unsupported_facts` pela rubrica.

**Ritmo:** em horário comercial, uma matéria por vez nas duas primeiras (circuito ponta a ponta); depois as demais em fila, com no máximo 2 tarefas por conta em voo. Se nenhuma conta bater o limite nas 10, registrar e repetir com 30 (`repeat_with_30`).

**Ao fim:** `evaluatePilot(linhas)`, arquivar o relatório com as linhas, mandar ao QA e ao PM. Parada imediata (seção 7) encerra a rodada.

## 5. Critérios que o piloto mede e como entram nos gates G1–G6

| Critério do piloto | Como se mede | Limiar | Gate que alimenta |
|---|---|---|---|
| PC-01 Janelas de limite | matérias e tarefas por janela, por conta (Claude, Codex, OpenCode), mensagem e hora do limite, hora da retomada | medir; sem limite nas 10 → repetir com 30 | decide volume e etapa 1; G5.6 (S3, espera de lease) |
| PC-02 Independência | 100% dos pares redator→checador e redator→revisor da MESMA revisão com autor declarado diferente; nenhum `same_author`; rascunho final sempre checado | 100% | G2.5 (evidência de identidade do modelo, parcial: sem `generation id`) e G5 (independência em ação) |
| PC-03 Qualidade | 0 fato material sem evidência nos rascunhos aprovados (rubrica da Editorial); sem avaliação de todos os aprovados = inconclusivo | 0 | G2.3 (parcial; o golden set completo não é exigido no piloto) |
| PC-04 Formato da saída | saída no formato da classe da fábrica (JSON + esquema) | ≥ 95% (proposta) | G2.2 (parcial) |
| PC-05 Latência e falhas | p50/p95 por etapa; tentativas repetidas; tarefas falhas; leases expirados | medir | G5.3 (pull com lease, callback assinado e idempotente, na prática) e G5.6 (S2) |
| PC-06 Custo zero tarifado | 0 chamadas à API tarifada; 0 linhas novas no ledger de orçamento; saldo do OpenRouter igual antes e depois | 0 | G4 (parcial: confirma que o canal por assinatura não gasta o teto; **não** substitui o G4.2) |
| PC-07 Segurança | nenhum segredo em log; ferramentas dentro do contrato; nada publicado; nenhuma chave de provedor na configuração dos agentes | 0 ocorrências | G5.4 (negativo por agente) e G5.5 |
| PC-08 Staging | rascunhos e execuções persistidos no banco de staging; reexecução idempotente | persistido e sem duplicar | G3.3 (parcial) |

**G1** (janela P5 dos rituais) e **G6** (digest e insumos dos rituais) **não** são medidos por este piloto: ele não executa rituais. O piloto também não qualifica modelos de produção (G2 completo) nem fecha G4.2.

## 6. Plano de custo zero tarifado

| Camada | Controle | Como se prova |
|---|---|---|
| Preventivo | o OpenRouter e qualquer chave de provedor **não existem** na configuração dos agentes do piloto; a flag `modelosHabilitados` e o complemento ficam desligados; o gateway recusa sem portão de saldo (`balance_guard_missing`) antes de qualquer reserva | varredura da configuração (0 ocorrências); teste negativo por agente |
| Preventivo | limite atingido = tarefa `pending`, sem fallback para API (o único backup é a pauta: OpenCode → Claude, ambos fora da API) | linhas `pending_limit` sem `tarifada_api_call` |
| Preventivo | o despachante só envia tarefa se `canDispatchNext` permitir; `tarifada_api_call` é parada imediata | `PilotSession` fecha a sessão na linha ofensiva |
| Detectivo | cada linha da planilha traz `tarifada_api_call`; o relatório mostra `tariffed.apiCalls` | `evaluatePilot().tariffed.apiCalls === 0` |
| Detectivo | o verificador lê o saldo do OpenRouter antes e depois do piloto e confere o ledger de orçamento (`budget_ledger`) sem linha nova | diferença de saldo = 0; 0 linhas novas |
| Corretivo | qualquer chamada tarifada encerra o piloto, aciona o kill switch e abre incidente no FinOps | registro da parada |

**Custo esperado: US$ 0,00 tarifado.** Só se paga em quota das assinaturas (limite desconhecido, medido aqui) e, se existir, na camada gratuita do OpenCode. Risco residual: bater limite antes de terminar (as tarefas ficam `pending`, o piloto simplesmente demora); suspensão de assinatura por termos (risco aceito, DP-30); mudança unilateral do plano gratuito do OpenCode.

## 7. Parada imediata (avaliada a cada linha)

Qualquer tentativa de publicar, qualquer chamada à API tarifada, qualquer segredo em log ou qualquer ferramenta fora do contrato fecha a sessão (`PilotSession`) e nenhuma tarefa nova é despachada. Linha inválida (incluindo `approved` com motivo bloqueante) invalida a amostra inteira (`overall: invalid`). Este kit **não despacha por conta própria**: o despachante do adaptador tem de consultar `canDispatchNext` antes de cada tarefa.

## 8. Pré-condições e pedidos às frentes (a combinar)

**Com a Integration (adaptador OpenBot):**
1. Rotas `pull`/`heartbeat`/`callback` ligadas, fila e ledger reais, flag `openbotDispatch` só no staging, kill switch testado.
2. **Lacuna `review`:** `DISPATCHABLE_KINDS` não tem o tipo da revisão editorial (nem `social_pack`); acrescentar `editorial_review` (e `social_copy`, se o opcional entrar) ou usar a chamada única `check_edit` (`fact_check`).
3. **Lacuna do `UsageReport`:** hoje exige `generationIds` e `costMicro` conhecido; uma execução por assinatura não tem geração do OpenRouter. Precisa de uma variante `lane: subscription` (conta, modelo declarado, `costMicro = 0`, sem `generationIds`) aceita sem o 422 `geracao_ausente`, e de uma via `opencode` equivalente.
4. **Como a Fábrica espera o resultado:** o `ModelGateway.invoke` da Editorial é síncrono; um gateway do OpenBot precisa despachar a tarefa e aguardar o callback (com tempo-limite e `pending` no limite). Definir de quem é essa peça.
5. `canDispatchNext` consultado antes de cada despacho; separação das contas de produto e de implementação (DP-30); onde o agente OpenCode roda, se roda.

**Com a Editorial (Fábrica e prompts `editorial-0.2`):**
1. Confirmar o commit dos prompts fixado acima e o tom provisório `tom-0.1` (sem guia aprovado); avisar se o arquivo mudar.
2. Habilitar Senado, Câmara e as de mercado classe D, com termos registrados, pelos handlers da Fábrica (MFA).
3. Expor um identificador estável da **revisão do rascunho** que cada checagem e revisão recebe (vira `reviewed_draft_task_id`); sem isso a independência não é provável.
4. Rubrica de leitura dos 10 rascunhos (`unsupported_facts`) e quem lê; esquema de cada classe para medir `output_valid`.
5. Os gates determinísticos (`copy_literal`, âncora primária) contam como a etapa `rights_seo_qa`.

**Gerais:** adaptador homologado, modo `qualification` homologado, política v7 com o risco da DP-30, três a cinco agentes criados pelo AgentOps **só com OK do PM**, complemento OpenRouter desligado.

## 9. Planilha de medição

`task_id`, `kind`, `article_id`, `source_id`, `stage`, `account`, `declared_model`, `prompt_version`, `started_at`, `ended_at`, `attempt`, `reviewed_draft_task_id`, `outcome`, `limit_message`, `limit_at`, `account_resumed_at`, `gate_verdict`, `gate_reasons`, `cross_provider_ok`, `packet_chars`, `output_valid`, `tokens_measured`, `unsupported_facts`, `published_attempt`, `tarifada_api_call`, `secret_in_log`, `tool_outside_contract`, `notes`.

`tokens_measured` é sempre `false`: o OpenBot não expõe tokens; registrar `packet_chars` como substituto e anotar "não medido". `declared_model` vem do `UsageReport`. `reviewed_draft_task_id` é obrigatório em `factcheck`, `review` e `check_edit`. `output_valid` registra se a saída veio no formato da classe da fábrica.

## 10. Não verificado

- Limites e janelas de uso do Claude, do Codex e do OpenCode grátis; se o OpenBot devolve a hora de retomada e o texto do limite; o id exato do modelo de cada conta.
- Se o OpenBot roda um agente OpenCode (DeepSeek grátis), separa contas de produto e implementação e envia os cabeçalhos assinados do adaptador.
- Termos das assinaturas: risco aceito (DP-30), não verificado em documento dos provedores. Política de dados do OpenCode grátis.
- As fontes de mercado de classe D são proposta até a Editorial confirmar; Senado e Câmara estão desabilitadas hoje.
- Nada foi executado: nenhum agente criado, nenhuma chamada de modelo.

## Etapas do avaliador

- `triage`: Pauta/triagem (DeepSeek grátis via OpenCode; backup Claude) (conta opencode; backup claude)
- `draft`: Redação (Claude); sem fallback (DP-26 b) (conta claude)
- `factcheck`: Checagem de fatos independente (Codex; autor distinto do redator) (conta codex)
- `review`: Revisão editorial independente (Codex; gate WF02) (conta codex)
- `check_edit`: Checagem + revisão numa chamada só (opção do Arquiteto, −24%) (conta codex)
- `social_pack`: Texto social de LinkedIn como rascunho (Claude) (conta claude)
- `roles`: Entidades e cargos citados no texto (Claude) (conta claude)
- `rights_seo_qa`: Gates determinísticos: direitos, cópia literal, SEO, QA visual (conta deterministic)
