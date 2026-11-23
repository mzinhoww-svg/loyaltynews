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
