# Contrato da API de watchlists e alertas — para a Frontend 2

Código: `src/api.ts` (handlers como funções puras `(db, input[, actor]) → { status, body }`), `src/watchlists.ts`, `src/queries.ts`. **Contrato testado**: `src/tests/watchlists-contract.test.ts` (formas exatas das respostas, regras de dono, revisão). Quem monta as rotas HTTP é o Backend (autenticação, papéis, entrega do `actor`); a Frontend 2 consome o JSON abaixo. Tudo aqui é **Studio** (autenticado); o portal público não tem watchlists.

Erro: `{ "error": { "code": "invalid_input | not_found | actor_required | already_reviewed", "message": "…" } }` com o status HTTP da tabela.

## Dono (privacidade)
Cada watchlist tem `owner_ref` = identidade de quem a criou (`actor`). O Backend **sempre** passa `actor`: quem não é o dono recebe **404** (a lista não revela que existe). Para listar, `ownerRef` = o próprio `actor`.

## Rotas sugeridas
| Rota | Handler | Entrada | Saída (sucesso) / erros |
|---|---|---|---|
| `GET /api/studio/intelligence/watchlists?ownerRef=` | `listWatchlistsHandler` | `{ ownerRef? }` | `200 { items: [{ id, name, owner_ref, items: número, pending_alerts: número }] }` |
| `POST /api/studio/intelligence/watchlists` | `createWatchlistHandler(db, actor, …)` | `{ name }` (1 a 120 caracteres) | `201 { id }` · 400 nome inválido · 401 sem identidade |
| `GET …/watchlists/:id` | `getWatchlistHandler(db, { id }, actor)` | `{ id }` | `200 { watchlist: { id, name, owner_ref, items, pending_alerts }, items: [{ entity_type: "organization" ou "person", entity_id, name }] }` · 404 |
| `POST …/watchlists/:id/items` | `addWatchlistItemHandler(db, …, actor)` | `{ watchlistId, entityType, entityId }` | `201 { watchlistId, items: […] }` (idempotente) · 404 entidade/lista inexistente ou de outro dono · 400 `entityType` |
| `DELETE …/watchlists/:id/items` | `removeWatchlistItemHandler(db, actor, …)` | `{ watchlistId, entityType, entityId }` | `200 { watchlistId, items: […] }` · 404 não estava na lista ou outro dono |
| `DELETE …/watchlists/:id` | `deleteWatchlistHandler(db, actor, …)` | `{ id }` | `200 { id, deleted: true }` (apaga itens e alertas; os Moves ficam) · 404 |
| `GET …/alerts?status=&watchlistId=` | `listAlertsHandler` | `{ status?: "pending_review" ou "approved" ou "rejected", watchlistId? }` | `200 { items: [Alerta] }` · 400 status inválido |
| `POST …/alerts/:id/review` | `reviewAlertHandler(db, actor, …)` | `{ id, status: "approved" ou "rejected" }` | `200 { id, status, reviewed_by }` · 401 sem revisor · 409 já revisado · 404 |
| `GET /api/intelligence/moves/:id` | `getMoveHandler(db, "studio" ou "public", …)` | `{ id }` | `200 { move: MoveView }` · 404 (no portal, Move não confirmado = 404) |

Entidades observáveis: `organization` e `person` (pessoa suprimida some das listas). Busca para o seletor: `searchCompaniesHandler` e `searchExecutivesHandler`.

## Alerta
```
Alerta = { id, watchlist_id, move_id, status, kind, person_name, basis, evidence_id, observed_on, reviewed_by,
           move: MoveView | null }   // o Move com before/after (ver MOVES_MODEL.md), para decidir sem outra chamada
```
- Nasce `pending_review` (`generateAlerts`, idempotente: um alerta por lista × Move). **Nada sai sem revisão registrada**: `approved`/`rejected` exigem `reviewed_by` e data. `pending_alerts` na lista é o selo "há o que revisar".
- Um alerta nasce quando um Move toca uma entidade da lista: a **pessoa**, ou a **organização** de origem ou de destino do cargo.
- O Move do alerta tem status próprio (`detected/confirmed/rejected`, outra revisão): exibir os dois estados.
- `move` pode ser `null` se o Move saiu da consulta (pessoa suprimida): a tela mostra "indisponível".
- `listAlertsHandler` carrega os Moves em lote de até 200 por chamada: filtrar por `watchlistId`/`status`.

## Regras de exibição (as mesmas do portal)
Fato + fonte + **link** + data (`evidence.source_url`, `source_name`, `retrieved_at`; cargos têm `validated_at`). **Nunca** o trecho da página (não vem na resposta). `is_mock: true` ⇒ escrever MOCK. Cargo `certainty: "inferred"` (fonte secundária, "a confirmar") **não é fato**: só o Studio o recebe, marcado "inferido — não confirmado".

## Não verificado
Rotas HTTP reais, papéis do Backend e paginação de alertas acima de 200 (não implementada); desempenho com volume (só PGlite).
