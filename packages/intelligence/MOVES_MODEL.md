# Modelo de Moves — mudança de cargo com evidência de antes e depois

Código: `src/moves.ts` (`processObservation`), `src/queries.ts` (`MoveView`, `MoveReading`), `src/api.ts` (`getMoveHandler`, `listMovesHandler`, `reviewMoveHandler`). Testes: `src/tests/seed-load-v4.test.ts` ("Moves com duas leituras"), `moves.test.ts`, `moves-views.test.ts`.

## Regra central: Move = DUAS leituras
Um Move só existe quando duas leituras de fonte pública dizem coisas diferentes sobre a mesma pessoa:
1. **Antes**: o cargo aberto (com a **última evidência** que o sustentou e a data da última validação).
2. **Depois**: a nova leitura (evidência, data) — o cargo novo, ou a saída.

Uma leitura só é **linha de base** (`baseline`), nunca Move: não sabemos quando o cargo começou. Exceção: a **própria fonte anuncia** a mudança (`announcement`); aí a nomeação/saída vale com `basis = announcement`, e a data efetiva só entra se a fonte a traz.

| Situação | Resultado | Move | `before` | `after` |
|---|---|---|---|---|
| 1ª leitura da pessoa, sem anúncio | `baseline` (abre o cargo) | não | — | — |
| mesma pessoa, mesmo cargo | `unchanged` (só revalida: evidência e `validated_at` novos) | não | — | — |
| cargo diferente, mesma empresa | `title_change` (fecha o antigo, abre o novo) | sim | cargo antigo | cargo novo |
| cargo em outra empresa | `org_change` (idem; exige URL pública de perfil para reconhecer a pessoa em outra empresa, senão vira nomeação) | sim | cargo na empresa antiga | cargo na nova |
| fonte diz que saiu (`left`) | `departure` (fecha o cargo) | sim | cargo fechado | — |
| pessoa conhecida reaparece em cargo, sem cargo aberto | `appointment` | sim | — | cargo novo |
| leitura mais velha que o cargo aberto | `ignored: stale_observation` | não | — | — |
| fonte **secundária** (LinkedIn/The Org) | registra "a confirmar" (inferido); **nunca** Move, nunca fecha cargo | não | — | — |
| leitura **oficial** do cargo que estava "a confirmar" | confirma (vira declarado, sem Move) | não | — | — |

## Estados e revisão
`detected` (nasce assim) → `confirmed` ou `rejected` por revisão com identidade (`reviewMoveHandler`, papel editor). **O portal só vê `confirmed`**: Move não revisado responde 404, igual a inexistente. Alerta de watchlist é outra revisão (`pending_review → approved/rejected`, com revisor), independente da do Move.

## Forma da resposta (`MoveView`)
```
{ id, kind, basis, status, person_id, person_name,
  from_organization, from_title, to_organization, to_title,   // atalhos de leitura rápida
  effective_date,        // só se a fonte declara; senão null
  observed_on,           // data da leitura "depois"
  evidence,              // evidência que DETECTOU o Move (= a de "depois")
  before: MoveReading | null,   // cargo anterior: { role_id, organization, title, valid_from, valid_to, certainty, validated_at, evidence }
  after:  MoveReading | null }  // cargo novo (null na saída)
EvidenceRef = { id, source_url, source_name, retrieved_at, is_mock }   // fonte + link + data; NUNCA o trecho da página
```
Exibição: **fato + fonte + link + data**; o trecho literal (citação) fica só como evidência interna. `is_mock: true` ⇒ a interface escreve MOCK.

## Limites (para não prometer demais)
- "Antes" é a **última** evidência que sustentou o cargo anterior (revalidações substituem a evidência; a primeira leitura não fica como linha separada). A trilha completa de leituras exigiria uma tabela de leituras (não existe; é mudança de esquema, fora desta fase).
- `effective_date` ausente é o normal: não inventamos a data da mudança; `observed_on` é a data da leitura.
- Um Move só aparece depois de **duas coletas** do mesmo cargo em datas diferentes (ou de um anúncio). A frequência de recoleta é do Editorial.
- Pessoa suprimida a pedido do titular some dos Moves e dos alertas (e não é recriada).
