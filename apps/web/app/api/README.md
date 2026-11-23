# API do LN (Frente 02 Backend)

Rotas em `apps/web/app/api`; lógica em `_lib/` (handlers puros `(Request, ctx) => Response`, testáveis sem Next).
Envelope de erro: `{ "error": { "code", "message", "details?", "requestId" } }` (`ApiError` de `@ln/contracts`).

## Autenticação (ADR-011, Better Auth)
- `POST /api/auth/sign-in/email` `{email,password}` → senha ok com TOTP ativo devolve `{twoFactorRedirect:true}` + cookie pendente (sem acesso).
- `POST /api/auth/two-factor/verify-totp` `{code}` → cria a sessão (cookie `better-auth.session_token`).
- `POST /api/auth/two-factor/enable` `{password}` → `{totpURI, backupCodes}`; ativar exige depois `verify-totp`.
- `POST /api/auth/sign-out`, `GET /api/auth/get-session`, `GET /api/auth/list-sessions`, `POST /api/auth/revoke-session|revoke-sessions|revoke-other-sessions`, `POST /api/auth/change-password`.
- Qualquer outra rota de `/api/auth/*` (cadastro, reset, social…) responde **404**. Até 5 tentativas por 15 min, por conta e por IP; a 5ª aciona bloqueio de 15 min (**429** + `Retry-After`). A tentativa é reservada de forma atômica (transação com `FOR UPDATE`) antes de verificar a senha, então rajadas simultâneas não passam de 5. Login correto zera a conta e devolve a reserva do IP.
- **IP do cliente**: cabeçalhos de proxy NÃO valem por padrão (o cliente os escreve). Configure `TRUSTED_PROXY_HOPS=N` (N proxies confiáveis na frente do app): vale a N-ésima entrada de `X-Forwarded-For` contada da direita; `X-Real-IP` é ignorado. Sem configuração o limite por IP não se aplica (fica o limite por conta). Como o IP do cliente chega na Vertra **não está na documentação consultada**: o DevOps deve confirmar em staging antes de ligar.
- Sem 2º fator ativo toda rota protegida responde 403 `MFA_REQUIRED`. Sem sessão: 401 `UNAUTHENTICATED`. Sem permissão: 403 `FORBIDDEN`.
- No código (Server Components/rotas): `getSession()` e `requireRole(['admin'])` de `@ln/auth` (nega por padrão).
- Papéis (proposta, matriz em `packages/auth/src/rbac.ts`): admin, editor_chefe, editor, revisor, comercial, leitor.

## Studio (sessão + MFA + papel)
| Método e rota | Permissão | Notas |
|---|---|---|
| `GET/POST /api/editorias`, `GET/PATCH/DELETE /api/editorias/{slug}` | editorias:read/create/update/delete | slug é um dos 10 oficiais; excluir só sem matérias |
| `GET /api/materias?editoria&status&q&limit&offset` | materias:read | lista sem corpo |
| `POST /api/materias` | materias:create | `{slug,titulo,editoria,corpo,evidenceIds[],imagem?,classeDeDado?,patrocinado?,rotuloPublieditorial?}`; assinatura é sempre "Redação Loyalty News" |
| `GET /api/materias/{id}` | materias:read | + fontes, recibo da versão atual, histórico de transições |
| `PATCH /api/materias/{id}` | materias:update | exige `versaoEsperada`; só `rascunho`/`bloqueado`; cada mudança soma 1 à versão |
| `PUT /api/materias/{id}/fontes` | materias:update | `{versaoEsperada, evidenceIds[]}` |
| `DELETE /api/materias/{id}` | materias:delete | só rascunho |
| `POST /api/materias/{id}/recibos` | materias:transition | só em `em_checagem`; `{versao, checagens[], identidadePublicacao?}`; 422 `GATES_FAILED` se falhar regra determinística; reenvio idêntico devolve 200 |
| `POST /api/materias/{id}/transicao` | materias:transition (+`publish` p/ publicado, corrigido, despublicado) | `{para, nota?, versaoEsperada?}`; aprovar/publicar/corrigir exigem recibo válido (versão e hash do conteúdo); publicar só pela `identidadePublicacao` do recibo |

| `GET/POST /api/fontes`, `GET/PATCH/DELETE /api/fontes/{id}` | fontes:* | fonte nasce inativa; ativar exige `termosRevisados`; só `acesso: publico`; URL só http(s) |
| `GET/POST /api/fontes/{id}/evidencias` | fontes:read/create | evidência só de fonte ativa |
| `GET/POST /api/midia`, `GET/DELETE /api/midia/{id}` | midia:* | só metadados e base de direito (`publicavel`); upload ao Blob ainda não ligado |
| `GET/POST /api/agenda`, `GET/PATCH/DELETE /api/agenda/{id}` | agenda:* | `?from&to` (YYYY-MM-DD) |

Matéria: `resumo` (até 300, obrigatório para aprovar/publicar), `tipoConteudo` (padrão `noticia`; `patrocinado` exige `patrocinado=true` + rótulo) e `tempoLeituraMin` derivado do corpo.

## Público (Portal, sem login)
`GET /api/publico/materias`, `GET /api/publico/materias/{slug}` (só `publicado`/`corrigido`, classe de dado `public`, com erratas), `GET /api/publico/editorias`, `GET /api/publico/agenda` (eventos que ainda não terminaram).

## Workers (apps/workers)
`npm run build -w @ln/workers` gera `apps/workers/dist/index.js`; `node dist/index.js` exige `DATABASE_URL` e `REDIS_URL`. BullMQ nas 7 filas do ADR-002; Redis só com IDs; outbox no PostgreSQL com lease e `SKIP LOCKED`; reconciliador recria jobs perdidos; efeito exatamente-uma-vez por `effect_ledger`. Fila sem handler registrado em `src/handlers.ts` não tem worker (os jobs esperam). Produtores gravam com `enqueueOutbox(tx, ...)` na mesma transação do efeito.

## Módulos plugados por adaptador (handlers puros → rotas)
- **Comercial** `/api/commercial/**` (tabela `ROUTES` de `@ln/commercial/api`): públicas (mídia kit, formatos, disponibilidade, lead com limite por IP, ad server) e Studio. `ctx.actor.canManageCommercial` vem do RBAC (`campanhas:update` e `inventario:update`: admin e comercial). O estado do domínio é hidratado do PostgreSQL por requisição e só a diferença é gravada; escritas rodam numa transação com `pg_advisory_xact_lock`. Estado de disponibilidade do formato vem de `ad_formats` (ajustável). O estado é carregado e lido pela API oficial `load()`/`snapshot()` do pacote. `rotulada` é sempre verdadeiro (regra F-074 do banco).
  - **Ad server público** (`/api/commercial/ads/serve` e `/ads/event`): sem hidratar o banco e sem lock; criativos elegíveis do PostgreSQL, dedupe e contadores no **Redis** (`REDIS_URL`; chaves `ln:ad:view|imp|cnt:*` só com ids opacos, TTL 30 min/2 h/3 dias). `SET NX` decide a corrida entre instâncias (quem perde não conta); `HSETNX` conta visível/clique uma vez; o worker grava os contadores em `ad_delivery_daily` a cada minuto (subtrai do Redis antes de gravar). Política **sub-contar, nunca inflar**: sem Redis ou com falha, serve com `counted:false` e `reason:'dedupe_indisponivel'`. Com a flag `adServerVendas` desligada nada toca Redis nem banco. Pendente: auditoria de perda do Redis (`server.audit.reportLoss`, watermark `ln:ad:hb`), que exige uma tabela de espelho (Arquiteto).
- **Intelligence** `/api/intelligence/**` (Portal) e `/api/studio/intelligence/**`: Portal só lê pessoas com a flag `intelligencePessoas` (senão 403 `FEATURE_DISABLED`); nunca recebe inferidos. Revisão de move/alerta exige `materias:transition`; pedidos do titular (LGPD) só admin.
- **Editorial**: `PgEditorialStore` (em `@ln/workers/editorial-store`) implementa a porta `EditorialStore` e passa `runEditorialStoreContract` (14 casos). Tabelas `editorial_*`; `record` em `json` (preserva ordem de chaves); auditoria somente-acréscimo. 
- Adaptador genérico: `_lib/handler-adapter.ts` (`createDispatcher`: caminhos com `:param`, permissão por rota, limite de POST público, auditoria).

- **Editorial (Studio e Portal)** `/api/studio/editorial/**` e `POST /api/editorial/right-of-reply`: fila, revisão, checagem, correções, direito de resposta e fontes/habilitação sobre o `PgEditorialStore`. A borda exige sessão + MFA + papel de redação (`materias`); o RBAC fino é o `ACTION_ROLES` do domínio. Escritas numa transação com lock consultivo e store ligado à transação (dois revisores ao mesmo tempo: um vence, o outro recebe 409). `recheck` grava no outbox (fila `checagem`, só ids). `POST /api/studio/editorial/articles/{id}/publication` `{receiptId, url}` registra a publicação (applyPublication → `commitPublication`, uma transação: matéria publicada + auditoria + outbox): atrás da flag `publicacaoAutonoma` (desligada por padrão; desligada, nada é lido nem gravado), sessão + MFA + `materias:publish` (admin, editor-chefe), recibo existente para a matéria com a identidade de publicação de quem chama, data do servidor, `isMock`/`publishedAt`/campos extras recusados, idempotente pela chave `article.published:{id}:{sha}` (repetir = 200 sem novos efeitos). O formulário de direito de resposta é público, com limite por IP (precisa de `TRUSTED_PROXY_HOPS`), identidade sempre não verificada e contato nunca devolvido por API.

- **Social Dashboard** `/api/studio/social/**` (`@ln/growth`): resumo, fila, pacote, recibos, auditoria, geração e pedido de publicação **simulada**. O publicador é criado só em modo `simulated` (recibos `SIM-…`; nada vai ao mLabs; sem rota nem configuração para o modo real). Permissões vindas do RBAC (recurso `social`: editor-chefe e admin geram e pedem publicação; editor gera; revisor lê). Pacotes no PostgreSQL (`social_packages`); a matéria vem do banco e os fatos só da checagem editorial aprovada (sem fato aprovado o pacote vira `falhou`). A URL canônica do post é `NEXT_PUBLIC_SITE_URL` (a mesma variável do portal) + `/noticia/{slug}`. Limitação: recibos e auditoria do publicador vivem na memória do processo; os pacotes e recibos gravados ficam no banco.

## Pendente
Auditoria de perda do Redis do ad server (depende da tabela `ad_redis_watermark`, Arquiteto).

## Operação
`GET /api/health` (processo vivo), `GET /api/ready` (banco e Redis respondem; 503 se não). `APP_MODE=nodb`: sobe sem banco; rotas de dados respondem 503 `NOT_CONFIGURED` e `/api/ready` diz `mode: nodb`.
Variáveis: `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥32 caracteres), `BETTER_AUTH_URL`, `REDIS_URL`. Nenhum segredo no repositório.
- **Diagnóstico temporário `DIAG_XFF`** (para medir `TRUSTED_PROXY_HOPS` no staging): com `DIAG_XFF=1` e `APP_ENV` diferente de production/producao, `GET /api/health` acrescenta o cabeçalho `x-ln-xff-count` (número de entradas não vazias de `X-Forwarded-For`; hops = contagem − 1 quando você injeta uma entrada falsa). Só a contagem sai: nenhum IP é devolvido, logado ou gravado. Desligado por padrão; em produção é ignorado. Remover a variável depois da medição.

## Decisões abertas (peço ao Chief Architect / Editorial)
- Política de checagens do recibo (hoje: ≥1 checagem `aprovado` + regras determinísticas); `corrigido` = errata sobre a versão publicada (sem editar o texto).
- Papéis do RBAC e matriz (proposta minha).
