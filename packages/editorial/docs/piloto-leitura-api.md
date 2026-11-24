# Piloto de 10 matérias — API da leitura humana (contrato para a tela do Studio)

Folha de leitura: `fast-track/piloto/folha-de-leitura.md`. Rotas montadas pelo Backend em `/api/studio/editorial` (sessão + MFA + RBAC); handlers em `packages/editorial/src/api/pilot-handlers.ts`. **Nenhuma rota publica, aprova ou altera a matéria**: só mapa e leituras. Sem tabela nova: tudo na trilha de auditoria (somente-acréscimo): `piloto.mapped` e `piloto.leitura`.

## Papéis

| Quem | Papel de sessão | Pode |
|---|---|---|
| Proprietário (leitor 1, adjudicador) | `admin` ou `editor_chefe` | fixar o mapa; registrar leitura do leitor 1; ver o fechamento; ver as duas leituras quando ambas existem |
| QA 3 (leitor 2) | `revisor` | registrar leitura do leitor 2 (só a1, a4, a6, a9); listar |
| Editor | `editor` | só listar o mapa/estado |
| Comercial, leitor | — | nada (403) |

Uma pessoa não pode ser os dois leitores da mesma matéria (409).

## Rotas

| Método e caminho | Entrada | Resposta |
|---|---|---|
| `GET /piloto` | — | `{ items: [{ materia: "a1".."a10", articleId: string\|null, fonte: {id, nome}\|null, leitor2: boolean, estado, leituras: {leitor1: boolean, leitor2: boolean} }], fechamento? }`. `estado`: `nao_gerada` · `aguardando_leitura` · `leitor1_registrou` · `leitor2_registrou` · `lida`. `fechamento` (só admin/editor_chefe): `{ lidas, altas, medias, baixas, unsupportedFacts, criterio: "em_andamento"\|"aprovado"\|"reprovado", divergencias: string[] }` |
| `POST /piloto/mapa` | `{ a1?: articleId, … a10? }` (admin/editor_chefe) | 201 `{ mapa }`; 404 artigo inexistente; 409 matéria já mapeada (**imutável**) ou artigo já em outra matéria |
| `POST /piloto/:materia/leitura` | `{ leitor: 1\|2, achados: [{ trecho (3–500), tipo: numero\|data\|valor\|nome\|condicao\|causa\|atribuicao\|citacao\|contexto, gravidade: alta\|media\|baixa, evidenciaId?, nota? }], checklist: { fatosNasEvidencias, tom, nadaInventado }, veredito: aprovado\|bloqueado }` | 201 `{ materia, leitor, unsupportedFacts, altas, medias, baixas }`; 400 campo extra/inválido, `evidenciaId` que não é do artigo, leitor 2 fora de a1/a4/a6/a9, ou `aprovado` com achado **alta** ou checklist incompleto; 403 papel errado; 404 matéria ainda não gerada; **409** leitura já registrada (uma por leitor e matéria, imutável) ou mesma pessoa nos dois leitores |
| `GET /piloto/:materia/leituras` | — | `{ materia, articleId, leituras: [...], ocultas: n }` com a regra de cegueira |

Erros: envelope padrão `{ error: { code, message, details? } }` (401 sem sessão/MFA, 403, 400, 404, 409).

## Cegueira

- O leitor 2 (e qualquer pessoa que ainda não registrou a própria leitura da matéria) **não vê** a leitura do outro: `leituras` vem vazia e `ocultas` diz quantas existem. `GET /piloto` mostra só `leituras: {leitor1, leitor2}` (booleans), nunca o conteúdo nem as contagens.
- Depois de registrar a dele, o leitor vê as duas. O adjudicador (admin/editor_chefe que não leu) só vê as duas quando **ambas** as leituras requeridas existem.
- O `fechamento` (contagens) só vai para admin/editor_chefe.

## Fechamento (critério do PM)

Soma das leituras do **leitor 1** nas 10 matérias: **0 altas e no máximo 1 média** ⇒ `aprovado` (só quando as 10 têm leitura); acima disso ⇒ `reprovado` (mesmo antes das 10); senão `em_andamento`. `divergencias` = matérias com dois leitores cujo veredito ou nº de altas/médias diferem (baixas só anotadas). A divergência é decidida pelo proprietário.

## Dados para a tela (sem rota nova)

Pacote da matéria: `GET /articles/:articleId/review` (rascunho, claims com veredito, evidências, achados do gate, independência, `avisosDeTom`). Mapa e leituras: as rotas acima. **Fixtures para teste:** `sampleArticle(id, over)` de `@ln/editorial/testing` (marcado MOCK) + `POST /piloto/mapa`; os testes `pilot-handlers.test.ts` e `apps/web/app/api/editorial/piloto.test.ts` mostram o roteiro completo.

## Quem fixa o mapa

O mapa matéria→artigo é fixado **depois da rodada do piloto**, por um admin/editor-chefe (o operador do piloto, a partir da planilha do AgentOps), com `POST /piloto/mapa`; a Editorial entrega o pacote de cada matéria mas não escolhe qual é a1…a10.

## Importação auditada da leitura do leitor 2 (folha lida fora do Studio)

O QA 3 lê pela folha, fora do Studio; o leitor 1 (admin/editor_chefe) carrega o arquivo no Studio. O parse do CSV e a prévia são do Studio; a Editorial recebe JSON. **Só `admin` ou `editor_chefe`** (o revisor/QA 3 não importa; editor 403).

| Rota | Entrada | Resposta |
|---|---|---|
| `POST /piloto/importacao/registro` | `{ arquivo: { nome, sha256 (hex 64, calculado pelo Studio sobre os bytes), linhas }, leitor2Nome, materias: ["a1","a4",…] }` | **201** `{ registradoEm, sha256 }` na primeira vez; **200** com o registro original se o mesmo sha256 for enviado de novo (idempotente); **409 FOLHA_DIFERENTE** se já houver folha registrada com OUTRO sha256 para alguma das matérias (a outra não é gravada); 400 matéria sem leitor 2 (só a1, a4, a6, a9). Só auditoria (`piloto.folha_recebida`), **sem conteúdo**. A tela chama assim que o arquivo é carregado e válido, antes de qualquer prévia. |
| `POST /piloto/importacao/revogar` | `{ sha256 (hex 64), motivo (20–500 caracteres) }` (strict). Só admin/editor_chefe. **Saída para erro humano no registro da folha** (parecer QA 1, R1): o hash é gravado no 1º envio, até com a importação bloqueada, e antes disso congelava as matérias naquele arquivo para sempre. Revogar tira a folha do estado ativo para o arquivo correto poder ser registrado. | **200** `{ sha256, materiasLiberadas, revogadaEm }` (nunca o conteúdo da folha); 400 motivo curto/sha256 inválido/campo extra; 401/403; **404** folha não registrada ou já revogada; **409 `FOLHA_COM_LEITURAS`** se já há leitura do leitor 2 importada dessa folha (a leitura é imutável e a folha é a prova dela). O registro original (`piloto.folha_recebida`) e a revogação (`piloto.folha_revogada`: quem, quando, motivo, matérias) ficam na trilha, que só recebe acréscimos; o mesmo hash pode ser registrado de novo depois. |
| `POST /piloto/importacao` | `{ arquivo: {nome, sha256, linhas}, leitor2Nome (2–80), leituras: [{ materia, achados, checklist, veredito }] }` (strict; `achados` e `checklist` iguais ao `POST /piloto/:materia/leitura`) | **201** `{ importadas: [{ materia, unsupportedFacts, altas, medias, baixas }] }` (**nunca o conteúdo**). Erros: 403 papel; 400 mesmas validações da leitura (matéria só a1/a4/a6/a9, repetida no arquivo, trecho 3–500, tipo/gravidade do contrato, `evidenciaId` do artigo, "aprovado" sem alta e com checklist completo, campo extra, sha256 inválido); 404 matéria sem artigo mapeado; **409 `LEITOR1_PENDENTE`** (o leitor 1 ainda não registrou a leitura dele daquela matéria: regra de cegueira, aplicada no servidor); **409** o leitor 2 daquela matéria já existe (imutável) ou o mesmo arquivo (sha256) já foi importado; **409 `FOLHA_DIFERENTE`**. |

- **Atomicidade: tudo ou nada.** Se qualquer matéria for inválida ou estiver bloqueada, **nenhuma** é gravada (sem 207). Uma exceção deliberada: o **hash da folha é gravado no primeiro envio mesmo quando a importação fica bloqueada** (ex.: `LEITOR1_PENDENTE`), para provar que a folha não mudou depois que o leitor 1 a viu.
- **Registro:** cada leitura entra como leitor 2 em `piloto.leitura` com `origem: "importacao"`, `por = "importado por <userId> da folha de <leitor2Nome>"`, `importadoPor`, `leitor2Nome` e `arquivo {nome, sha256, linhas}`; mais `piloto.importado` (arquivo, matérias, quem, quando) e `piloto.folha_recebida`.
- **`GET /piloto`:** cada item ganha `folha: { sha256, em } | null` (hash e data da **primeira** folha registrada para a matéria; nunca o conteúdo).
- A leitura importada vale como a do leitor 2 em tudo: estado (`lida`), fechamento, divergência e cegueira.
