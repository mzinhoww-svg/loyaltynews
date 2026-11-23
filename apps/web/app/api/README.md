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
| `GET/POST /api/midia`, `GET/PATCH/DELETE /api/midia/{id}` | midia:* | metadados, base de direito, **evidência e expiração da licença** (licença/autorização/exceção exigem evidência; vencida ⇒ `publicavel=false`; `?vencendo=N`, `?vencida=true`); **deduplicação por sha256** (mesmo conteúdo ⇒ 200 `deduplicada`) |
| `POST /api/midia/arquivo` | midia:create | upload multipart (`arquivo` + `metadados` JSON): tipo e sha256 do CONTEÚDO (JPEG, PNG, GIF, WebP até 5 MB; PDF até 10 MB; SVG/HTML recusados com 415); arquivo no Blob S3 em `midia/{sha256}`; sem S3 configurado ⇒ 503 |
| `GET /api/midia/{id}/arquivo` | midia:read | bytes do arquivo com `nosniff` e CSP `sandbox` |
| `GET/POST /api/agenda`, `GET/PATCH/DELETE /api/agenda/{id}` | agenda:* | `?from&to` (YYYY-MM-DD), `?moderacao=pendente|aprovado|rejeitado`, `?origem=interno|publico`; evento da redação nasce aprovado |
| `POST /api/agenda/{id}/moderacao` `{estado: aprovado|rejeitado, motivo?}` | agenda:transition (editor-chefe, admin) | rejeitar exige motivo; auditada com ator e motivo; repetir é inofensivo |

Matéria: `resumo` (até 300, obrigatório para aprovar/publicar), `tipoConteudo` (padrão `noticia`; `patrocinado` exige `patrocinado=true` + rótulo) e `tempoLeituraMin` derivado do corpo.

### Home, menus, SEO e links internos (`/api/site/**`)
Documentos versionados por tipo: `home`, `menu_principal`, `menu_rodape`, `seo_global`, `links_internos`. Um rascunho por tipo; publicar cria a próxima versão e marca a anterior `substituido`; agendar guarda a versão com `publicarEm` (um agendamento por tipo, 1 min a 365 dias à frente) e ela entra em vigor sozinha na hora marcada. Rollback = NOVA versão com o conteúdo de uma anterior (o histórico não é reescrito). Conteúdo é só dado (rótulos, caminhos internos, URLs http/https, slugs, ids de posição): validação estrita, sem HTML, sem `/api`, `/studio`, `/_next` nos destinos.

| Rota | Permissão | Nota |
|---|---|---|
| `GET /api/site/documentos?tipo=` | site:read | versões (metadados) |
| `GET /api/site/documentos/{tipo}` | site:read | `vigente`, `rascunho`, `agendado` |
| `PUT /api/site/documentos/{tipo}/rascunho` `{conteudo}` | site:update; home e menus só chefia/admin | substitui o rascunho |
| `GET /api/site/documentos/{tipo}/preview` | site:read | pendências + home com matérias/dimensões resolvidas |
| `POST /api/site/documentos/{tipo}/publicar` `{agendarPara?}` | site:publish (chefia, admin) | 422 `PENDENCIAS` (matéria fixada inexistente/não publicada; posição publicitária sem dimensão); 409 `AGENDAMENTO_EXISTENTE`/`AGENDAMENTO_PENDENTE`; 202 ao agendar |
| `DELETE /api/site/documentos/{tipo}/agendamento` | site:publish | volta a rascunho; 409 se já há rascunho |
| `POST /api/site/documentos/{tipo}/rollback` `{versao}` | site:publish | revalida pendências |
| `GET/POST /api/site/redirects`, `PATCH/DELETE /api/site/redirects/{id}` | leitura site:read; criar/alterar site:publish; excluir só admin | origem única; 409 `REDIRECT_LOOP` (laço ou cadeia > 10); teto 2000 |

Público: `GET /api/publico/site` (versão em vigor: home com destaques resolvidos e `dimensao` reservada por posição, menus, SEO + JSON-LD Organization, links internos; cache 60 s), `GET /api/publico/site/redirects` (ativos), `GET /api/publico/site/sitemap` (sem SEO publicado ou `noindex` ⇒ lista vazia; senão matérias `publicado`/`corrigido` de classe `public`). Posição publicitária sem dimensão desktop (ex.: `HOME_BETWEEN` hoje) não publica: não reserva espaço. Tudo auditado (`site.*`).

## Público (Portal, sem login)
`GET /api/publico/materias`, `GET /api/publico/materias/{slug}` (só `publicado`/`corrigido`, classe de dado `public`, com erratas), `GET /api/publico/editorias`, `GET /api/publico/agenda` (só eventos APROVADOS que ainda não terminaram; sem campos de moderação), `POST /api/publico/agenda/sugestoes` (sugestão pública: entra PENDENTE, resposta 202 sem id; sem dado pessoal; campo armadilha `site`; 5 por 15 min por IP com `TRUSTED_PROXY_HOPS`; teto de 200 pendentes ⇒ 429 `FILA_CHEIA`; sem link no título, datas em janela, duração ≤ 30 dias; idêntica pendente não duplica).

## Workers (apps/workers)
`npm run build -w @ln/workers` gera `apps/workers/dist/index.js`; `node dist/index.js` exige `DATABASE_URL` e `REDIS_URL`. BullMQ nas 7 filas do ADR-002; Redis só com IDs; outbox no PostgreSQL com lease e `SKIP LOCKED`; reconciliador recria jobs perdidos; efeito exatamente-uma-vez por `effect_ledger`. Fila sem handler registrado em `src/handlers.ts` não tem worker (os jobs esperam). Produtores gravam com `enqueueOutbox(tx, ...)` na mesma transação do efeito.

## Módulos plugados por adaptador (handlers puros → rotas)
- **Comercial** `/api/commercial/**` (tabela `ROUTES` de `@ln/commercial/api`): públicas (mídia kit, formatos, disponibilidade, lead com limite por IP, ad server) e Studio. `ctx.actor.canManageCommercial` vem do RBAC (`campanhas:update` e `inventario:update`: admin e comercial). O estado do domínio é hidratado do PostgreSQL por requisição e só a diferença é gravada; escritas rodam numa transação com `pg_advisory_xact_lock`. Estado de disponibilidade do formato vem de `ad_formats` (ajustável). O estado é carregado e lido pela API oficial `load()`/`snapshot()` do pacote. `rotulada` é sempre verdadeiro (regra F-074 do banco).
  - **Ad server público** (`/api/commercial/ads/serve` e `/ads/event`): sem hidratar o banco e sem lock; criativos elegíveis do PostgreSQL, dedupe e contadores no **Redis** (`REDIS_URL`; chaves `ln:ad:view|imp|cnt:*` só com ids opacos, TTL 30 min/2 h/3 dias). `SET NX` decide a corrida entre instâncias (quem perde não conta); `HSETNX` conta visível/clique uma vez; o worker grava os contadores em `ad_delivery_daily` a cada minuto: o hash é tomado por `RENAME` atômico para uma chave de trabalho `ln:ad:flush:{uuid}:…` e o uuid entra no ledger `ad_delivery_flushes` NA MESMA transação da soma (exatamente uma vez, mesmo com erro ambíguo); em qualquer erro a chave de trabalho fica (TTL 3 dias) e a próxima rodada a recupera (id no ledger ⇒ só apaga; senão soma com o mesmo id). Nunca devolve às cegas ao hash. Política **sub-contar, nunca inflar**: sem Redis ou com falha, serve com `counted:false` e `reason:'dedupe_indisponivel'`. Com a flag `adServerVendas` desligada nada toca Redis nem banco. Pendente: auditoria de perda do Redis (`server.audit.reportLoss`, watermark `ln:ad:hb`), que exige uma tabela de espelho (Arquiteto).
- **Intelligence** `/api/intelligence/**` (Portal) e `/api/studio/intelligence/**`: Portal só lê pessoas com a flag `intelligencePessoas` (senão 403 `FEATURE_DISABLED`); nunca recebe inferidos. Revisão de move/alerta exige `materias:transition`; pedidos do titular (LGPD) só admin.
- **Editorial**: `PgEditorialStore` (em `@ln/workers/editorial-store`) implementa a porta `EditorialStore` e passa `runEditorialStoreContract` (14 casos). Tabelas `editorial_*`; `record` em `json` (preserva ordem de chaves); auditoria somente-acréscimo. 
- Adaptador genérico: `_lib/handler-adapter.ts` (`createDispatcher`: caminhos com `:param`, permissão por rota, limite de POST público, auditoria).

- **Editorial (Studio e Portal)** `/api/studio/editorial/**` e `POST /api/editorial/right-of-reply`: fila, revisão, checagem, correções, direito de resposta e fontes/habilitação sobre o `PgEditorialStore`. A borda exige sessão + MFA + papel de redação (`materias`); o RBAC fino é o `ACTION_ROLES` do domínio. Escritas numa transação com lock consultivo e store ligado à transação (dois revisores ao mesmo tempo: um vence, o outro recebe 409). `recheck` grava no outbox (fila `checagem`, só ids). **Projeção em `articles` (ADR-017 §4):** `articles` guarda só o conteúdo APROVADO. Com rascunho no CMS editorial (mesmo id), `POST /api/materias/{id}/recibos` (versão opcional) faz, numa transação, upsert em `articles` a partir do rascunho (slug do rascunho, status `aprovado`, campos de `toPublishableContent`, fontes projetadas em sources/evidences/article_sources) e emite o recibo com `draftContentSha256`; rascunho não aprovado = 409 sem efeito; mesmo conteúdo = idempotente (200); conteúdo novo = versão + 1; matéria publicada é imutável (409). A rota de publicação passa a projeção a `publicado` na mesma transação do `commitPublication` (e grava o histórico). As rotas públicas só leem `publicado`/`corrigido`; imagem sem base de direito não sai. `POST /api/studio/editorial/articles/{id}/publication` `{receiptId, url}` registra a publicação (applyPublication → `commitPublication`, uma transação: matéria publicada + auditoria + outbox): atrás da flag `publicacaoPortal` (ADR-017; desligada por padrão; desligada, nada é lido nem gravado; `publicacaoAutonoma`, de agentes/workers, não libera esta rota), sessão + MFA + `materias:publish` (admin, editor-chefe), recibo existente para a matéria (id único: o do CMS editorial é o `articles.id`; recibo de outra matéria = 409), da VERSÃO atual (`versao`) e com o sha do conteúdo aprovado (ADR-017: `draftContentSha256` = `publishedContentSha256` de `@ln/contracts/hash` sobre o RASCUNHO do CMS; o mesmo valor vai no recibo, na chave do outbox e em `publication.contentSha256`; o endpoint `POST /api/materias/{id}/recibos` usa o mesmo hash quando há rascunho editorial com o mesmo id, senão calcula sobre a linha de `articles`); divergência = 409 `RECEIPT_STALE` / `RECEIPT_CONTENT_MISMATCH` sem efeito) e com a identidade de publicação de quem chama, data do servidor, `isMock`/`publishedAt`/campos extras recusados, idempotente pela chave `article.published:{id}:{sha}` (repetir = 200 sem novos efeitos). O formulário de direito de resposta é público, com limite por IP (precisa de `TRUSTED_PROXY_HOPS`), identidade sempre não verificada e contato nunca devolvido por API.

- **Social Dashboard** `/api/studio/social/**` (`@ln/growth`): resumo, fila, pacote, recibos, auditoria, geração e pedido de publicação **simulada**. O publicador é criado só em modo `simulated` (recibos `SIM-…`; nada vai ao mLabs; sem rota nem configuração para o modo real). Permissões vindas do RBAC (recurso `social`: editor-chefe e admin geram e pedem publicação; editor gera; revisor lê). Pacotes no PostgreSQL (`social_packages`); a matéria vem do banco e os fatos só da checagem editorial aprovada (sem fato aprovado o pacote vira `falhou`). A URL canônica do post é `NEXT_PUBLIC_SITE_URL` (a mesma variável do portal) + `/noticia/{slug}`. Limitação: recibos e auditoria do publicador vivem na memória do processo; os pacotes e recibos gravados ficam no banco.

## Pendente
Auditoria de perda do Redis do ad server (depende da tabela `ad_redis_watermark`, Arquiteto).

## Operação
`GET /api/health` (processo vivo), `GET /api/ready` (banco e Redis respondem; 503 se não). `APP_MODE=nodb`: sobe sem banco; rotas de dados respondem 503 `NOT_CONFIGURED` e `/api/ready` diz `mode: nodb`.
Variáveis: `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (Blob S3 compatível; só ambiente, nunca no repositório; sem elas o upload responde 503), `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥32 caracteres), `BETTER_AUTH_URL`, `REDIS_URL`. Nenhum segredo no repositório.
- **Diagnóstico temporário `DIAG_XFF`** (para medir `TRUSTED_PROXY_HOPS` no staging): com `DIAG_XFF=1` e `APP_ENV` diferente de production/producao, `GET /api/health` acrescenta o cabeçalho `x-ln-xff-count` (número de entradas não vazias de `X-Forwarded-For`; hops = contagem − 1 quando você injeta uma entrada falsa). Só a contagem sai: nenhum IP é devolvido, logado ou gravado. Desligado por padrão; em produção é ignorado. Remover a variável depois da medição.

## Decisões abertas (peço ao Chief Architect / Editorial)
- Política de checagens do recibo (hoje: ≥1 checagem `aprovado` + regras determinísticas); `corrigido` = errata sobre a versão publicada (sem editar o texto).
- Papéis do RBAC e matriz (proposta minha).
