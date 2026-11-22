# Contrato de ingestão Editorial → Intelligence — `role-observation/1`

Interface entre `packages/editorial` (produtor) e `packages/intelligence` (consumidor). Código: `src/ingest.ts`
(`ingestBatch`, `validateBatch`, `validateObservation`, `ROLE_OBSERVATION_BATCH_JSON_SCHEMA`). Testes: `tests/contract.test.ts`.
Estado: **proposta de interface** (fast-track, não homologada). Mudança de versão exige acordo entre os dois donos.

## O que o Editorial envia
Um lote por **fonte coletada** (uma página/comunicado), com a evidência uma vez e N observações:

```json
{
  "schemaVersion": "role-observation/1",
  "evidence": {
    "sourceUrl": "https://exemplo.invalid/comunicado",
    "sourceName": "Nome da fonte pública",
    "retrievedAt": "2026-11-22T10:00:00Z",
    "contentHash": "sha256:…",
    "excerpt": "trecho curto (≤ 500 caracteres) que sustenta o fato"
  },
  "observations": [
    {
      "personName": "Nome Sobrenome",
      "publicProfileUrl": "https://exemplo.invalid/perfil",
      "orgName": "Empresa S.A.",
      "title": "Diretora de Marketing",
      "kind": "present",
      "observedAt": "2026-11-22T10:00:00Z",
      "announcement": { "effectiveDate": "2026-11-20" }
    }
  ]
}
```

| Campo | Regra |
|---|---|
| `schemaVersion` | Exatamente `role-observation/1`. |
| `evidence.sourceUrl` | URL http(s) de **fonte pública**. Fonte privada/paga/login não entra (DP-11 P4). |
| `evidence.retrievedAt` | Instante da coleta (ISO 8601 com fuso). |
| `evidence.excerpt` | ≤ 500 caracteres: trecho, não cópia do texto. |
| `evidence.isMock` | `true` só em fixtures; a UI escreve MOCK. |
| `observations` | 1 a 500 itens. |
| `kind` | `present` = a fonte mostra a pessoa neste cargo; `left` = a fonte diz que saiu. |
| `announcement` | **Só** se a própria fonte anuncia a mudança (nomeação, saída, troca). Sem anúncio, uma pessoa nova é linha de base. `effectiveDate` só se a fonte traz a data. |
| `publicProfileUrl` | Opcional; desambigua homônimos. Sem ele, a pessoa só é reconhecida por nome **dentro da mesma empresa**. |
| `extra` | Reservado. **Recusado** enquanto a flag de dado pessoal ampliado estiver desligada (default). |

Escopo de dado de pessoa (DP-11 P4): nome, cargo e empresa de fonte pública. Nada além: sem e-mail, telefone, endereço, documento, idade, família, redes pessoais.
Chaves desconhecidas são recusadas (não há campo "livre").

## O que o Intelligence faz
1. Valida o lote (cabeçalho inválido ⇒ lote recusado, nada gravado).
2. Grava a evidência e processa cada observação, em ordem, via `processObservation`.
3. Devolve `IngestReport`: por item `processed` (com o resultado: `baseline | unchanged | move | ignored`) ou `rejected` (com `issues[]` e `path`). **Item inválido não bloqueia os demais.**

Resultados de `processed`:
- `baseline`: primeira vez que vemos a pessoa; **não** gera Move.
- `unchanged`: mesmo cargo/empresa; só revalida (`validated_at`).
- `move`: `appointment | departure | title_change | org_change`; nasce `detected`, entra na fila de revisão.
- `ignored`: `stale_observation` (mais antiga que o cargo aberto), `no_open_role_to_close`, `subject_suppressed` (titular pediu supressão).

## Garantias para o Editorial
- **Idempotência:** reenviar o mesmo lote não duplica cargos nem Moves (a evidência é regravada; o resultado vira `unchanged`).
- **Sem fato por presunção:** o contrato não tem campo de hierarquia; organograma e relações são cadastrados por outra via, com certeza `declared|inferred`.
- **Nada é publicado:** Moves e alertas exigem revisão registrada antes de aparecerem no portal.
- **Erros de dado** (restrição do banco) viram `rejected` com `code: "error"`; falha de conexão **lança** (o Editorial reenvia o lote).
- Sem transação por lote: se o processo cair no meio, reenviar o lote inteiro é seguro (idempotência).

## O que o Editorial NÃO deve fazer
- Enviar dado de fonte não pública, de rede social fechada, ou inferido por modelo como se fosse da fonte.
- Preencher `announcement` por dedução (só quando a fonte anuncia).
- Enviar `extra`.
- Coletar sem base/permissão da fonte: a regra de coleta é do Editorial; este contrato só recebe o resultado.

## Não verificado
Volume por lote real; política de reenvio/back-off do Editorial; autenticação do canal (o Backend monta a rota/worker).
