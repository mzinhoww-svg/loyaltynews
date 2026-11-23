# Piloto de 10 matérias pelo OpenBot — o que a Editorial entrega e decide (resposta ao AgentOps, 23/11/2026)

Kit do piloto: `ft/agents` 85e6ca5 / ba51ea2 (`packages/agents/artifacts/pilot-protocol.md`, seção 8). Aqui: as cinco decisões pedidas.

## 1. Prompts fixados

- Os prompts `editorial-0.2` estão em `packages/editorial/src/factory/prompts.ts`; o arquivo tem o blob `fd9a9f2f2a84` **idêntico** em `7b35efa` e nos commits seguintes (nada em `prompts.ts` mudou depois). **O commit certo é o `7b35efa`**; se `prompts.ts` mudar, eu aviso com o novo blob.
- **Atualização (23/11, decisão do PM):** o tom `tom-0.2` foi adotado como versão de trabalho e o prompt subiu para **`editorial-0.3`** (guia em `docs/tom-de-voz-v0.2.md`; "tom lint" bloqueante e avisos em `src/rules/tone.ts`). O kit do piloto deve fixar o `editorial-0.3` quando ele for homologado; o blob de `prompts.ts` do `editorial-0.3` está na mensagem de entrega ao QA 3. O parágrafo acima sobre `7b35efa` vale para o `editorial-0.2`.
- Mudou no commit que acompanha este documento, **fora de `prompts.ts`**: a entrada de `factcheck` e `review` ganha `reviewedDraft` (item 3). Como `prompts.ts` não muda, o blob fixado continua valendo; quem mede o piloto deve reler a entrada, não só o prompt.

## 2. Fontes a habilitar (ato humano; a Editorial não habilita)

Revisão é de **pessoa diferente do pesquisador** (a pesquisadora das fontes é a Editorial, `ln-editorial-engineer`) e a habilitação é de **admin ou editor-chefe**, com MFA, em `/studio/fontes/fabrica`. Eu não executo os handlers por isso. O que cada revisão precisa (`termsStatus: approved`, `urlVerified`, `robotsChecked`, `paywall: none`, nota ≥ 20 caracteres):

| Fonte (id) | Classe | Pode entrar no piloto? | Nota de revisão sugerida (o revisor confere antes) |
|---|---|---|---|
| `senado-noticias` | A | **Sim** (feed confirmado; coletada em 23/11) | "Termos da Agência Senado lidos (reprodução livre sem descaracterizar); robots conferido; sem login/paywall; classe A (docs/termos-fontes.md)." |
| `camara-noticias` | A | **Sim** (feed confirmado; atenção ao 429 se rodar em rajada) | "Termos do Portal da Câmara lidos (trechos entre aspas; domínio público); robots conferido; sem login/paywall; classe A." |
| `abemf` | D | **Sim** (feed com 10 itens; o mais recente é de 22/10) | "DP-28/DP-29, classe D, risco aceito pelo proprietário; sem termos de conteúdo; robots conferido; sem login/paywall." |
| `livelo-imprensa` | D | **Sim, com ressalva**: coleta por sitemap `/imprensa/` (37 páginas; a mais recente é de 26/08/2026) | "DP-28/DP-29, classe D, risco aceito; rodapé só traz Regulamentos e Privacidade; robots permite /imprensa; sem login/paywall." |
| `febraban` | D | **Não por enquanto — discordo**: sem feed e sem sitemap no `robots.txt`, o coletor não consegue ler a listagem; e o paywall está "desconhecido" na pesquisa | Alternativas D com feed conferido: `abrarec` (8 itens, 19/11) ou `procon-sp` (10 itens, 19/11) |

Classe C fica de fora (concordo). Para as matérias 1 a 10, Senado + Câmara bastam (5 + 5); as de mercado são opcionais.

## 3. Identificador da revisão do rascunho (`reviewed_draft_task_id`)

Implementado e testado (`src/tests/autoral-queue.test.ts`). Para cada rascunho, `draftRevision` produz:

- `taskId` = `<articleId>:draft:<tentativa>` (o id da tarefa de **redação** que produziu a revisão avaliada) → é o `reviewed_draft_task_id`;
- `draftId` = `<articleId>:d<tentativa>` e `sha256` = hash do rascunho inteiro (ADR-017).

Onde aparece:
1. **Entrada** das classes `factcheck` e `review`: campo `reviewedDraft: { taskId, draftId, sha256 }` (a redação não o recebe).
2. **Auditoria** de cada chamada (`AuditEntry.reviewedDraftTaskId`, `reviewedDraftSha256`).
3. **Registro** da matéria: `factcheck.reviewedDraftTaskId/Sha256` e `review.{provider, model, reviewedDraftTaskId, reviewedDraftSha256}`.
4. **Trava:** a `review` recusa (`stale_approval`) se o hash do rascunho atual diferir do hash que a checagem avaliou; com isso o par redator→checador→revisor é da **mesma** revisão.

Independência: a checagem sai com `excludeProviders: [<provedor do redator>]` (já é o comportamento); a `review` confere de novo que provedor da checagem ≠ provedor do redator. O provedor/modelo de cada etapa fica no registro (`draft.modelProvider`, `factcheck.provider/model`, `review.provider/model`).

## 4. Rubrica de leitura dos 10 rascunhos e formato de saída

**Esquemas de saída por classe** (formato, para `output_valid`, meta ≥ 95%): `validateModelOutput(taskClass, output, { evidenceIds, claimIds, strict })` em `src/factory/output-schemas.ts`; JSON Schema de cada classe em `docs/schemas-saida-por-classe.json` (um teste confere que o arquivo não diverge do código). Resumo: `triage {relevant:boolean, editoria?}`; `context {notes:[{text, evidenceIds≥1}]}`; `draft {headline, body, resumo≤300 (obrigatório), subtitulo?≤300, claims≥1 [{id,text,kind∈fact|number|quote|date,evidenceIds≥1,quote?}], imageCandidate?}`; `factcheck {verdicts:[{claimId, verdict∈pass|fail|inconclusive}]}` (com `claimIds` confere cobertura); `review {approve:boolean, issues?[]}`; `social_pack {linkedin≤1200, instagram?}`; `roles {mentions:[…]}`. Chave a mais é tolerada (`strict: true` a recusa). `output_valid` mede **formato**, não qualidade nem verdade.

**Rubrica `unsupported_facts`** (leitura humana de cada rascunho ao lado das evidências usadas):
- *Fato material* = afirmação do título, resumo ou corpo que, se falsa, muda o que o leitor entende ou decide: números, datas, valores, nomes de empresas/pessoas/cargos, condições e prazos, causa e efeito, atribuição ("segundo X") e citações. Não conta: conectivos, definição genérica de termo, formatação.
- *Suportado* = consta nas evidências, literalmente ou por paráfrase fiel. *Não suportado* = ausente, contraditório ou inferência além do dito ("deve valer para todos").
- `unsupported_facts` = nº de fatos materiais **não suportados** no rascunho. Registrar cada um: trecho, tipo, gravidade (**alta**: número, data, valor, citação, atribuição; **média**: nome, condição; **baixa**: contexto) e a evidência mais próxima.
- Critério proposto (o PM/QA 3 confirmam): **0 de gravidade alta nas 10**; no máximo **1 média** em 10; baixas só anotadas. O gate determinístico já barra número/data/citação fora das evidências, então alta > 0 indica falha dos gates e vira defeito.
- **Quem lê:** a Editorial **não** lê (não homologa a própria entrega) e os agentes do piloto também não. Leitor 1: **editor-chefe humano**; leitor 2: **QA 3** em 4 dos 10 (matérias 1, 4, 6 e 9) para medir concordância; divergência: o editor-chefe decide. A Editorial entrega, por matéria, o pacote de leitura (rascunho, evidências, claims, vereditos, achados dos gates, revisão) sem opinar.

## 5. Gates determinísticos e a etapa `rights_seo_qa`

Parcialmente. **Contam** como a parte de **direitos** e de **QA de conteúdo**: `copy_literal` (8 palavras / 30%; blog 6 / 20%), atribuição (link e bloco "Fontes:" gerado), âncora primária (`needs_primary_anchor`, `unanchored_claim`), números e datas nas evidências, citação literal, sem apuração/entrevista inventada, assinatura, decisão de imagem (D08: sem imagem de terceiro sem base de direito), e a base publicável (slug ≤ 80, resumo ≤ 300) como o **mínimo de SEO**. **Não contam**: QA visual (não há renderização do portal no pipeline) nem SEO além de slug e resumo (título ≤ 90 e lint de tom só existem como proposta em `docs/tom-de-voz-v0.2.md`). Se a etapa `rights_seo_qa` do piloto exige QA visual, ela fica **fora** do que a Editorial entrega.

## Roteiro

Concordo com 1 a 5 (checagem e revisão separadas) e 6 a 10 (chamada única): a chamada única **não existe hoje** no pipeline (são dois estágios, `factcheck` e `review`); para medir a economia de quota o AgentOps precisa de uma classe combinada — se o PM quiser, eu crio `factcheck_review` com o mesmo esquema das duas e o mesmo `reviewedDraft`; hoje o piloto 6–10 só pode simular a união no lado do agente.
