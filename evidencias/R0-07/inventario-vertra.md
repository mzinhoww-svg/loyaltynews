# R0-07 — Inventário Vertra somente leitura (saneado) — v2, cópia para o repositório público
Saneamento adicional (Security, 24/11): nomes de projetos fora do Loyalty News trocados por rótulos neutros, IDs de 8 caracteres desses projetos omitidos e caminho local trocado por relativo. Nenhum número, resposta ou resultado mudou.
Autor: LN DevOps Engineer · Coleta 1: 22/11/2026 (tarde) · Coleta 2: 22/11/2026, ~18h16 BRT (21:16 UTC) · Status: preparação para verificação retroativa (V21-03). **Não é aceite.** Revisão: Independent QA (`qa/revisao-R0-07-R0-04.md`).
Substitui `inventario-vertra.md` (v1). Mudanças da v2: evidência de negação de escrita (§2), números confirmados pelo QA e segunda leitura (§3), respostas 2/3/7/8/10/12 alinhadas à revisão do QA (§8), log com a chamada 13.
Servidor usado: apenas `vertra-ln-leitura` (chave de escopo de leitura). Servidor remoto `vertra` não usado. Nenhuma ferramenta de escrita, exclusão, deploy, pedido ou pagamento foi invocada por mim, nem para teste. Não usei `list_envs`, `get_connection_info`, `read_file`, `get_logs`.
Saneamento: nome/e-mail do titular, host e porta do banco, URLs de repositório e IDs completos foram omitidos (IDs truncados em 8 caracteres na versao interna; nesta copia publica, os IDs dos projetos externos foram omitidos).

## 1. Achado principal
**A conta Vertra consultada é a conta pessoal do proprietário e hospeda outros projetos. Não existe nenhum recurso do Loyalty News nela hoje.** Sem workspaces, stacks nem imagens Docker. Tudo em "Recursos existentes" é de outros projetos e **não pode ser tocado**.

## 2. Evidência de negação de escrita (teste previsto de R0-07)
Não repeti o teste (instrução do PM; regra 4a). A evidência é o teste do Security & Governance, revisado pelo QA: `teste-escopo-chave-leitura-20261122.md` (nesta pasta) (22/11/2026, ~17h40 BRT).
- `restart_app`, `set_env` e `update_app_config` contra um ID inexistente → `API_KEY_SCOPE_DENIED`, com o escopo exigido (`apps:write`, `apps:envs`). A recusa veio **por escopo**, antes da busca do recurso. Leituras (`list_apps`, `list_databases`) funcionaram antes e depois.
- A sonda `delete_app` foi **invalidada** (regra 4a) e não conta como evidência.
- Limitações registradas pelo Security: escopos exatos da chave não foram vistos (inferidos); não testados `databases:*` de escrita, `databases:credentials`, `apps:files`, `blob:write`, `billing:*`, `workspaces:*`; o catálogo do cliente local ainda lista 141 ferramentas, **incluindo as de escrita** (a barreira é a chave, não o cliente; "negar escrita no cliente" segue não atendido); F-055 continua aberto até o aceite externo.
- Não consultei o painel de atividades da Vertra: a ausência de mutações no histórico da plataforma **continua não verificada** (critério de aceite do verificador).

## 3. Plano e capacidade (números confirmados pelo QA)
| Item | Valor |
|---|---|
| Plano | `pro-4` (R$ 20,90/mês no preço de tabela de 1 mês, `list_plans`) |
| Memória alocada | 4096 MB no limite; **3072 MB alocados** = 5 apps (512 + 128 + 384 + 512 + 512 = **2048 MB**) + 1 banco (**1024 MB**) |
| Memória livre | **1024 MB** (alocação, **não consumo ao vivo**) |
| Vigência | 90 dias, expira em 11/02/2027 |
| Limites do plano | 60 deploys/h; 300 req/min (API); 2 domínios/app; 32 backups manuais/24 h (conta); 5 membros de workspace; 15 versões anteriores; até 2 imagens Docker; Blob 50 GiB; rollback, rollback automático, zero downtime, gerenciador de banco, criar workspace |
| Workspaces / stacks / imagens / pastas | nenhum |

Confirmações e conciliação:
- **Duas leituras minhas** (coleta 1 e 2, `get_profile`) deram os mesmos 5 apps e 1 banco, 3072/4096 MB. A leitura do QA (`get_profile`, `list_apps`, `list_databases`) bateu: 5 apps e 1 banco.
- **A leitura anterior do PM (7 apps, 4096/4096) não foi reconciliada.** Nem eu nem o QA temos dois snapshots comparáveis com horário e IDs saneados para dizer se houve remoção ou mudança. Meu histórico de snapshots mostra recursos que não aparecem mais na lista de apps (`projeto externo E (painel)`, `projeto externo E (worker)`, `projeto externo F (homologacao)` e uma versão antiga de `projeto externo C (worker)`, ~1 snapshot a 2 por recurso): isso é compatível com 2 apps removidos, mas **é só indício, não prova**. Recomendo reconfirmar com o provisionamento antes de planejar capacidade (QA).
- Mínimos da plataforma: PostgreSQL 1024 MB, Redis 512 MB, aplicação 100 MB. Com 1024 MB livres cabe **só um PostgreSQL mínimo**, sem Redis nem aplicação juntos. Dev + staging + prod do LN 2.1 (web, API, workers, PostgreSQL, Redis) **não cabem** no plano atual; exige decisão do dono/FinOps antes de R1 (R0 não contrata nem paga).

## 4. Recursos existentes (outros projetos — NÃO TOCAR)
Todos no cluster 1, status `up` nas duas coletas.
| Recurso (ID 8) | Tipo | RAM | Linguagem | Observação |
|---|---|---|---|---|
| (id omitido) projeto externo A (site estatico) | app web (estático) | 512 MB | static | subdomínio `*.vertraweb.app` |
| (id omitido) projeto externo B (worker) | worker (sem HTTP) | 128 MB | TypeScript (Node 22) | ligado a repositório externo |
| (id omitido) projeto externo C (worker) | worker | 384 MB | Python 3.13 | |
| (id omitido) projeto externo D (gateway) | app web | 512 MB | TypeScript (Node 22) | gateway de mensagens |
| (id omitido) projeto externo B (web) | app web | 512 MB | TypeScript (Node 22) | 2 domínios próprios ativos com SSL; health check `/api/health` |
| (id omitido) projeto externo B (banco) | PostgreSQL 18 | 1024 MB | — | TLS + certificado de cliente; ~101 MB em uso |
Uso ao vivo (coleta 1, instantâneo): CPU < 0,3% em todos; RAM em uso por app 10–202 MB; armazenamento por app 0,5–1426 MB (limite fixo de 10 GB por app). Banco: 72,6 MB de RAM e 100,9 MB de disco. Nenhum app usa zero downtime ou rollback automático.

## 5. Backups e snapshots (observado)
- `projeto externo B (banco)`: 10 snapshots, de 14 a 22/11/2026; os dois mais recentes (21 e 22/11, ~07h) com origem `automatic` (backup diário de banco, desde o Pro). Último: 11,68 MB.
- Apps: snapshots de 14–20/11 em projeto externo B (web), projeto externo B (worker), projeto externo D (gateway), projeto externo C (worker) (origem não informada pela API).
- Documentação: backup diário automático de **aplicações** só a partir do Business; de **bancos** a partir do Pro.

## 6. Rede, domínios, bancos e runtimes
- Domínios próprios: só em `projeto externo B (web)` (2 de 2 permitidos). Cada app Pro admite no máximo 2.
- Banco: host público `<id>.db.usa1.vertraweb.app`, porta própria, TLS e certificado de cliente obrigatórios; a documentação não menciona rede privada.
- Regiões bloqueadas ou com verificação por navegador em `*.vertraweb.app`: ver documentação (§7); afeta webhooks de países como Índia, Vietnã, Indonésia (403 a clientes de API).
- Bancos para novos recursos: PostgreSQL 18 (recomendado) e 17; Redis 8.2 e 7.2; MongoDB 8.0/9.0; MySQL 9.7/8.4. Extensões PostgreSQL só as "trusted"; **sem pgvector e sem PostGIS**.
- Runtimes: Node/TypeScript 24.22 e 26.13, Bun 1.4, Python 3.13/3.14, Go, PHP, Ruby, Java 17/21, Rust, Deno, .NET 10, Elixir.

## 7. Perguntas que exigem o suporte da Vertra (a cargo do PM; envio a terceiros precisa do proprietário)
1 (país/datacenter), 2 (rede privada fora de stacks), 3 (PITR), 4 (persistência e descarte do Redis), 9 (retenção e exportação de logs de aplicação), 11 (saída de rede e conexões ao banco), 12 (tempo de restauração). Não enviei nada a ninguém.

## 8. Respostas às 12 perguntas (`03_ARCHITECTURE_OPTIONS.md` §4) — situação após revisão do QA
Fontes: `get_docs` (22/11/2026), inventário, revisão do QA e teste do Security.
| # | Pergunta | Resposta | Situação |
|---|---|---|---|
| 1 | País/datacenter | A doc diz "plataforma brasileira", mas **não informa país nem datacenter**; o host de banco contém `usa1`. | **Suporte Vertra** |
| 2 | Rede privada app↔banco | Doc: apps de uma stack usam o **endereço público** com certificados; outro modo retorna `STACK_NETWORK_MODE_UNAVAILABLE`. **Confirmado para stacks (QA).** Fora de stacks, sem evidência de rede privada. | Parcial; **Suporte Vertra** |
| 3 | Retenção; PITR | Manual 30 dias; diário mais recente 30 dias, anteriores 7; expiração de plano 30. **Confirmado (QA).** **PITR não demonstrado.** | Retenção ok; PITR → **Suporte Vertra** |
| 4 | Redis persiste? Descarte? | Doc dá só versão, TLS, RAM mínima 512 MB e console de chaves. Persistência e política de descarte **não documentados**. | **Suporte Vertra** |
| 5 | Capacidade livre; o que não tocar | 1024 MB livres (alocação) no `pro-4`; não tocar nos 5 apps e no banco da §4. Reconfirmar com o provisionamento (divergência com leitura do PM). | Respondida, com ressalva |
| 6 | Separar homologação/produção em workspaces | Pro permite criar workspace (até 5 membros) com papéis e permissões customizáveis. Chaves distintas por workspace: não verificado. Hoje não há workspace; criar exige escrita (fora de R0). | Parcial |
| 7 | Chromium sem root | Runtime roda como `1000:1000`; doc: Puppeteer usa o Chromium da imagem; precisa de 512 MB+. **Isso não demonstra a execução do workload, o sandbox nem a memória compartilhada (QA).** | Parcial; testar em ambiente não produtivo |
| 8 | Health check e troca sem indisponibilidade | **Funcionalidade documentada (QA):** health check HTTP em `deploy.health_check_path` (5 s por tentativa, 2 respostas boas seguidas; 404 conta como saudável; 5xx, recusa e timeout reprovam), zero downtime desde o Starter 2, rollback automático no Pro. Workers com zero downtime `on` rodam duas cópias por um tempo. Não testado na prática. | Respondida (documental) |
| 9 | Retenção e exportação de logs | Tráfego (sem caminho nem IP) e histórico de atividade: 30 dias; requisições com chave de API: 30 dias; registros de acesso: 6 meses. **Retenção dos logs de aplicação e exportação não documentadas.** | **Suporte Vertra** |
| 10 | Escopos de chave sem escrita | Escopos de leitura documentados (`apps:read`, `databases:read`, `snapshots:read`, `stacks:read`, `workspaces:read`, `images:read`, `members:read`, `activities:read`, `account:read`). **Negação de escrita demonstrada pelo teste 07 do Security (restart_app, set_env, update_app_config → `API_KEY_SCOPE_DENIED`), revisado pelo QA.** Fora de teste: `databases:*` de escrita, `apps:files`, `blob:write`, `billing:*`, `workspaces:*`. O catálogo do cliente ainda expõe 141 ferramentas, inclusive de escrita. | Respondida e evidenciada (cobertura parcial dos escopos) |
| 11 | Limites de saída e de conexões ao banco | Documentados: requisições por IP de visitante (valor não publicado), rate limit da API (Pro 4: 300/min, 172.800/dia), console SQL 30/min. **Saída de rede e conexões simultâneas ao banco: não documentados.** | **Suporte Vertra** |
| 12 | Restaurar snapshot em outra instância | **Operação documentada (QA):** criar banco novo a partir de snapshot (job; sem limite de tamanho além do armazenamento do destino; cooldown de **60 s por usuário** para criar e **120 s por banco** para restaurar banco existente; versão igual ou mais nova, nunca mais antiga). **Tempo de execução não documentado.** | Processo ok; tempo → **Suporte Vertra** |

## 9. Não verificado
- Ausência de mutação no histórico da plataforma (painel de atividades não consultado).
- Escopos de escrita fora dos três testados; cobertura exata de escopos da chave (inferida).
- Bloqueio das ferramentas de escrita **no cliente** (não atendido; só a chave protege).
- Divergência de capacidade com a leitura anterior do PM (7 apps, 4096/4096): causa não estabelecida.
- Origem exata dos snapshots de apps; se `projeto externo E` e `projeto externo F (homologacao)` foram removidos.
- Preços: de `list_plans` em 22/11/2026; cotação exata exige `quote_order` (fora de R0).
- Região efetiva dos recursos.

## 10. Log saneado das chamadas (minhas)
Servidor `vertra-ln-leitura`, 22/11/2026, todas somente leitura.
| # | Ferramenta | Resultado resumido |
|---|---|---|
| 1 | `get_profile` | plano pro-4, 5 apps, 1 banco, 3072/4096 MB (coleta 1) |
| 2 | `list_workspaces` | `[]` |
| 3 | `list_apps` | 5 apps `up`, uso ao vivo |
| 4 | `list_databases` | 1 banco `up` |
| 5 | `list_plans` | 22 planos, ciclos 1/3/6/12 meses |
| 6 | `list_stacks` | `[]` |
| 7 | `list_images` | `[]` |
| 8 | `list_database_versions` | PG 18/17, Redis 8.2/7.2, Mongo, MySQL |
| 9 | `list_runtimes` | 13 linguagens |
| 10 | `get_docs` (completo) | documentação oficial |
| 11 | `list_snapshots` scope=applications | 8 recursos com snapshots |
| 12 | `list_snapshots` scope=databases | 1 banco, 10 snapshots |
| 13 | `get_profile` (coleta 2, ~18h16 BRT) | os mesmos 5 apps, 1 banco, 3072/4096 MB |
Não chamadas: `list_envs`, `get_connection_info`, `read_file`, `get_logs`, qualquer `create_*`, `update_*`, `set_*`, `delete_*`, `reset_*`, `restore_*`, `deploy_*`, `*_order`, `get_pix`.
Segredos: nenhum neste documento.
