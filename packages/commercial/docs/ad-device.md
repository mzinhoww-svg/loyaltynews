# Ad server: `device` (desktop | mobile)

Contrato para o portal (Frontend) e para o Backend. Origem: proposta do Frontend 1, aprovada pelo PM. Tudo continua atrás da flag `adServerVendas` (desligada por padrão: house, `counted:false`, nada toca Redis nem banco).

## Pedido

`POST /api/commercial/ads/serve`

```json
{ "positionId": "TOP", "pageViewId": "…", "device": "mobile" }
```

`device` é opcional: `"desktop"` ou `"mobile"`. Outro valor (`"tablet"`, vazio, número, lista) é recusado pela validação (erro 4xx); nunca vira desktop em silêncio. **Sem `device` vale `desktop`**, ou seja, o comportamento de antes.

## Regra

A variante do criativo sai da **dimensão real do arquivo** contra a posição (`creativeVariant`):

| Dimensão do arquivo | Variante |
|---|---|
| igual à dimensão desktop da posição (ex.: TOP 1280x150) | `desktop` |
| igual a uma dimensão mobile da posição (`320x100` ou `300x250`) | `mobile` |
| qualquer outra | não é criativo real (BAD_DIMENSIONS) |

- `device: 'mobile'` só rotaciona criativos **mobile** da posição. `desktop` (ou sem `device`) só rotaciona criativos **desktop**. Nunca se estica nem se troca um pelo outro.
- Sem criativo compatível: `200` com `{ kind:'house', creativeId:null, impressionId:null, counted:false, reason }`. **Não conta impressão**, não cria linha no livro e não mexe em contador. `reason` = `sem criativo mobile elegível; house ad` (mobile) ou `sem criativo elegível; house ad` (desktop).
- Todas as outras regras são iguais nas duas variantes: aprovado, campanha ativa, período, criativo real (hash, alt, anunciante, destino https, peso), rotação ponderada, dedupe por `pageViewId|positionId`, bot/interno sem contar, suspensão por perda de dedupe, visível/clique uma vez por impressão.
- O crédito da rotação é por `posição|criativo`, então a rotação mobile não interfere na desktop.
- Uma visualização (`pageViewId` + posição) que já recebeu criativo de outra variante não o devolve a este `device`: house, sem contar.
- O anúncio devolvido (`ad.width`, `ad.height`) traz a dimensão do próprio criativo (ex.: 320×100). O portal deve usá-la e recolher a posição quando vier house.

## Plano `GET /api/commercial/ads/plan`

Campo **aditivo** `mobile` em cada `slots[]`:

```json
{ "positionId": "TOP", "available": true, "width": 1280, "height": 150, "mobile": [{ "width": 300, "height": 250 }, { "width": 320, "height": 100 }] }
```

- `available`, `width` e `height` falam **só do desktop**: uma posição com apenas criativo mobile tem `available:false`.
- `mobile` lista as dimensões mobile com criativo real elegível hoje (ordenadas, sem repetir); `[]` = nenhuma (o mobile recolhe).
- Com a flag desligada: `available:false`, `mobile: []`.

## Validação do criativo (mudança de regra, atenção do Studio/QA)

Antes, só a dimensão desktop da posição era aceita. Agora `validateCreative` aceita **a desktop ou uma das mobile** da posição; fora disso `BAD_DIMENSIONS` (mensagem cita as duas). Posição sem dimensão configurada continua `POSITION_NOT_CONFIGURED`. Nenhuma outra regra mudou.

## Limites conhecidos

- A ativação da campanha exige "criativo aprovado" sem distinguir variante: uma campanha só com criativo mobile ativa e entrega apenas no mobile (no desktop, house). Se o proprietário quiser exigir as duas variantes, é decisão a registrar (gate novo).
- O caminho público com Redis (`apps/web/app/api/_lib/commercial/ads.ts`) repassa `device` pelo mesmo handler; os testes novos cobrem o domínio e os handlers, não o Redis.
- O mobile do inventário é o mesmo para as 5 posições vendáveis (`320x100`, `300x250`); posições sem dimensão não têm variante mobile.
