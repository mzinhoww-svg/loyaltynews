# Avaliação: tipo de relação `association_member` (pendência da Intelligence)

**Pergunta:** vale criar o tipo `association_member` ("é associada de") em vez de usar `other` para as 12 relações "associada da ABEMF" (v2/v3)?

## Como está hoje
- Tipos aceitos em **três camadas**, todas fixas: contrato `zod` (`packages/contracts/src/intelligence.ts:124`), `CHECK` do banco (`packages/db/drizzle/0006_intelligence.sql:105`, migração oficial do `@ln/db`) e o carregador (`REL_TYPES` em `src/seed-load.ts`, `repo.ts`): `parent_of`, `partner_of`, `supplier_of`, `coalition_member`, `acquired`, `other`. **`association_member` não existe em nenhuma.**
- As 12 relações da ABEMF são `other`, direção empresa → ABEMF, com a citação do nome da empresa na lista oficial e o contexto "Empresas Associadas — Conheça as empresas que fazem parte da ABEMF" (`contextQuote`). A seed v7 tem 36 relações; 12 são essas.

## Opções
| Opção | Prós | Contras |
|---|---|---|
| **A. Manter `other`** | zero migração; o dado já está carregado e verificado; o contexto fica na evidência | o tipo não diz nada: a interface mostra "outra relação"; não dá para filtrar/contar "associadas" nem distinguir de outras relações `other` (ex.: Santander→Esfera, Banco do Brasil→Banco BV) |
| **B. Usar `coalition_member`** | já existe | **semântica errada**: coalizão de pontos (ex.: GPA e Raia Drogasil na Stix) é aliança comercial; associação setorial é filiação a uma entidade; misturar polui a leitura do grafo |
| **C. Criar `association_member`** | tipo explícito, filtrável e rotulável ("associada de"); separa filiação (entidade ↔ membro) de coalizão e de parceria | exige **migração** (`CHECK`), **contrato** (`zod`), **rótulo na interface**, reclassificar as 12 relações e mudar o carregador; mudança em 4 donos |

## Recomendação
**C, em duas etapas, só quando houver valor para o produto** (hoje o portal mostra a relação com o rótulo genérico e o dado é pequeno; **não bloqueia 24/11**):
1. **Chief Architect/Backend 2:** contrato (`zod`) e `CHECK` aceitam `association_member` (migração `0031`, proposta em `proposals/0031_intelligence_relation_association_member.sql`, **não aplicada**; ela inclui a reclassificação das 12 relações, restrita às que vieram da lista oficial da ABEMF).
2. **Data:** `REL_TYPES`/`repo.ts` aceitam o tipo e a seed seguinte (v9) traz as 12 como `association_member` **com a mesma citação**; **Frontend 2/Studio:** rótulo "associada de" e filtro. Ordem importa: **código novo só depois da migração**, senão o carregador falha no `CHECK`.

**Por que não já:** mudar o tipo de relações já carregadas é alteração de dado em staging/produção (reclassificação) e atravessa o contrato público; a decisão de produto (vale diferenciar na interface?) é do Frontend 2/PM. Até lá, **`other` com o contexto na evidência é correto e verificável**; nada se perde.

## Pontos de cuidado (para quem implementar)
- A chave de idempotência do carregador é `from > tipo > to`: trocar o tipo cria relação NOVA em vez de "revalidar"; por isso a reclassificação deve ser **UPDATE na migração** (preserva evidência, datas e `id`), e a v9 só confirma (`exists`).
- Direção: manter **empresa → entidade** (como hoje), para o rótulo "associada de" ler da esquerda para a direita.
- Teste de aceite sugerido: relação `association_member` aparece no portal com fonte+link+data (nunca o trecho), e o grafo (`neighbors`) a traz como qualquer outra aresta vigente.
