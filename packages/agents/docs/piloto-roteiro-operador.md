# Piloto de 10 matérias: roteiro do operador (DP-41, só staging, tudo à mão)

Para quem opera o piloto (admin: hoje, o proprietário). Cada passo traz o comando ou a tela e o **resultado esperado**. **Regra de ouro: se o resultado não for o esperado, pare (passo 9), anote o que viu e chame o PM; não repita em laço.**

Escopo (DP-41): só **staging**; só as assinaturas **Claude e Codex**; **sem API tarifada**; **sem publicação** (tudo vira rascunho para leitura); agentes do OpenBot só depois do **sinal do PM** (PM-2026-11-23-F). O piloto mede janelas de limite, tempo, retrabalho e qualidade; custo tarifado esperado: **US$ 0**.

Legenda: **[verificado]** conferido no código ou em parecer; **[relato]** descrito por outro dono, não reproduzido; **[não verificado]** só se prova no staging real.

## 0. Antes de começar (todas verdadeiras; senão, não comece)

| # | Condição | Como conferir |
|---|---|---|
| 0.1 | Sinal do PM para criar e ligar o piloto | mensagem do PM registrada |
| 0.2 | Staging com a int/013 (ou superior) e o Studio do Studio 2 (telas `/studio/piloto*`; `ft/studio-2` `35fa9c4`, ainda fora da main) | `GET /api/health`: build e `flags: []` |
| 0.3 | Fontes habilitadas pelo proprietário em `/studio/fontes/fabrica` (Senado, Câmara, ABEMF, Livelo, ABRAREC) | lista mostra as 5 habilitadas; checklist em `packages/editorial/docs/piloto-checklist-habilitacao.md` |
| 0.4 | Segredo HMAC no cofre do staging e no cofre do OpenBot (mesmo valor) | **nunca** no chat, em prompt ou em arquivo versionado |
| 0.5 | Os 5 agentes do OpenBot criados pelo roteiro da Integration (`packages/openbot/docs/ROTEIRO-AGENTES-STAGING.md`), cada um com **uma via**: Pauta (claude, Haiku; backup Sonnet), Redação (claude), Checagem (codex), Revisão (codex), Social (claude; opcional) | `openbot.read_agent` de cada um; acesso restrito |
| 0.6 | Login de admin no Studio com MFA | você entra em `/studio` |
| 0.7 | Cliente do agente (`ln-openbot-agent.mjs`, da Integration) **integrado** e copiado na máquina do OpenBot, Node ≥ 20; sem ele, o `smoke` não existe e vale o roteiro manual do passo 1a | `node --version`; o arquivo existe na branch a integrar |

Nada disto existe ainda no staging real. **[não verificado]**: os agentes ainda não foram criados e o OpenBot real ainda não chamou o endpoint assinado.

## 1. Conferir que está tudo DESLIGADO

São **duas verificações separadas**: o *smoke* (saúde e assinatura, **sem `pull`**) e o *pull manual* (que prova a recusa `423 DISPATCH_OFF`). Faça as duas.

**Dependência:** o comando `ln-openbot-agent.mjs smoke` pertence ao cliente da Integration e **só vale depois de esse cliente estar integrado** (hoje ele existe fora das branches a integrar; a Integration o está levando para uma branch). Enquanto isso, use as alternativas manuais abaixo (`GET /api/health` e o heartbeat manual).

### 1a. Smoke: saúde e assinatura (sem pull)

- **Com o cliente integrado:** `node <caminho>\ln-openbot-agent.mjs smoke --expect-dispatch off` (com `LN_API_BASE`, `LN_AGENT_ACCOUNT`, `LN_HMAC_SECRET_FILE`). Ele faz **só** `GET /api/health` e um heartbeat de tarefa que não existe; **não faz `pull`**, então não tira lease de ninguém. **[relato]**
- **Sem o cliente (alternativa manual):**
  1. `GET /api/health` (sem assinatura). **Esperado:** resposta 200 com `flags: []`.
  2. **Heartbeat manual** de uma tarefa que não existe, `POST /api/openbot/heartbeat` assinado (HMAC-SHA256 do corpo cru com `x-ln-signature` e `x-ln-timestamp`, janela de 5 minutos; formato em `packages/openbot/docs/PROTOCOL.md`), feito por quem tem acesso ao segredo (Integration ou DevOps). O segredo **nunca** vai ao chat nem a argumento de linha de comando. **Esperado:** **404 `LEASE_ERROR`** (a assinatura foi aceita e nada foi criado).
- **Se for diferente:** 401 ou `sem_segredo` = o servidor não tem o segredo, ou ele é diferente do do cofre do OpenBot; 423 `KILL_SWITCH` = o kill está ligado. Corrija antes de seguir.

### 1b. Pull manual: a recusa `423 DISPATCH_OFF` (fora do smoke)

- **O que fazer:** um `POST /api/openbot/pull` assinado, na conta de um agente (`claude` ou `codex`), com o despacho ainda DESLIGADO. Quem tem o segredo faz (cliente: `ln-openbot-agent.mjs pull --limit 1`, depois de integrado; ou assinatura manual).
- **Esperado:** **423 `DISPATCH_OFF`** com assinatura válida e **nenhuma tarefa entregue**. O `pull` confere a assinatura ANTES de recusar (`ft/backend` `59eed1b`): sem segredo ou com assinatura inválida a resposta é **401**. O cliente devolve o código da API com `stop: true`.
- **Se for diferente:** 200 com tarefa = o despacho está ligado (volte ao passo 2 ao contrário: remova `LN_FLAGS_ON`); 503 = indisponibilidade real (não é recusa de política; investigue).

## 2. Ligar o piloto (DevOps/PM executa; reversível)

1. `LN_OPENBOT_PILOT=1` no staging. 2. Depois `LN_FLAGS_ON=openbotDispatch`. (Em produção a subida é recusada. **[relato]** Integration.)
- **Esperado:** `GET /api/health` mostra `flags: ["openbotDispatch"]`; o log da subida diz "flags ligadas: openbotDispatch (DP-41, staging)".
- **Confira:** `GET /api/health` com `flags: ["openbotDispatch"]` e, com o cliente integrado, `smoke --expect-dispatch on` (saúde e heartbeat; não faz `pull`, para não tomar lease). Sem o cliente, vale o health e o heartbeat manual do passo 1a.
- **Reverter:** passo 9.

## 3. Disparar uma matéria (comando manual da Fábrica)

A Fábrica não roda sozinha: o operador a dispara. Comece **com uma matéria** (a1).

- **Comando** (no ambiente do staging; ver o cabeçalho de `apps/workers/src/editorial-factory.main.ts`): `APP_ENV=staging LN_OPENBOT_PILOT=1 LN_FACTORY_FLAGS=editorialCollector,editorialPipeline node dist/editorial-factory.js --run --max 1` (com `DATABASE_URL` e `DB_SSL_*_PEM`). **[verificado no código; o caminho de `dist` no staging não foi conferido]**
- **Esperado:** a Fábrica coleta uma fonte habilitada, passa pelos gates determinísticos e enfileira a **pauta**; imprime um relatório JSON; **nenhuma matéria é publicada**.
- **Se ela esperar o agente e terminar por tempo-limite:** a tarefa fica **pendente** (sem API); rode o mesmo comando de novo depois que o agente concluir: a mesma `idempotencyKey` retoma a mesma tarefa. **[relato]**
- **Se `--run` recusar:** confira `APP_ENV=staging` e `LN_OPENBOT_PILOT=1` (sem os dois, o piloto não existe).

## 4. Rodar os agentes, uma etapa por vez (disparo manual)

Cada ciclo de agente é um turno na assinatura; por isso **não use rotina permanente**: mande uma mensagem ao agente ("rode um ciclo") ou `openbot.start_task`. Ordem por matéria:

| Ordem | Agente | Etapa | Esperado na linha da planilha |
|---|---|---|---|
| 1 | Pauta | `triage` | conta `claude`, modelo com **haiku** (ou sonnet no backup), custo 0, lane `subscription` |
| 2 | Redação | `draft` | conta `claude`; `article_id` da matéria |
| 3 | Checagem | `factcheck` | conta **`codex`** (nunca claude), `reviewed_draft_task_id` = a redação |
| 4 | Revisão | `review` | conta **`codex`**, mesmo `reviewed_draft_task_id` |
| 5 | Social (opcional) | `social_pack`, `roles` | conta `claude`; só rascunho |

- **Depois de cada ciclo:** confira que a etapa seguinte apareceu e que a linha da etapa tem `output_valid` e nenhuma violação.
- **Limite da conta:** o agente roda `limit`; a tarefa **espera a janela**; **não** tente outra conta nem API. Anote mensagem e hora (o piloto mede isso).
- **Veredito na linha:** depois de cada checagem e revisão, a linha da etapa deve trazer `gate_verdict` (a Editorial o grava; é de melhor esforço). Se faltar, procure o evento de auditoria `pilot_row_patch_failed` da Fábrica (**[não verificado]** onde ele aparece no staging): a matéria fica com linha inválida no avaliador até alguém corrigir; o piloto não para por isso.
- **Se o agente receber 423** (`DISPATCH_OFF`, `KILL_SWITCH` ou `PILOT_STOPPED`): ele para o ciclo (`stop: true`). Vá ao passo 9 ou 7.

## 5. Acompanhar em `/studio/piloto`

- **Tela:** `/studio/piloto` (admin ou editor-chefe). **[relato; `ft/studio-2`, fora da main]**
- **Esperado:** tabela das matérias a1 a a10 com a fonte e o **estado** de cada uma; enquanto nenhuma matéria estiver ligada a um rascunho, a tela mostra "Piloto ainda não executado" (é o estado honesto, não um erro).
- **Por tarefa:** as linhas (uma por tarefa e tentativa) saem em `GET /api/studio/openbot/piloto/linhas` e na planilha (passo 8).
- **Ligar matéria ao rascunho** (a tela foi desenhada para depois da rodada; se ela aceita mapa parcial, durante a rodada, **[não verificado]**), no mesmo `/studio/piloto`, "Ligar matérias aos rascunhos": informe o id do artigo de cada matéria (da coluna `article_id` da planilha), marque "Confirmo o mapa" e **Fixar mapa**. **Não dá para alterar depois.**
- **Repita 3 e 4** até a10, **uma matéria por vez**, conferindo o passo 5 entre elas.

## 6. Ler as matérias (leitor 1 = proprietário; leitor 2 = QA 3 em a1, a4, a6 e a9)

- **Tela:** `/studio/piloto/<materia>` (ex.: `/studio/piloto/a1`): texto, fontes com link, checagem, revisão e avisos de tom lado a lado. **[relato]**
- **Como ler** (poucos minutos): marque só o **fato material que não bate com a evidência**; para cada um: trecho, tipo, gravidade (alta = número, data, valor, citação, atribuição; média = nome, condição; baixa = contexto) e a evidência mais próxima. Confira as três caixas e o veredito (aprovado ou bloqueado) e **Registrar leitura**. Folha de apoio: `fast-track/piloto/folha-de-leitura.md`.
- **Leitor 2:** o QA 3 registra a leitura dele sem ver a sua; `/studio/piloto/importar` importa a folha do leitor 2. Divergência: **a decisão é do proprietário**.
- **Critério (aprovado pelo PM):** **0 fatos de gravidade alta nas 10 matérias e no máximo 1 de gravidade média**; baixas só anotadas. A tela mostra "Resultado do critério" quando há leituras.
- **O limiar de `output_valid` ≥ 95% é informativo** (não reprova), mas aparece em destaque no relatório (PM-2026-11-23-J).

## 7. Resolver uma violação (`/studio/piloto/violacoes`; só admin)

Uma violação (tentativa de publicar, chamada à API tarifada, segredo em log, ferramenta fora do contrato) **para o piloto na hora** (`PILOT_STOPPED`, 423).

1. Abra `/studio/piloto/violacoes`: a lista mostra a tarefa, a tentativa, a etapa, a conta e o tipo. **Nada é apagado.**
2. Entenda a causa. **Segredo em log:** rotacione o segredo antes (a ação "Segredo rotacionado" é obrigatória).
3. Em "Resolver" escolha a ação (`Segredo rotacionado`, `Despacho bloqueado até a correção`, `Agente ou contrato corrigido`, `Falso positivo conferido`), escreva o **motivo** e confirme. Fica registrado com autor, data e motivo.
4. **Retomar:** `POST /api/studio/openbot/pilot/resume` (só admin, auditada); só limpa a parada se não houver violação pendente. **[relato]** (se a tela tem botão para isso, **[não verificado]**).
- **Esperado:** `pull` volta a entregar; a violação continua contando no critério de 0 violações.
- **Se a parada voltar logo:** não retome em laço; pare (passo 9).

## 8. Exportar a planilha

- **Tela:** `/studio/piloto` → **Exportar planilha** (só o leitor 1: admin ou editor-chefe). **[relato]**
- **Esperado:** download `piloto-planilha-AAAA-MM-DD.csv`: **31 colunas** do AgentOps (`task_id` … `notes`, nessa ordem) mais 7 colunas do Studio no fim (`materia`, `leitor1_veredito`, `leitor2_veredito`, `leitor2_unsupported_high/medium/low`, `leitor2_origem`); uma linha por tarefa e tentativa; o leitor 2 só aparece nas matérias que você já leu; células com fórmula vêm neutralizadas (`'=…`). **[verificado]** colunas contra o código (`pilot-columns.test.ts`).
- **Confira no CSV:** `tarifada_api_call` = false em todas as linhas; `published_attempt` = false; `account` só `claude` ou `codex`; `tokens_measured` = false (o OpenBot não expõe tokens: use `packet_chars`).
- **Resultado do piloto (comando):** na pasta do repositório, com Node ≥ 22.18:
  `node packages/agents/bin/avaliar-piloto.mjs --csv <arquivo.csv>` (acrescente `--json` para um resumo em JSON).
  - Ele valida o cabeçalho (as 31 colunas do AgentOps, na ordem; as 7 do Studio no fim são ignoradas; qualquer outra coluna recusa), roda o avaliador do piloto e imprime o **veredito** e os **motivos**. Não usa rede, banco, segredo nem modelo: só lê o arquivo.
  - **Esperado:** `VEREDITO: APROVADO` e **saída 0** quando a amostra é válida, a checagem e a revisão são de autor diferente do redator, a qualidade passa (0 altas e no máximo 1 média; baixas só anotadas), não há violação nem chamada à API tarifada e as janelas de limite foram medidas. Qualquer outro veredito (`REPROVADO`, `INVÁLIDO`, `PARADO`, `INCONCLUSIVO`) ou CSV malformado dá **saída 1**, com o motivo na tela.
  - **Violações tratadas contam:** a violação resolvida em `/studio/piloto/violacoes` continua na planilha e continua contando no critério de 0 violações (o veredito fica `PARADO`).
  - Há o **destaque do `output_valid`** (limiar de 95%, informativo: não reprova, PM-2026-11-23-J).
  - Exemplos com dados SIMULADOS: `packages/agents/fixtures/pilot-csv/` (aprovado, reprovado, inválido).

## 9. Parar (qualquer momento, sem destruir nada)

Do mais leve ao mais forte; **pare no primeiro que resolver**:

1. **Parar os ciclos:** não mande mais ciclos aos agentes e desligue qualquer rotina deles.
2. **Desligar o despacho:** remova `LN_FLAGS_ON` no staging (DevOps/PM). **Esperado:** `pull` com assinatura válida = **423 `DISPATCH_OFF`** (sem segredo = 401); heartbeat, `io/input`, `io/result` e o callback em curso **seguem**. Despacho da Fábrica = **409** `DISPATCH_OFF`.
3. **Kill switch** (só admin, MFA, auditado), escopo `route:openbot`:
   - Studio/API: `POST /api/studio/orcamento/kill-switch` com `{ "escopo": "route:openbot", "acionar": true, "motivo": "<≥ 5 caracteres>" }`;
   - ou CLI: `node apps/workers/dist/budget-cli.js kill on "<motivo>" --route openbot --actor <id>` (usa `DATABASE_URL` e `DB_SSL_*_PEM`).
   - **Esperado:** `pull`, `heartbeat`, `io/input` e `io/result` = **423 `KILL_SWITCH`**; o callback em curso ainda fecha. **Desligar:** a mesma chamada com `"acionar": false` (ou `kill off`); o `pull` volta a entregar. O kill **prevalece** sobre a flag. **[relato; falta repetir no staging real]**
4. **Parada do piloto** (violação): é automática (`PILOT_STOPPED`, 423); só o passo 7 a libera.
5. **Reverter de vez:** rotacione o segredo HMAC (o antigo vai em `OPENBOT_HMAC_SECRET_PREVIOUS` até trocar o arquivo do cofre do OpenBot, depois remova o `_PREVIOUS`). `delete_agent` exige o OK do proprietário e não é necessário para parar.

Depois de parar: registre hora, quem parou, o motivo e o que o agente viu (código da API, sem segredo).

## 10. Encerrar o piloto

1. Exporte a planilha final (passo 8) e guarde o CSV.
2. Desligue `LN_FLAGS_ON` e `LN_OPENBOT_PILOT` e confirme `/api/health` com `flags: []`.
3. Desligue as rotinas dos agentes; mantenha-os criados só se o PM mandar.
4. Entregue ao PM: a planilha, o resultado do critério (altas, médias, baixas), as janelas de limite medidas por conta, o tempo por etapa e o retrabalho.

## Não verificado (só se prova no staging real)

- Que o OpenBot real roda `node` e alcança o HTTPS do staging, e que o modelo segue o procedimento sem desvio.
- O caminho de `dist/editorial-factory.js` e `dist/budget-cli.js` no staging; se `/studio/piloto/violacoes` tem botão de retomada.
- Limites das contas Claude e Codex, texto e hora de retomada que cada uma informa.
- As telas e rotas do Studio 2 estão em `ft/studio-2` (`35fa9c4`), fora da main; os comandos e rotas de outros donos são relato dos respectivos pareceres e documentos.
